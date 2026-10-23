import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { IcsFileCalendar, parseIcs } from "../src/adapters/ics/ics-file-calendar.ts";
import { HtmlFileOutput } from "../src/adapters/html/html-file-output.ts";
import { ConsoleOutput, InMemoryMemoryStore, StubNewsSource, StubRatingModel } from "../src/adapters/stub/stubs.ts";
import { maintenanceConfig } from "../src/config.ts";
import { computeWindow, isUpcoming, ruleText, type MaintenanceRule } from "../src/domain/maintenance-window.ts";
import { runPipeline } from "../src/pipeline/run.ts";

// Synthetic fixture written for these tests (not a real vendor calendar).
const FIXTURE = new URL("./fixtures/maintenance-sample.ics", import.meta.url);
// Default rule as configured: a release on a Sunday is installed that evening.
const RULE: MaintenanceRule = { weekday: "sunday", start: "19:00", end: "07:00", timeZone: "Europe/Berlin", sameDay: true };
const NEXT_WEEK: MaintenanceRule = { ...RULE, sameDay: false };

let dir: string;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "news-agent-maint-"));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function fixture() {
  return parseIcs(await readFile(FIXTURE, "utf8"), "Europe/Berlin");
}

test("parses events: folded lines, escapes, date-only, UTC and TZID starts", async () => {
  const { updates } = await fixture();
  assert.deepEqual(
    updates.map((u) => [u.uid, u.updateDate]),
    [
      ["normal-thursday", "2026-04-16"],
      ["saturday", "2026-04-18"],
      ["sunday", "2026-04-19"],
      ["utc-late-evening", "2026-04-21"], // 23:00 UTC is 01:00 the next day in Berlin
      ["tzid-local", "2026-04-22"],
      ["dst-change", "2026-10-22"],
      ["year-change", "2026-12-29"],
    ],
  );
  assert.equal(updates[0]!.summary, "Software update A (folded summary line)");
  assert.equal(updates[1]!.summary, "Software update B; Saturday");
  assert.equal(updates[3]!.summary, "Software update D (UTC, next day in Berlin)");
});

test("malformed DTSTAMP (7 digits in the time) is a warning, not a failure; missing DTSTART skips the event", async () => {
  const { updates, warnings } = await fixture();
  assert.ok(updates.some((u) => u.uid === "normal-thursday"), "event with the malformed DTSTAMP is kept");
  assert.deepEqual(warnings, [
    "DTSTAMP not in the format YYYYMMDDTHHMMSSZ in 1 event(s), e.g. normal-thursday: 20250123T1100000Z; DTSTAMP is not used",
    "no-start: no DTSTART; event skipped",
  ]);
});

test("update on Thursday 2026-04-16: window Sunday 19:00 to Monday 07:00", () => {
  assert.deepEqual(computeWindow("2026-04-16", RULE), {
    updateDate: "2026-04-16",
    startLocal: "Sun 2026-04-19 19:00",
    endLocal: "Mon 2026-04-20 07:00",
    startUtc: "2026-04-19T17:00:00.000Z",
    endUtc: "2026-04-20T05:00:00.000Z",
  });
});

test("default (same day on): update on a Saturday gets the next day, on a Sunday the same evening", () => {
  assert.equal(computeWindow("2026-04-18", RULE).startLocal, "Sun 2026-04-19 19:00");
  assert.deepEqual(
    [computeWindow("2026-04-19", RULE).startLocal, computeWindow("2026-04-19", RULE).endLocal],
    ["Sun 2026-04-19 19:00", "Mon 2026-04-20 07:00"],
  );
  assert.equal(computeWindow("2026-04-20", RULE).startLocal, "Sun 2026-04-26 19:00");
});

