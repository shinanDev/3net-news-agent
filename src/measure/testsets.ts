// Test-set measurement: compares the agent's decision ("relevant" = passes the prefilter and
// scores at or above the threshold) with labels from a human rating round.
// Pure functions only; scripts/measure-testsets.ts does the file I/O and the model calls.

import { esc } from "../adapters/html/html-file-output.ts";
import type { OutOfScopeProducts } from "../domain/profile.ts";
import type { FilterDecision, NewsItem, Rating } from "../domain/types.ts";
import { m365Rules, prefilter, requiredFields } from "../pipeline/prefilter.ts";

export interface TestItem {
  roadmapId: string;
  label: boolean;
  /** YYYY-MM-DD */
  ratedOn: string;
  round: number;
  title?: string;
  /** Test set file the item came from. */
  file: string;
}

export const ROUND_LABELS: Record<number, string> = {
  1: "calibration set (prefilter rules were derived from it)",
  2: "holdout set",
};

/** Limits of the measurement, shown in the report. */
export const VALIDITY_NOTES: string[] = [
  "Round 1 is the calibration set: the prefilter rules were derived from it, so its prefilter result is not independent.",
  "VF-HORIZONT counts whole months inclusive; this was decided on 2026-10-23, after the holdout case 573696 (GA 2027-01) was known, so the holdout result for that rule is not fully independent.",
  "The snapshot shows the roadmap at its own date, not at the rating date; items modified after the rating date are listed below.",
];

export function roundLabel(round: number): string {
  return ROUND_LABELS[round] ?? `round ${round}`;
}

/** Validates one test set file; throws with file name and index on the first invalid entry. */
export function parseTestset(data: unknown, file: string): TestItem[] {
  if (!Array.isArray(data)) throw new Error(`${file}: expected a JSON array`);
  return data.map((entry, i) => {
    const where = `${file}[${i}]`;
    if (!entry || typeof entry !== "object") throw new Error(`${where}: expected an object`);
    const e = entry as Record<string, unknown>;
    const roadmapId = typeof e["roadmapId"] === "number" ? String(e["roadmapId"]) : e["roadmapId"];
    if (typeof roadmapId !== "string" || !/^\d+$/.test(roadmapId)) throw new Error(`${where}: invalid roadmapId`);
    if (typeof e["label"] !== "boolean") throw new Error(`${where}: label must be true or false`);
    const ratedOn = e["ratedOn"];
    if (typeof ratedOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(ratedOn) || Number.isNaN(ratingDate(ratedOn).getTime())) {
      throw new Error(`${where}: ratedOn must be YYYY-MM-DD`);
    }
    if (typeof e["round"] !== "number" || !Number.isInteger(e["round"])) throw new Error(`${where}: round must be an integer`);
    const item: TestItem = { roadmapId, label: e["label"], ratedOn, round: e["round"], file };
    if (typeof e["title"] === "string") item.title = e["title"];
    return item;
  });
}

/** Noon UTC on the rating day, so the day and month are the same in every time zone used here. */
export function ratingDate(ratedOn: string): Date {
  return new Date(`${ratedOn}T12:00:00.000Z`);
}

/** Ratings depend on the rating date (rubric "within 7 days"), not on the horizon. */
export function ratingKey(t: Pick<TestItem, "roadmapId" | "ratedOn">): string {
  return `${t.roadmapId}|${t.ratedOn}`;
}

/** Prefilter as of the rating date: VF-NEU disabled, VF-LIMIT off. */
export function prefilterAt(
  item: NewsItem,
  ratedOn: string,
  horizonMonths: number,
  outOfScopeProducts: OutOfScopeProducts,
): FilterDecision {
  const rules = [
    requiredFields,
    ...m365Rules({ now: ratingDate(ratedOn), newDays: null, horizonMonths, outOfScopeProducts }),
  ];
  return prefilter([item], { rules }).decisions[0]!;
}

export type RatingOutcome =
  | { ok: true; rating: Rating; measuredAt: string }
  | { ok: false; error: string; attempts: number; measuredAt: string };

export interface ItemResult {
  test: TestItem;
  inSnapshot: boolean;
  /** Snapshot item was modified after the rating date: status or GA month may differ from what the rater saw. */
  modifiedAfterRating: boolean;
  modifiedAt: string | null;
  /** Prefilter decision per horizon (key: months). */
  prefilter: Record<number, FilterDecision>;
  rating?: RatingOutcome;
}

