import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { answeringModel, esc, HtmlFileOutput, renderHtml } from "../src/adapters/html/html-file-output.ts";
import { ConsoleOutput, InMemoryMemoryStore, StubNewsSource, StubRatingModel } from "../src/adapters/stub/stubs.ts";
import type { NewsItem, Rating, RatingMeta } from "../src/domain/types.ts";
import type { RunReport } from "../src/ports/output.ts";
import { runPipeline } from "../src/pipeline/run.ts";

let dir: string;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "news-agent-html-"));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

function item(id: string, title: string, url = `https://example.com/${id}`): NewsItem {
  return { id, source: "test", title, summary: "", url, status: "Rolling out", tags: [], fetchedAt: "2026-10-23T00:00:00Z", raw: null };
}

const META: RatingMeta = {
  durationMs: 1000,
  callDurationsMs: [1000],
  attempts: 1,
  responseModel: "vendor/response-model",
  routedModel: "vendor/routed-model",
  latencyMs: 900,
  receiptId: "rcpt-1",
  receiptSignature: "SIG",
  discardedChars: 0,
  warnings: [],
};

/** meta null: rating without meta (e.g. from the stub model). */
function rating(itemId: string, score: number, reasoning = "Because.", meta: RatingMeta | null = META): Rating {
  return {
    itemId,
    score,
    reasoning,
    sourceUrl: "",
    model: "vendor/requested",
    ratedAt: "2026-10-23T00:00:00Z",
    components: { baseValue: 7, actionBonus: 1, excluded: false, products: ["Teams"] },
    ...(meta && { meta }),
  };
}

function report(overrides: Partial<RunReport> = {}): RunReport {
  return {
    runId: "2026-10-23T10-00-00-000Z",
    generatedAt: "2026-10-23T10:05:00.000Z",
    source: "test-source",
    scoreThreshold: 5,
    ratingModel: "vendor/requested",
    entries: [],
    belowThreshold: [],
    failed: [],
    prefilter: { input: 10, kept: 3, droppedByRule: { "VF-NEU": 5, "VF-PRODUCT": 2 }, warnings: [] },
    alreadyReported: [],
    ...overrides,
  };
}

test("all sections are present, also when empty", () => {
  const html = renderHtml(report());
  for (const heading of ["Above threshold (0)", "Rated below threshold (0)", "Rating failed (0)", "Prefilter"]) {
    assert.ok(html.includes(heading), heading);
  }
  assert.ok(html.includes("<tr><td>Dropped by VF-NEU</td><td>5</td></tr>"));
  assert.ok(html.includes("<tr><td>Passed prefilter</td><td>3</td></tr>"));
  assert.ok(html.includes("Answering models: none"));
});

test("items show score, components, reasoning, answering model and link", () => {
  const above = item("a", "Teams: recap");
  const below = item("b", "Word: tweak");
  const failed = item("c", "Outlook: change");
  const html = renderHtml(
    report({
      entries: [{ item: above, rating: rating("a", 8), summary: { itemId: "a", text: "", model: "", summarisedAt: "" } }],
      belowThreshold: [{ item: below, rating: rating("b", 3, "Minor.") }],
      failed: [{ item: failed, error: "rating failed: timeout", attempts: 2 }],
    }),
  );
  assert.ok(html.includes('<a href="https://example.com/a">Teams: recap</a>'));
  assert.ok(html.includes("Score: 8"));
  assert.ok(html.includes("base 7, bonus 1, excluded false, products Teams"));
  assert.ok(html.includes("Model: vendor/routed-model"));
  assert.ok(html.includes("Receipt: rcpt-1"));
  assert.ok(html.includes("Answering models: vendor/routed-model (2)"));
  assert.ok(html.includes("<td>3</td><td><a href=\"https://example.com/b\">Word: tweak</a></td>"));
  assert.ok(html.includes("<td>Minor.</td>"));
  assert.ok(html.includes("rating failed: timeout"));
  assert.ok(html.includes("<tr><td>Sent to model</td><td>3</td></tr>"));
  assert.ok(!html.includes("SIG"), "receipt signature is not shown");
});

test("text from sources and the model is escaped, only http(s) URLs are linked", () => {
  const evil = item("x", '<script>alert("t")</script>', "javascript:alert(1)");
  const html = renderHtml(
    report({ belowThreshold: [{ item: evil, rating: rating("x", 1, "<img src=x onerror=alert(1)>") }] }),
  );
  assert.ok(!html.includes("<script>alert"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes("javascript:"));
  assert.ok(html.includes("&lt;script&gt;alert(&quot;t&quot;)&lt;/script&gt;"));
  assert.equal(esc(`a&b<c>"d"'e'`), "a&amp;b&lt;c&gt;&quot;d&quot;&#39;e&#39;");
});

test("selected items section appears only with RATE_ITEM_IDS", () => {
  assert.ok(!renderHtml(report()).includes("Selected items"));
  const html = renderHtml(
    report({
      prefilter: {
        input: 2,
        kept: 1,
        droppedByRule: { RATE_ITEM_IDS: 0, "VF-CLOUD": 1 },
        warnings: [],
        selected: [
          { itemId: "m365:1", kept: true, ruleId: "all", reason: "passed all rules" },
          { itemId: "m365:2", kept: false, ruleId: "VF-CLOUD", reason: "no Worldwide cloud (GCC)" },
        ],
      },
    }),
  );
  assert.ok(html.includes("Selected items (RATE_ITEM_IDS)"));
  assert.ok(html.includes("<tr><td>m365:2</td><td>dropped</td><td>VF-CLOUD</td><td>no Worldwide cloud (GCC)</td></tr>"));
});

test("answering model falls back to response model, then configured model", () => {
  assert.equal(answeringModel(rating("a", 1)), "vendor/routed-model");
  assert.equal(answeringModel(rating("a", 1, "x", { ...META, routedModel: null })), "vendor/response-model");
  assert.equal(answeringModel(rating("a", 1, "x", null)), "vendor/requested");
});

test("pipeline writes the report file with numbers from the stages", async () => {
  const output = new HtmlFileOutput({ outDir: dir });
  // Stub items: 1 and 2 valid, 3 without title. Item 1 scores 7, item 2 scores 2.
  await runPipeline(
    {
      source: new StubNewsSource(),
      memory: new InMemoryMemoryStore(),
      model: new StubRatingModel({ "stub:1": 7, "stub:2": 2 }),
      output,
    },
    { runsDir: dir, now: () => new Date("2026-10-23T12:00:00.000Z") },
  );
  assert.equal(output.lastPath, join(dir, "2026-10-23T12-00-00-000Z.html"));
  const html = await readFile(output.lastPath!, "utf8");
  assert.ok(html.includes("Above threshold (1)"));
  assert.ok(html.includes("Rated below threshold (1)"));
  assert.ok(html.includes("<tr><td>Dropped by required-fields</td><td>1</td></tr>"));
  assert.ok(html.includes("Source: stub"));
});

test("console output receives the same report", async () => {
  const output = new ConsoleOutput(true);
  await runPipeline(
    { source: new StubNewsSource(), memory: new InMemoryMemoryStore(), model: new StubRatingModel({ "stub:2": 1 }), output },
    { runsDir: dir },
  );
  assert.equal(output.report!.belowThreshold.length, 1);
  assert.equal(output.report!.entries.length, 1);
  assert.equal(output.report!.prefilter.input, 3);
});