test("same day off: an update on a Sunday gets the following Sunday; other days unchanged", () => {
  assert.equal(computeWindow("2026-04-19", NEXT_WEEK).startLocal, "Sun 2026-04-26 19:00");
  assert.equal(computeWindow("2026-04-18", NEXT_WEEK).startLocal, "Sun 2026-04-19 19:00");
  assert.equal(computeWindow("2026-04-16", NEXT_WEEK).startLocal, "Sun 2026-04-19 19:00");
  assert.equal(computeWindow("2026-04-20", NEXT_WEEK).startLocal, "Sun 2026-04-26 19:00");
});

test("year change and daylight saving time end", () => {
  const year = computeWindow("2026-12-29", RULE);
  assert.deepEqual([year.startLocal, year.endLocal], ["Sun 2027-01-03 19:00", "Mon 2027-01-04 07:00"]);
  // 2026-10-25: clocks go back at 03:00, the window is in winter time (UTC+1).
  const dst = computeWindow("2026-10-22", RULE);
  assert.deepEqual([dst.startLocal, dst.startUtc, dst.endUtc], ["Sun 2026-10-25 19:00", "2026-10-25T18:00:00.000Z", "2026-10-26T06:00:00.000Z"]);
});

test("other weekday and times from the configuration", () => {
  const rule: MaintenanceRule = { weekday: "saturday", start: "22:00", end: "23:30", timeZone: "Europe/Berlin", sameDay: false };
  const w = computeWindow("2026-04-16", rule);
  assert.deepEqual([w.startLocal, w.endLocal], ["Sat 2026-04-18 22:00", "Sat 2026-04-18 23:30"]);
  assert.equal(
    ruleText(rule),
    "first Saturday after the update date, 22:00 to Saturday 23:30 (Europe/Berlin); an update on a Saturday gets the following Saturday's window",
  );
  assert.equal(
    ruleText(RULE),
    "first Sunday on or after the update date, 19:00 to Monday 07:00 (Europe/Berlin); an update on a Sunday is installed the same evening",
  );
  assert.equal(
    ruleText(NEXT_WEEK),
    "first Sunday after the update date, 19:00 to Monday 07:00 (Europe/Berlin); an update on a Sunday gets the following Sunday's window",
  );
});

test("upcoming: not ended yet and starting within the look-ahead", () => {
  const w = computeWindow("2026-04-16", RULE); // 2026-04-19 17:00Z to 2026-04-20 05:00Z
  assert.equal(isUpcoming(w, new Date("2026-04-01T00:00:00Z"), 30), true);
  assert.equal(isUpcoming(w, new Date("2026-03-01T00:00:00Z"), 30), false, "starts after the look-ahead");
  assert.equal(isUpcoming(w, new Date("2026-04-19T20:00:00Z"), 30), true, "running window counts");
  assert.equal(isUpcoming(w, new Date("2026-04-20T05:00:00Z"), 30), false, "ended");
});

async function runWithCalendar(now: string, lookaheadDays = 30) {
  const output = new HtmlFileOutput({ outDir: dir });
  const result = await runPipeline(
    { source: new StubNewsSource(), memory: new InMemoryMemoryStore(), model: new StubRatingModel(), output },
    {
      runsDir: dir,
      now: () => new Date(now),
      warn: () => {},
      maintenance: { calendar: new IcsFileCalendar(fileURLToPath(FIXTURE), "Europe/Berlin"), rule: RULE, lookaheadDays },
    },
  );
  return { ...result, html: await readFile(output.lastPath!, "utf8") };
}

