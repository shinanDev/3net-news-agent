// Measures the agent against human-labelled test sets (data/testsets/*.json, gitignored).
// Uses a saved Zetaris snapshot (no new query). Prefilter per item as of its rating date, with
// VF-NEU disabled and VF-LIMIT off, for each horizon M. Items that pass at the largest M are
// rated once per rating date, sequentially, with the rating date as "today" in the rubric.
// Usage:
//   npx tsx scripts/measure-testsets.ts [--snapshot <file>] [--testsets <dir>] [--horizons 3,4]
//                                       [--rater nightshift|stub] [--threshold <n>] [--profile <path>]
//                                       [--dry-run] [--resume <ratings.jsonl>]
// --dry-run runs the prefilter only and prints the number of model calls; nothing is written.
// Every finished rating is appended to a JSONL file at once; --resume continues from it.
// Writes data/out/measure-<timestamp>.json and .html and prints a summary.

import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { NightshiftClient } from "../src/adapters/nightshift/nightshift-client.ts";
import { NightshiftRatingModel, RatingFailedError } from "../src/adapters/nightshift/nightshift-rating-model.ts";
import { StubRatingModel } from "../src/adapters/stub/stubs.ts";
import { toNewsItems } from "../src/adapters/zetaris/m365-mapping.ts";
import {
  DEFAULT_NIGHTSHIFT_TIMEOUT_MS,
  DEFAULT_RATING_LANGUAGE,
  DEFAULT_RATING_PROFILE,
  intEnv,
  loadEnv,
  requireEnv,
  stringEnv,
} from "../src/config.ts";
import { loadProfile, type RelevanceProfile } from "../src/domain/profile.ts";
import {
  buildReport,
  parseTestset,
  prefilterAt,
  ratingDate,
  ratingKey,
  renderMeasureHtml,
  summaryLines,
  type ItemResult,
  type RatingOutcome,
  type TestItem,
} from "../src/measure/testsets.ts";
import { DEFAULT_SCORE_THRESHOLD } from "../src/pipeline/run.ts";
import type { RatingModel } from "../src/ports/rating-model.ts";

const DEFAULT_SNAPSHOT = "data/snapshots/2026-10-23T12-37-06-164Z.json";

const { values } = parseArgs({
  options: {
    snapshot: { type: "string", default: DEFAULT_SNAPSHOT },
    testsets: { type: "string", default: "data/testsets" },
    horizons: { type: "string", default: "3,4" },
    rater: { type: "string", default: "nightshift" },
    threshold: { type: "string" },
    profile: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    resume: { type: "string" },
  },
});

loadEnv();
const horizons = values.horizons.split(",").map((s) => Number(s.trim()));
if (!horizons.length || horizons.some((m) => !Number.isInteger(m) || m < 0)) throw new Error("--horizons: integers, e.g. 3,4");
const maxHorizon = Math.max(...horizons);
const threshold = values.threshold === undefined ? DEFAULT_SCORE_THRESHOLD : Number(values.threshold);
if (values.rater !== "nightshift" && values.rater !== "stub") throw new Error("--rater: nightshift or stub");
const profile = await loadProfile(values.profile ?? stringEnv("RATING_PROFILE", DEFAULT_RATING_PROFILE));

const files = (await readdir(values.testsets)).filter((f) => f.endsWith(".json")).sort();
if (!files.length) throw new Error(`no *.json in ${values.testsets}`);
const tests: TestItem[] = [];
for (const f of files) tests.push(...parseTestset(JSON.parse(await readFile(join(values.testsets, f), "utf8")) as unknown, f));

const items = toNewsItems(JSON.parse(await readFile(values.snapshot, "utf8")) as unknown, new Date().toISOString());
const byId = new Map(items.map((i) => [i.id, i]));

const results: ItemResult[] = tests.map((test) => {
  const item = byId.get(`m365:${test.roadmapId}`);
  if (!item) return { test, inSnapshot: false, modifiedAfterRating: false, modifiedAt: null, prefilter: {} };
  const modifiedAt = item.m365?.modifiedAt ?? null;
  // Compare with the end of the rating day: a change on that day may already have been visible.
  const modifiedAfterRating = modifiedAt !== null && Date.parse(modifiedAt) >= Date.parse(`${test.ratedOn}T23:59:59.999Z`);
  const prefilter = Object.fromEntries(horizons.map((m) => [m, prefilterAt(item, test.ratedOn, m, profile.outOfScopeProducts)]));
  return { test, inSnapshot: true, modifiedAfterRating, modifiedAt, prefilter };
});

// A larger horizon only keeps more items, so the largest M decides what goes to the model.
const toRate = new Map<string, ItemResult>();
for (const r of results) if (r.prefilter[maxHorizon]?.kept) toRate.set(ratingKey(r.test), r);

