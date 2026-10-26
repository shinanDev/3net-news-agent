import assert from "node:assert/strict";
import { test } from "node:test";
import type { M365Details, NewsItem, Rating } from "../src/domain/types.ts";
import {
  buildReport,
  metrics,
  parseTestset,
  predict,
  prefilterAt,
  ratingKey,
  renderMeasureHtml,
  summaryLines,
  type ItemResult,
  type TestItem,
} from "../src/measure/testsets.ts";

const OUT_OF_SCOPE = { prefixes: ["Dynamics 365"], exact: [] };

function item(id: string, status: string, m365: Partial<M365Details> = {}): NewsItem {
  return {
    id: `m365:${id}`,
    source: "test",
    title: `Item ${id}`,
    summary: "",
    url: `https://example.com/${id}`,
    status,
    tags: [],
    fetchedAt: "2026-10-23T08:00:00.000Z",
    raw: null,
    m365: {
      products: ["Microsoft Teams"],
      platforms: [],
      cloudInstances: ["Worldwide (Standard Multi-Tenant)"],
      gaMonth: null,
      previewMonth: null,
      modifiedAt: "2025-01-01T00:00:00Z",
      ...m365,
    },
  };
}

function testItem(roadmapId: string, label: boolean, round = 1, ratedOn = "2026-10-16"): TestItem {
  return { roadmapId, label, ratedOn, round, file: "fixture.json" };
}

function rating(score: number): Rating {
  return {
    itemId: "x",
    score,
    reasoning: `reason ${score}`,
    sourceUrl: "https://example.com/x",
    model: "test/model",
    ratedAt: "2026-10-16T12:00:00.000Z",
    components: { baseValue: 4, actionBonus: 1, excluded: false, products: ["Microsoft Teams"] },
    meta: {
      durationMs: 1,
      callDurationsMs: [1],
      attempts: 1,
      responseModel: "other/model",
      routedModel: "other/model",
      latencyMs: 1,
      receiptId: "rcpt_test",
      receiptSignature: null,
      discardedChars: 0,
      warnings: [],
    },
  };
}

function result(t: TestItem, kept: Record<number, boolean>, score?: number | "failed"): ItemResult {
  const r: ItemResult = {
    test: t,
    inSnapshot: true,
    modifiedAfterRating: false,
    modifiedAt: null,
    prefilter: Object.fromEntries(
      Object.entries(kept).map(([m, k]) => [
        Number(m),
        { itemId: t.roadmapId, kept: k, ruleId: k ? "all" : "VF-HORIZONT", reason: k ? "passed all rules" : "GA beyond horizon" },
      ]),
    ),
  };
  if (score === "failed") r.rating = { ok: false, error: "invalid answer twice", attempts: 2, measuredAt: "t" };
  else if (score !== undefined) r.rating = { ok: true, rating: rating(score), measuredAt: "t" };
  return r;
}

test("parseTestset accepts valid entries and numeric ids", () => {
  const items = parseTestset(
    [
      { roadmapId: "575288", label: true, ratedOn: "2026-10-16", round: 1, title: "A" },
      { roadmapId: 574094, label: false, ratedOn: "2026-10-19", round: 2 },
    ],
    "r.json",
  );
  assert.deepEqual(items[0], { roadmapId: "575288", label: true, ratedOn: "2026-10-16", round: 1, title: "A", file: "r.json" });
  assert.equal(items[1]!.roadmapId, "574094");
  assert.equal(items[1]!.title, undefined);
});

test("parseTestset rejects invalid entries with file and index", () => {
  assert.throws(() => parseTestset({}, "r.json"), /r\.json: expected a JSON array/);
  const valid = { roadmapId: "1", label: true, ratedOn: "2026-10-16", round: 1 };
  assert.throws(() => parseTestset([valid, { ...valid, label: "yes" }], "r.json"), /r\.json\[1\]: label/);
  assert.throws(() => parseTestset([{ ...valid, ratedOn: "16.10.2026" }], "r.json"), /ratedOn/);
  assert.throws(() => parseTestset([{ ...valid, roadmapId: "abc" }], "r.json"), /roadmapId/);
  assert.throws(() => parseTestset([{ ...valid, round: 1.5 }], "r.json"), /round/);
});

test("prefilterAt uses the rating date for VF-HORIZONT and ignores VF-NEU", () => {
  // Old modified date would fail VF-NEU; it is disabled here.
  const ga2027 = item("1", "In development", { gaMonth: "2027-01" });
  assert.equal(prefilterAt(ga2027, "2026-10-16", 3, OUT_OF_SCOPE).kept, true);
  const ga2027Feb = item("2", "In development", { gaMonth: "2027-02" });
  const m3 = prefilterAt(ga2027Feb, "2026-10-16", 3, OUT_OF_SCOPE);
  assert.equal(m3.kept, false);
  assert.equal(m3.ruleId, "VF-HORIZONT");
  assert.equal(prefilterAt(ga2027Feb, "2026-10-16", 4, OUT_OF_SCOPE).kept, true);
  // The same item rated a month later is within M=3.
  assert.equal(prefilterAt(ga2027Feb, "2026-11-16", 3, OUT_OF_SCOPE).kept, true);
  const dynamics = item("3", "Launched", { products: ["Dynamics 365 Sales"] });
  assert.equal(prefilterAt(dynamics, "2026-10-16", 3, OUT_OF_SCOPE).ruleId, "VF-PRODUCT");
});