test("report shows upcoming windows with update date, summary, window and the rule", async () => {
  const { html, log } = await runWithCalendar("2026-04-15T12:00:00.000Z", 12);
  // Within 12 days of 2026-04-15: window 04-19 (updates of 04-16, 04-18 and 04-19, a Sunday)
  // and window 04-26 (updates of 04-21 and 04-22).
  assert.ok(html.includes("Maintenance windows (next 12 days, 5)"));
  assert.ok(html.includes("Why this window: first Sunday on or after the update date, 19:00 to Monday 07:00 (Europe/Berlin)"));
  assert.ok(
    html.includes(
      "<tr><td>2026-04-19</td><td>Software update C on a Sunday</td><td>Sun 2026-04-19 19:00 to Mon 2026-04-20 07:00</td></tr>",
    ),
  );
  assert.ok(
    html.includes(
      "<tr><td>2026-04-16</td><td>Software update A (folded summary line)</td><td>Sun 2026-04-19 19:00 to Mon 2026-04-20 07:00</td></tr>",
    ),
  );
  assert.ok(html.includes("Software update E (TZID)"));
  assert.ok(!html.includes("Software update F"), "October window is beyond the look-ahead");
  assert.ok(html.includes("Calendar warnings:"));
  const calendar = log.stages.find((s) => s.stage === "calendar")!;
  assert.equal(calendar.outputCount, 5);
  // 10 days end before the second Sunday window starts: only the three updates of the 04-19 window.
  assert.ok((await runWithCalendar("2026-04-15T12:00:00.000Z", 10)).html.includes("Maintenance windows (next 10 days, 3)"));
});

test("nothing upcoming: the section says None", async () => {
  const { html } = await runWithCalendar("2027-02-01T12:00:00.000Z");
  assert.ok(html.includes("Maintenance windows (next 30 days, 0)"));
  assert.ok(/Maintenance windows[^]*?<p>None\.<\/p>/.test(html));
});

test("without a calendar there is no calendar stage and no section", async () => {
  const output = new ConsoleOutput(true);
  const { log } = await runPipeline(
    { source: new StubNewsSource(), memory: new InMemoryMemoryStore(), model: new StubRatingModel(), output },
    { runsDir: dir },
  );
  assert.ok(!log.stages.some((s) => s.stage === "calendar"));
  assert.equal(output.report!.maintenance, undefined);
});

const ENV = [
  "DATEV_MAINTENANCE_ICS_PATH",
  "DATEV_MAINTENANCE_WEEKDAY",
  "DATEV_MAINTENANCE_START",
  "DATEV_MAINTENANCE_END",
  "DATEV_MAINTENANCE_TZ",
  "DATEV_MAINTENANCE_LOOKAHEAD_DAYS",
  "DATEV_MAINTENANCE_SAME_DAY",
];
const savedEnv = Object.fromEntries(ENV.map((n) => [n, process.env[n]]));
afterEach(() => {
  for (const n of ENV) {
    if (savedEnv[n] === undefined) delete process.env[n];
    else process.env[n] = savedEnv[n];
  }
});

test("configuration: off without a path, defaults, and invalid values rejected", () => {
  for (const n of ENV) delete process.env[n];
  assert.equal(maintenanceConfig(), undefined);
  process.env["DATEV_MAINTENANCE_ICS_PATH"] = "data/datev/calendar.ics";
  assert.deepEqual(maintenanceConfig(), {
    icsPath: "data/datev/calendar.ics",
    rule: { weekday: "sunday", start: "19:00", end: "07:00", timeZone: "Europe/Berlin", sameDay: true },
    lookaheadDays: 30,
  });
  process.env["DATEV_MAINTENANCE_SAME_DAY"] = "false";
  assert.equal(maintenanceConfig()!.rule.sameDay, false);
  delete process.env["DATEV_MAINTENANCE_SAME_DAY"];
  for (const [name, value, error] of [
    ["DATEV_MAINTENANCE_WEEKDAY", "sonntag", /WEEKDAY must be one of/],
    ["DATEV_MAINTENANCE_START", "7pm", /START must be a time HH:MM/],
    ["DATEV_MAINTENANCE_END", "24:00", /END must be a time HH:MM/],
    ["DATEV_MAINTENANCE_TZ", "Mars/Olympus", /TZ is not a known time zone/],
  ] as const) {
    process.env[name] = value;
    assert.throws(() => maintenanceConfig(), error, name);
    delete process.env[name];
  }
});