export interface Confusion {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

export interface Metrics extends Confusion {
  n: number;
  /** Recall on "relevant"; null if the set has no relevant item. */
  recall: number | null;
  /** null if the agent marked nothing as relevant. */
  precision: number | null;
  accuracy: number | null;
}

export function metrics(rows: { label: boolean; predicted: boolean }[]): Metrics {
  const c: Confusion = { tp: 0, fp: 0, fn: 0, tn: 0 };
  for (const r of rows) {
    if (r.label && r.predicted) c.tp++;
    else if (!r.label && r.predicted) c.fp++;
    else if (r.label) c.fn++;
    else c.tn++;
  }
  const ratio = (a: number, b: number) => (b === 0 ? null : a / b);
  const n = rows.length;
  return { ...c, n, recall: ratio(c.tp, c.tp + c.fn), precision: ratio(c.tp, c.tp + c.fp), accuracy: ratio(c.tp + c.tn, n) };
}

/** Failed ratings count as "not relevant": the agent would not have reported the item. */
export function predict(r: ItemResult, horizonMonths: number, threshold: number): boolean {
  const d = r.prefilter[horizonMonths];
  if (!d?.kept) return false;
  return r.rating?.ok === true && r.rating.rating.score >= threshold;
}

export interface Disagreement {
  roadmapId: string;
  title?: string;
  label: boolean;
  kind: "false negative" | "false positive";
  stage: "prefilter" | "rating" | "rating failed" | "not rated";
  ruleId?: string;
  reason?: string;
  score?: number;
  components?: Rating["components"];
  reasoning?: string;
  error?: string;
  modifiedAfterRating: boolean;
}

export interface Group {
  /** "round 1", "round 2", ..., "combined" */
  name: string;
  description: string;
  horizonMonths: number;
  metrics: Metrics;
  disagreements: Disagreement[];
}

export interface MeasureReport {
  generatedAt: string;
  snapshot: string;
  rater: string;
  scoreThreshold: number;
  horizons: number[];
  testsetFiles: string[];
  validityNotes: string[];
  groups: Group[];
  notInSnapshot: TestItem[];
  failedRatings: { roadmapId: string; ratedOn: string; error: string; attempts: number }[];
  modifiedAfterRating: { roadmapId: string; ratedOn: string; modifiedAt: string | null }[];
  answeringModels: Record<string, number>;
  items: ItemResult[];
}

export function disagreement(r: ItemResult, horizonMonths: number, threshold: number): Disagreement | null {
  const predicted = predict(r, horizonMonths, threshold);
  if (predicted === r.test.label) return null;
  const d: Disagreement = {
    roadmapId: r.test.roadmapId,
    label: r.test.label,
    kind: r.test.label ? "false negative" : "false positive",
    stage: "rating",
    modifiedAfterRating: r.modifiedAfterRating,
  };
  if (r.test.title) d.title = r.test.title;
  const f = r.prefilter[horizonMonths]!;
  if (!f.kept) return { ...d, stage: "prefilter", ruleId: f.ruleId, reason: f.reason };
  if (!r.rating) return { ...d, stage: "not rated" };
  if (!r.rating.ok) return { ...d, stage: "rating failed", error: r.rating.error };
  const { score, components, reasoning } = r.rating.rating;
  return { ...d, score, ...(components && { components }), reasoning };
}

export function buildReport(
  results: ItemResult[],
  meta: Pick<MeasureReport, "generatedAt" | "snapshot" | "rater" | "scoreThreshold" | "horizons" | "testsetFiles">,
): MeasureReport {
  const found = results.filter((r) => r.inSnapshot);
  const rounds = [...new Set(found.map((r) => r.test.round))].sort((a, b) => a - b);
  const sets = [
    ...rounds.map((n) => ({ name: `round ${n}`, description: roundLabel(n), rows: found.filter((r) => r.test.round === n) })),
    { name: "combined", description: `all rounds (${rounds.join(", ")})`, rows: found },
  ];
  const groups: Group[] = [];
  for (const set of sets) {
    for (const m of meta.horizons) {
      groups.push({
        name: set.name,
        description: set.description,
        horizonMonths: m,
        metrics: metrics(set.rows.map((r) => ({ label: r.test.label, predicted: predict(r, m, meta.scoreThreshold) }))),
        disagreements: set.rows.flatMap((r) => disagreement(r, m, meta.scoreThreshold) ?? []),
      });
    }
  }

  // One entry per rating, even if several test items share it.
  const ratings = new Map<string, RatingOutcome>();
  for (const r of found) if (r.rating) ratings.set(ratingKey(r.test), r.rating);
  const failedRatings = [...ratings.entries()].flatMap(([key, o]) => {
    if (o.ok) return [];
    const [roadmapId, ratedOn] = key.split("|") as [string, string];
    return [{ roadmapId, ratedOn, error: o.error, attempts: o.attempts }];
  });
  const answeringModels: Record<string, number> = {};
  for (const o of ratings.values()) {
    if (!o.ok) continue;
    const m = o.rating.meta?.routedModel ?? o.rating.meta?.responseModel ?? o.rating.model;
    answeringModels[m] = (answeringModels[m] ?? 0) + 1;
  }

  return {
    ...meta,
    validityNotes: VALIDITY_NOTES,
    groups,
    notInSnapshot: results.filter((r) => !r.inSnapshot).map((r) => r.test),
    failedRatings,
    modifiedAfterRating: found
      .filter((r) => r.modifiedAfterRating)
      .map((r) => ({ roadmapId: r.test.roadmapId, ratedOn: r.test.ratedOn, modifiedAt: r.modifiedAt })),
    answeringModels,
    items: results,
  };
}

function pct(v: number | null): string {
  return v === null ? "n/a" : `${(v * 100).toFixed(0)}%`;
}

export function summaryLines(r: MeasureReport): string[] {
  return r.groups.map((g) => {
    const m = g.metrics;
    return (
      `${g.name.padEnd(9)} M=${g.horizonMonths}  n=${String(m.n).padStart(2)}  TP=${m.tp} FP=${m.fp} FN=${m.fn} TN=${m.tn}  ` +
      `recall=${pct(m.recall)} precision=${pct(m.precision)} accuracy=${pct(m.accuracy)}  (${g.description})`
    );
  });
}

export function renderMeasureHtml(r: MeasureReport): string {
  const models = Object.entries(r.answeringModels);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Test set measurement ${esc(r.generatedAt)}</title>
<style>
body { font-family: sans-serif; max-width: 60rem; margin: 1rem auto; padding: 0 1rem; }
table { border-collapse: collapse; margin-bottom: 1rem; }
th, td { border: 1px solid #999; padding: 0.25rem 0.5rem; text-align: left; vertical-align: top; }
</style>
</head>
<body>
<h1>Test set measurement</h1>
<ul>
<li>Generated: ${esc(r.generatedAt)}</li>
<li>Snapshot: ${esc(r.snapshot)}</li>
<li>Test sets: ${r.testsetFiles.map(esc).join(", ")}</li>
<li>Rater: ${esc(r.rater)}</li>
<li>Agent says "relevant": passes the prefilter (rating date as reference, VF-NEU and VF-LIMIT off) and score &gt;= ${r.scoreThreshold}. Failed ratings count as "not relevant".</li>
<li>Answering models: ${models.length ? models.map(([m, n]) => `${esc(m)} (${n})`).join(", ") : "none"}</li>
</ul>

<h2>Validity notes</h2>
${list(r.validityNotes)}

<h2>Metrics</h2>
<table>
<tr><th>Set</th><th>M</th><th>n</th><th>TP</th><th>FP</th><th>FN</th><th>TN</th><th>Recall (relevant)</th><th>Precision</th><th>Accuracy</th></tr>
${r.groups
  .map(
    (g) =>
      `<tr><td>${esc(g.name)}: ${esc(g.description)}</td><td>${g.horizonMonths}</td><td>${g.metrics.n}</td>` +
      `<td>${g.metrics.tp}</td><td>${g.metrics.fp}</td><td>${g.metrics.fn}</td><td>${g.metrics.tn}</td>` +
      `<td>${pct(g.metrics.recall)}</td><td>${pct(g.metrics.precision)}</td><td>${pct(g.metrics.accuracy)}</td></tr>`,
  )
  .join("\n")}
</table>

<h2>Disagreements</h2>
${r.groups.filter((g) => g.name !== "combined").map(disagreementBlock).join("\n")}

<h2>Not in the snapshot (${r.notInSnapshot.length})</h2>
${list(r.notInSnapshot.map((t) => `${t.roadmapId} (round ${t.round}, ${t.ratedOn})${t.title ? `: ${t.title}` : ""}`))}

<h2>Failed ratings (${r.failedRatings.length})</h2>
${list(r.failedRatings.map((f) => `${f.roadmapId} (${f.ratedOn}), ${f.attempts} attempt(s): ${f.error}`))}

<h2>Modified after the rating date (${r.modifiedAfterRating.length})</h2>
<p>The snapshot may show a different status or GA month than the human rater saw.</p>
${list(r.modifiedAfterRating.map((m) => `${m.roadmapId}: rated ${m.ratedOn}, modified ${m.modifiedAt ?? "unknown"}`))}
</body>
</html>
`;
}

function disagreementBlock(g: Group): string {
  const head = `<h3>${esc(g.name)}, M=${g.horizonMonths} (${g.disagreements.length})</h3>`;
  if (!g.disagreements.length) return `${head}\n<p>None.</p>`;
  const rows = g.disagreements.map((d) => {
    const why =
      d.stage === "prefilter"
        ? `${esc(d.ruleId ?? "")}: ${esc(d.reason ?? "")}`
        : d.stage === "rating"
          ? `score ${d.score}${d.components ? ` (base ${d.components.baseValue}, action +${d.components.actionBonus}, excluded ${d.components.excluded}, products ${esc(d.components.products.join(", ") || "none")})` : ""}<br>${esc(d.reasoning ?? "")}`
          : esc(d.error ?? d.stage);
    return (
      `<tr><td>${esc(d.roadmapId)}${d.title ? `<br>${esc(d.title)}` : ""}</td><td>${d.kind}</td><td>${d.stage}</td>` +
      `<td>${why}${d.modifiedAfterRating ? "<br><em>modified after the rating date</em>" : ""}</td></tr>`
    );
  });
  return `${head}\n<table>\n<tr><th>Item</th><th>Kind</th><th>Stage</th><th>Why</th></tr>\n${rows.join("\n")}\n</table>`;
}

function list(lines: string[]): string {
  return lines.length ? `<ul>\n${lines.map((l) => `<li>${esc(l)}</li>`).join("\n")}\n</ul>` : "<p>None.</p>";
}