test("metrics computes the confusion matrix and null for empty denominators", () => {
  const m = metrics([
    { label: true, predicted: true },
    { label: true, predicted: false },
    { label: false, predicted: true },
    { label: false, predicted: false },
    { label: false, predicted: false },
  ]);
  assert.deepEqual(m, { tp: 1, fp: 1, fn: 1, tn: 2, n: 5, recall: 0.5, precision: 0.5, accuracy: 0.6 });
  const none = metrics([{ label: false, predicted: false }]);
  assert.equal(none.recall, null);
  assert.equal(none.precision, null);
  assert.equal(none.accuracy, 1);
  assert.equal(metrics([]).accuracy, null);
});

test("predict needs the prefilter pass and a score at the threshold; failed ratings are not relevant", () => {
  assert.equal(predict(result(testItem("1", true), { 3: true }, 5), 3, 5), true);
  assert.equal(predict(result(testItem("1", true), { 3: true }, 4), 3, 5), false);
  assert.equal(predict(result(testItem("1", true), { 3: false, 4: true }, 9), 3, 5), false);
  assert.equal(predict(result(testItem("1", true), { 3: false, 4: true }, 9), 4, 5), true);
  assert.equal(predict(result(testItem("1", true), { 3: true }, "failed"), 3, 5), false);
});

test("buildReport groups by round and horizon and explains every disagreement", () => {
  const results: ItemResult[] = [
    result(testItem("10", true, 1), { 3: false, 4: true }, 8), // FN at M=3 (prefilter), TP at M=4
    result(testItem("11", false, 1), { 3: true, 4: true }, 6), // FP (rating)
    result(testItem("12", true, 2, "2026-10-19"), { 3: true, 4: true }, "failed"), // FN (rating failed)
    result(testItem("13", false, 2, "2026-10-19"), { 3: true, 4: true }, 2), // TN
    { test: testItem("14", true, 2, "2026-10-19"), inSnapshot: false, modifiedAfterRating: false, modifiedAt: null, prefilter: {} },
  ];
  const report = buildReport(results, {
    generatedAt: "2026-10-26T10:00:00.000Z",
    snapshot: "snap.json",
    rater: "stub",
    scoreThreshold: 5,
    horizons: [3, 4],
    testsetFiles: ["fixture.json"],
  });

  assert.deepEqual(
    report.groups.map((g) => `${g.name} M=${g.horizonMonths}`),
    ["round 1 M=3", "round 1 M=4", "round 2 M=3", "round 2 M=4", "combined M=3", "combined M=4"],
  );
  assert.match(report.groups[0]!.description, /calibration set \(prefilter rules were derived from it\)/);
  assert.equal(report.groups[2]!.description, "holdout set");

  const r1m3 = report.groups[0]!;
  assert.deepEqual([r1m3.metrics.tp, r1m3.metrics.fp, r1m3.metrics.fn, r1m3.metrics.tn], [0, 1, 1, 0]);
  const pre = r1m3.disagreements.find((d) => d.roadmapId === "10")!;
  assert.equal(pre.stage, "prefilter");
  assert.equal(pre.ruleId, "VF-HORIZONT");
  const fp = r1m3.disagreements.find((d) => d.roadmapId === "11")!;
  assert.equal(fp.kind, "false positive");
  assert.equal(fp.score, 6);
  assert.equal(fp.reasoning, "reason 6");
  assert.equal(fp.components?.baseValue, 4);
  assert.equal(report.groups[1]!.metrics.tp, 1);

  // The missing item is listed, not counted.
  assert.equal(report.groups[2]!.metrics.n, 2);
  assert.deepEqual(report.notInSnapshot.map((t) => t.roadmapId), ["14"]);
  assert.equal(report.groups[2]!.disagreements[0]!.stage, "rating failed");
  assert.deepEqual(report.failedRatings, [{ roadmapId: "12", ratedOn: "2026-10-19", error: "invalid answer twice", attempts: 2 }]);
  assert.equal(report.groups[4]!.metrics.n, 4);
  assert.deepEqual(report.answeringModels, { "other/model": 3 });

  const lines = summaryLines(report);
  assert.equal(lines.length, 6);
  assert.match(lines[2]!, /round 2\s+M=3\s+n= 2\s+TP=0 FP=0 FN=1 TN=1\s+recall=0% precision=n\/a accuracy=50%/);
});

test("renderMeasureHtml escapes model and source text", () => {
  const r = result(testItem("11", false), { 3: true }, 6);
  if (r.rating?.ok) r.rating.rating.reasoning = "<script>alert(1)</script>";
  r.test.title = "A & B";
  const report = buildReport([r], {
    generatedAt: "t",
    snapshot: "s",
    rater: "stub",
    scoreThreshold: 5,
    horizons: [3],
    testsetFiles: ["f"],
  });
  const html = renderMeasureHtml(report);
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("A &amp; B"));
  assert.ok(html.includes("holdout set") === false);
  assert.ok(html.includes("calibration set"));
  assert.ok(html.includes("<h2>Validity notes</h2>"));
  assert.ok(html.includes("VF-HORIZONT counts whole months inclusive; this was decided on 2026-10-23"));
  assert.deepEqual(report.validityNotes.length, 3);
});

test("ratingKey separates rating dates", () => {
  assert.notEqual(ratingKey(testItem("1", true, 1, "2026-10-16")), ratingKey(testItem("1", true, 2, "2026-10-19")));
});
