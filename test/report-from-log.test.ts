import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { ConsoleOutput, InMemoryMemoryStore, sampleItems, StubNewsSource, StubRatingModel } from "../src/adapters/stub/stubs.ts";
import type { RunLog } from "../src/domain/types.ts";
import { reportFromRunLog } from "../src/pipeline/report-from-log.ts";
import { runPipeline } from "../src/pipeline/run.ts";

let runsDir: string;
before(async () => {
  runsDir = await mkdtemp(join(tmpdir(), "news-agent-replay-"));
});
after(async () => {
  await rm(runsDir, { recursive: true, force: true });
});

test("the report rebuilt from the run log matches the report of the run", async () => {
  const items = sampleItems();
  const output = new ConsoleOutput(true);
  const { logPath } = await runPipeline(
    {
      source: new StubNewsSource(items),
      memory: new InMemoryMemoryStore(),
      model: new StubRatingModel({ "stub:1": 4, "stub:2": 8 }),
      output,
    },
    { runsDir, periodDays: 30, warn: () => {} },
  );
  const log = JSON.parse(await readFile(logPath, "utf8")) as RunLog;
  const original = output.report!;
  const rebuilt = reportFromRunLog(log, items);

  assert.equal(rebuilt.runId, original.runId);
  assert.deepEqual(rebuilt.period, original.period);
  assert.equal(rebuilt.ratingModel, original.ratingModel);
  assert.deepEqual(rebuilt.entries, original.entries);
  assert.deepEqual(rebuilt.belowThreshold, original.belowThreshold);
  assert.deepEqual(rebuilt.failed, original.failed);
  assert.equal(rebuilt.maintenance, undefined);
});

test("missing items and older logs without period", () => {
  const log: RunLog = {
    runId: "r1",
    startedAt: "2026-10-26T09:00:00.000Z",
    scoreThreshold: 5,
    stages: [
      {
        stage: "rate",
        startedAt: "2026-10-26T09:00:00.000Z",
        durationMs: 1,
        inputCount: 1,
        outputCount: 1,
        details: { model: "m", ratings: [{ itemId: "stub:9", score: 8, reasoning: "r", sourceUrl: "u", model: "m", ratedAt: "t" }], failed: [] },
      },
    ],
  };
  assert.throws(() => reportFromRunLog(log, sampleItems()), /stub:9 from the run log is not in the given items/);
  const withItem = { ...log, stages: [{ ...log.stages[0]!, details: { model: "m", ratings: [], failed: [] } }] };
  assert.equal(reportFromRunLog(withItem, []).period, undefined);
  assert.deepEqual(reportFromRunLog(withItem, [], { periodDays: 1 }).period, {
    from: "2026-10-25T09:00:00.000Z",
    to: "2026-10-26T09:00:00.000Z",
  });
});
