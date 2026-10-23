import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { toNewsItems } from "../src/adapters/zetaris/m365-mapping.ts";
import type { M365Details, NewsItem } from "../src/domain/types.ts";
import { m365Rules, prefilter, requiredFields, type M365RuleOptions } from "../src/pipeline/prefilter.ts";

const NOW = new Date("2026-10-23T08:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function item(id: string, status: string, m365: Partial<M365Details> | null = {}): NewsItem {
  const base: NewsItem = {
    id,
    source: "test",
    title: `Item ${id}`,
    summary: "",
    url: `https://example.com/${id}`,
    status,
    tags: [],
    fetchedAt: NOW.toISOString(),
    raw: null,
  };
  if (m365 === null) return base;
  return {
    ...base,
    m365: {
      products: [],
      cloudInstances: ["Worldwide (Standard Multi-Tenant)"],
      gaMonth: "2026-11",
      previewMonth: null,
      modifiedAt: new Date(NOW.getTime() - DAY).toISOString(),
      ...m365,
    },
  };
}

function run(items: NewsItem[], opts: Partial<M365RuleOptions> = {}, maxItems?: number) {
  const rules = [requiredFields, ...m365Rules({ now: NOW, newDays: 8, horizonMonths: 3, ...opts })];
  return prefilter(items, { rules, ...(maxItems !== undefined && { maxItems }) });
}

function decision(result: ReturnType<typeof run>, id: string) {
  return result.decisions.find((d) => d.itemId === id)!;
}

test("VF-NEU keeps items modified exactly N days ago and drops older ones", () => {
  const exact = new Date(NOW.getTime() - 8 * DAY).toISOString();
  const older = new Date(NOW.getTime() - 8 * DAY - 1).toISOString();
  const r = run([item("a", "Launched", { modifiedAt: exact }), item("b", "Launched", { modifiedAt: older }), item("c", "Launched", { modifiedAt: null })]);
  assert.equal(decision(r, "a").kept, true);
  assert.deepEqual(decision(r, "b"), { itemId: "b", kept: false, ruleId: "VF-NEU", reason: "modified 2026-10-15, older than 8 days" });
  assert.equal(decision(r, "c").reason, "no valid modified date");
});

test("VF-NEU can be disabled and now set explicitly", () => {
  const old = item("a", "In development", { modifiedAt: "2025-01-01T00:00:00Z", gaMonth: "2027-01" });
  assert.equal(decision(run([old]), "a").ruleId, "VF-NEU");
  const r = run([old], { newDays: null, now: new Date("2026-10-19T00:00:00Z") });
  assert.equal(decision(r, "a").kept, true);
  assert.ok(!("VF-NEU" in r.droppedByRule));
});

test("VF-CLOUD drops items without a Worldwide cloud", () => {
  const r = run([item("a", "Launched", { cloudInstances: ["GCC", "DoD"] }), item("b", "Launched", { cloudInstances: [] })]);
  assert.equal(decision(r, "a").ruleId, "VF-CLOUD");
  assert.equal(decision(r, "a").reason, "no Worldwide cloud (GCC, DoD)");
  assert.equal(decision(r, "b").reason, "no Worldwide cloud (none)");
});

test("VF-STATUS drops Cancelled", () => {
  assert.equal(decision(run([item("a", "Cancelled")]), "a").ruleId, "VF-STATUS");
});

test("VF-HORIZONT keeps live items and limits the rest by GA month", () => {
  const r = run([
    item("live", "Rolling out", { gaMonth: "2028-01" }),
    item("edge", "In development", { gaMonth: "2027-01" }),
    item("beyond", "In development", { gaMonth: "2027-02" }),
    item("passed", "In development", { gaMonth: "2026-08" }),
    item("nodate", "In development", { gaMonth: null }),
  ]);
  assert.equal(decision(r, "live").kept, true);
  assert.equal(decision(r, "edge").kept, true);
  assert.deepEqual(decision(r, "beyond"), { itemId: "beyond", kept: false, ruleId: "VF-HORIZONT", reason: "GA 2027-02 beyond horizon 2027-01" });
  assert.deepEqual(decision(r, "passed"), {
    itemId: "passed",
    kept: true,
    ruleId: "all",
    reason: "passed all rules; VF-HORIZONT: GA 2026-08 passed, still in development",
  });
  assert.equal(decision(r, "nodate").reason, "no GA month, status In development");
});

test("VF-HORIZONT crosses the year boundary", () => {
  const r = run([item("a", "In development", { gaMonth: "2027-03" })], {
    now: new Date("2026-12-15T00:00:00Z"),
    newDays: null,
  });
  assert.equal(decision(r, "a").kept, true);
});

test("unknown status is kept and logged as a warning", () => {
  const r = run([item("a", "Planned")]);
  assert.equal(decision(r, "a").kept, true);
  assert.deepEqual(r.warnings, ['a: unknown status "Planned", treated like "In development"']);
});

test("items without m365 details pass the M365 rules", () => {
  const r = run([item("ics", "Event", null)]);
  assert.equal(decision(r, "ics").kept, true);
});

test("first dropping rule decides and drops are counted per rule", () => {
  const r = run([
    item("a", "Cancelled", { cloudInstances: ["GCC"] }),
    item("b", "Cancelled"),
    item("c", "Launched"),
  ]);
  assert.equal(decision(r, "a").ruleId, "VF-CLOUD");
  assert.deepEqual(r.droppedByRule, { "required-fields": 0, "VF-NEU": 0, "VF-CLOUD": 1, "VF-STATUS": 1, "VF-HORIZONT": 0 });
});

test("VF-LIMIT keeps the most recently modified items and records the rest", () => {
  const at = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
  const r = run(
    [item("old", "Launched", { modifiedAt: at(5) }), item("new", "Launched", { modifiedAt: at(1) }), item("mid", "Launched", { modifiedAt: at(3) })],
    {},
    2,
  );
  assert.deepEqual(r.kept.map((i) => i.id), ["new", "mid"]);
  assert.deepEqual(decision(r, "old"), {
    itemId: "old",
    kept: false,
    ruleId: "VF-LIMIT",
    reason: "rank 3 of 3 by modified date (2026-10-18), limit 2",
  });
  assert.equal(r.droppedByRule["VF-LIMIT"], 1);
  assert.equal(r.decisions.length, 3);
});

test("VF-LIMIT is counted as 0 when nothing is cut and absent when unlimited", () => {
  assert.equal(run([item("a", "Launched")], {}, 5).droppedByRule["VF-LIMIT"], 0);
  assert.ok(!("VF-LIMIT" in run([item("a", "Launched")]).droppedByRule));
});

test("fixture rows: decisions on the real sample", async () => {
  const body = JSON.parse(await readFile(new URL("./fixtures/zetaris-m365-sample.json", import.meta.url), "utf8")) as unknown;
  const items = toNewsItems(body, NOW.toISOString());
  const r = run(items, { now: new Date("2026-10-23T08:42:46.706Z") });
  // 577827: modified 2026-10-22, Launched. 576761: modified 2026-10-16, GA 2026-10.
  // 560700: modified 2026-09-24, older than 8 days.
  assert.deepEqual(
    r.decisions.map((d) => [d.itemId, d.kept, d.ruleId]),
    [
      ["m365:577827", true, "all"],
      ["m365:576761", true, "all"],
      ["m365:560700", false, "VF-NEU"],
    ],
  );
});
