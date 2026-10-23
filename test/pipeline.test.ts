import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import {
  ConsoleOutput,
  InMemoryMemoryStore,
  StubNewsSource,
  StubRatingModel,
} from "../src/adapters/stub/stubs.ts";
import type { NewsItem, RunLog } from "../src/domain/types.ts";
import type { NewsSource } from "../src/ports/news-source.ts";
import { runPipeline } from "../src/pipeline/run.ts";

let runsDir: string;
before(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "news-agent-runs-"));
});
after(async () => {
  await rm(runsDir, { recursive: true, force: true });
});

test("runs all stages with stubs and writes the run log", async () => {
  // Sample items: 1 and 2 are valid, 3 has no title. Item 1 was reported before; item 2 scores 7.
  const output = new ConsoleOutput(true);
  const memory = new InMemoryMemoryStore(["https://example.com/items/1"]);
  const { log, logPath, entries } = await runPipeline(
    { source: new StubNewsSource(), memory, model: new StubRatingModel({ "stub:2": 7 }), output },
    { runsDir },
  );

  assert.deepEqual(
    log.stages.map((s) => [s.stage, s.inputCount, s.outputCount]),
    [
      ["ingest", 0, 3],
      ["prefilter", 3, 2],
      ["memory", 2, 1],
      ["rate", 1, 1],
      ["summarise", 1, 1],
      ["output", 1, 1],
    ],
  );
  assert.deepEqual(entries.map((e) => e.item.id), ["stub:2"]);
  assert.equal(output.entries.length, 1);
  assert.equal(await memory.wasReported(entries[0]!.item), true);

  const written = JSON.parse(await readFile(logPath, "utf8")) as RunLog;
  assert.equal(written.runId, log.runId);
  assert.equal(written.stages.length, 6);
  assert.ok(!logPath.includes(":", 2), "file name must not contain ':'");
});

test("drops items below the score threshold", async () => {
  const { entries, log } = await runPipeline(
    {
      source: new StubNewsSource(),
      memory: new InMemoryMemoryStore(),
      model: new StubRatingModel({ "stub:1": 4, "stub:2": 5 }),
      output: new ConsoleOutput(true),
    },
    { runsDir, scoreThreshold: 5, now: fixedClock("2026-10-23T10:00:00.000Z") },
  );
  assert.deepEqual(entries.map((e) => e.item.id), ["stub:2"]);
  assert.equal(log.runId, "2026-10-23T10-00-00-000Z");
});

test("writes the run log with the error when a stage fails", async () => {
  const failing: NewsSource = {
    name: "failing",
    fetch: async (): Promise<NewsItem[]> => {
      throw new Error("source unavailable");
    },
  };
  const now = fixedClock("2026-10-23T11:00:00.000Z");
  await assert.rejects(
    runPipeline(
      { source: failing, memory: new InMemoryMemoryStore(), model: new StubRatingModel(), output: new ConsoleOutput(true) },
      { runsDir, now },
    ),
    /source unavailable/,
  );
  const written = JSON.parse(
    await readFile(join(runsDir, "2026-10-23T11-00-00-000Z.json"), "utf8"),
  ) as RunLog;
  assert.equal(written.error, "Error: source unavailable");
  assert.equal(written.stages.length, 0);
});

test("rejects scores outside 0-10", async () => {
  const [item] = await new StubNewsSource().fetch();
  const model = new StubRatingModel({ "stub:1": 11 });
  await assert.rejects(model.rate(item!), RangeError);
});

function fixedClock(iso: string): () => Date {
  return () => new Date(iso);
}