console.log(`snapshot   ${values.snapshot}`);
console.log(`test sets  ${files.join(", ")} (${tests.length} items)`);
console.log(`horizons   ${horizons.join(", ")}; VF-NEU off, VF-LIMIT off; threshold ${threshold}`);
console.log("");
console.log(["round", "id".padEnd(7), "label", "snap", "mod>", ...horizons.map((m) => `M=${m}`.padEnd(40))].join("  "));
for (const r of results) {
  const cells = horizons.map((m) => {
    const d = r.prefilter[m];
    return (d ? (d.kept ? `pass${d.reason.includes(";") ? ` (${d.reason.split("; ").slice(1).join("; ")})` : ""}` : `${d.ruleId}: ${d.reason}`) : "-").padEnd(40);
  });
  console.log(
    [String(r.test.round).padEnd(5), r.test.roadmapId.padEnd(7), String(r.test.label).padEnd(5), r.inSnapshot ? "yes " : "NO  ", r.modifiedAfterRating ? "yes " : "    ", ...cells].join("  "),
  );
}
console.log("");
const notFound = results.filter((r) => !r.inSnapshot);
if (notFound.length) console.log(`not in snapshot: ${notFound.map((r) => r.test.roadmapId).join(", ")}`);
for (const m of horizons) {
  console.log(`M=${m}: ${results.filter((r) => r.prefilter[m]?.kept).length} of ${results.filter((r) => r.inSnapshot).length} found items pass`);
}
console.log(`model calls: ${toRate.size} ratings (one per item and rating date); an invalid answer adds one more attempt`);

if (values["dry-run"]) process.exit(0);

const outDir = join("data", "out");
await mkdir(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const ratingsPath = values.resume ?? join(outDir, `measure-${stamp}.ratings.jsonl`);
const done = new Map<string, RatingOutcome>();
if (values.resume) {
  for (const line of (await readFile(values.resume, "utf8")).split("\n")) {
    if (!line.trim()) continue;
    const e = JSON.parse(line) as { key: string; outcome: RatingOutcome };
    done.set(e.key, e.outcome);
  }
  console.log(`resume: ${done.size} rating(s) from ${values.resume}`);
}

let currentDay = new Date();
const model = createModel(profile, () => currentDay);
console.log(`rater      ${values.rater}${values.rater === "nightshift" ? ` (${model.model}, strict model check off)` : ""}`);
let n = 0;
for (const [key, r] of toRate) {
  n++;
  const prefix = `[${n}/${toRate.size}] ${r.test.roadmapId} (${r.test.ratedOn})`;
  const previous = done.get(key);
  if (previous) {
    console.log(`${prefix} from resume file`);
    continue;
  }
  currentDay = ratingDate(r.test.ratedOn);
  const outcome = await rateOnce(model, byId.get(`m365:${r.test.roadmapId}`)!);
  done.set(key, outcome);
  await appendFile(ratingsPath, `${JSON.stringify({ key, outcome })}\n`, "utf8");
  if (outcome.ok) {
    const meta = outcome.rating.meta;
    console.log(
      `${prefix} score ${outcome.rating.score}, routed ${meta?.routedModel ?? meta?.responseModel ?? outcome.rating.model}, ` +
        `receipt ${meta?.receiptId ?? "none"}, ${((meta?.durationMs ?? 0) / 1000).toFixed(1)} s`,
    );
  } else {
    console.log(`${prefix} FAILED after ${outcome.attempts} attempt(s): ${outcome.error}`);
  }
}
for (const r of results) {
  const o = r.inSnapshot ? done.get(ratingKey(r.test)) : undefined;
  if (o && r.prefilter[maxHorizon]?.kept) r.rating = o;
}

const report = buildReport(results, {
  generatedAt: new Date().toISOString(),
  snapshot: basename(values.snapshot),
  rater: values.rater === "nightshift" ? `nightshift, requested ${model.model}` : "stub",
  scoreThreshold: threshold,
  horizons,
  testsetFiles: files,
});
const jsonPath = join(outDir, `measure-${stamp}.json`);
const htmlPath = join(outDir, `measure-${stamp}.html`);
await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(htmlPath, renderMeasureHtml(report), "utf8");

console.log("");
for (const line of summaryLines(report)) console.log(line);
if (report.failedRatings.length) console.log(`failed ratings: ${report.failedRatings.map((f) => f.roadmapId).join(", ")}`);
console.log(`answering models: ${Object.entries(report.answeringModels).map(([m, c]) => `${m} (${c})`).join(", ") || "none"}`);
console.log(`ratings  ${ratingsPath}`);
console.log(`report   ${jsonPath}`);
console.log(`html     ${htmlPath}`);

function createModel(p: RelevanceProfile, now: () => Date): RatingModel {
  if (values.rater === "stub") return new StubRatingModel();
  const client = new NightshiftClient({
    baseUrl: requireEnv("METERLESS_BASE_URL"),
    token: requireEnv("METERLESS_RUNTIME_TOKEN"),
    model: requireEnv("METERLESS_MODEL"),
    app: requireEnv("METERLESS_APP"),
    scope: requireEnv("METERLESS_SCOPE"),
    timeoutMs: intEnv("NIGHTSHIFT_TIMEOUT_MS", DEFAULT_NIGHTSHIFT_TIMEOUT_MS),
  });
  // Measurement runs never enforce the model: Nightshift routes regardless of the requested id.
  return new NightshiftRatingModel(client, {
    profile: p,
    language: stringEnv("RATING_LANGUAGE", DEFAULT_RATING_LANGUAGE),
    strictModel: false,
    now,
  });
}

async function rateOnce(m: RatingModel, item: Parameters<RatingModel["rate"]>[0]): Promise<RatingOutcome> {
  const measuredAt = new Date().toISOString();
  try {
    return { ok: true, rating: await m.rate(item), measuredAt };
  } catch (err) {
    const attempts = err instanceof RatingFailedError ? err.attempts : 1;
    return { ok: false, error: err instanceof Error ? err.message : String(err), attempts, measuredAt };
  }
}
