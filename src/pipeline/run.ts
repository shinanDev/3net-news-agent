// Pipeline: ingest -> prefilter -> memory check -> rate -> summarise -> output.
// Every stage is recorded in data/runs/<timestamp>.json, also when a stage fails.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { NewsItem, Rating, RunLog, StageLog, StageName } from "../domain/types.ts";
import type { MemoryStore } from "../ports/memory-store.ts";
import type { NewsSource } from "../ports/news-source.ts";
import type { Output, ReportEntry } from "../ports/output.ts";
import type { RatingModel } from "../ports/rating-model.ts";
import { prefilter, type FilterRule } from "./prefilter.ts";

export interface PipelineDeps {
  source: NewsSource;
  memory: MemoryStore;
  model: RatingModel;
  output: Output;
}

export interface RunOptions {
  /** Items with a score at or above this value are summarised and reported. */
  scoreThreshold?: number;
  rules?: FilterRule[];
  /** VF-LIMIT: at most this many items go to the model. Default: unlimited. */
  maxItems?: number;
  warn?: (message: string) => void;
  /** Directory for run logs. Default: data/runs */
  runsDir?: string;
  now?: () => Date;
}

export interface RunResult {
  log: RunLog;
  logPath: string;
  entries: ReportEntry[];
}

export const DEFAULT_SCORE_THRESHOLD = 5;

export async function runPipeline(deps: PipelineDeps, options: RunOptions = {}): Promise<RunResult> {
  const now = options.now ?? (() => new Date());
  const scoreThreshold = options.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD;
  const runsDir = options.runsDir ?? join("data", "runs");
  const startedAt = now().toISOString();
  // Windows does not allow ":" in file names.
  const runId = startedAt.replace(/[:.]/g, "-");
  const log: RunLog = { runId, startedAt, scoreThreshold, stages: [] };
  const logPath = join(runsDir, `${runId}.json`);

  async function stage<T>(
    name: StageName,
    inputCount: number,
    fn: () => Promise<{ result: T; outputCount: number; details: unknown }>,
  ): Promise<T> {
    const t0 = now();
    const { result, outputCount, details } = await fn();
    const entry: StageLog = {
      stage: name,
      startedAt: t0.toISOString(),
      durationMs: now().getTime() - t0.getTime(),
      inputCount,
      outputCount,
      details,
    };
    log.stages.push(entry);
    return result;
  }

  let entries: ReportEntry[] = [];
  try {
    const fetched = await stage("ingest", 0, async () => {
      const items = await deps.source.fetch();
      return { result: items, outputCount: items.length, details: { source: deps.source.name } };
    });

    const filtered = await stage("prefilter", fetched.length, async () => {
      const { kept, decisions, droppedByRule, warnings } = prefilter(fetched, {
        ...(options.rules && { rules: options.rules }),
        ...(options.maxItems !== undefined && { maxItems: options.maxItems }),
      });
      const warn = options.warn ?? ((m: string) => console.warn(`warning: ${m}`));
      warnings.forEach(warn);
      return { result: kept, outputCount: kept.length, details: { droppedByRule, warnings, decisions } };
    });

    const fresh = await stage("memory", filtered.length, async () => {
      const kept: NewsItem[] = [];
      const alreadyReported: string[] = [];
      for (const item of filtered) {
        if (await deps.memory.wasReported(item)) alreadyReported.push(item.id);
        else kept.push(item);
      }
      return { result: kept, outputCount: kept.length, details: { alreadyReported } };
    });

    const rated = await stage("rate", fresh.length, async () => {
      const pairs: { item: NewsItem; rating: Rating }[] = [];
      for (const item of fresh) pairs.push({ item, rating: await deps.model.rate(item) });
      const above = pairs.filter((p) => p.rating.score >= scoreThreshold);
      return {
        result: above,
        outputCount: above.length,
        details: { model: deps.model.model, ratings: pairs.map((p) => p.rating) },
      };
    });

    entries = await stage("summarise", rated.length, async () => {
      const result: ReportEntry[] = [];
      for (const p of rated) result.push({ ...p, summary: await deps.model.summarise(p.item) });
      return { result, outputCount: result.length, details: { summaries: result.map((e) => e.summary) } };
    });

    await stage("output", entries.length, async () => {
      await deps.output.render(entries);
      // Mark as reported only after the draft was rendered.
      for (const e of entries) await deps.memory.markReported(e.item);
      return { result: undefined, outputCount: entries.length, details: { reported: entries.map((e) => e.item.id) } };
    });
  } catch (err) {
    log.error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    throw err;
  } finally {
    log.finishedAt = now().toISOString();
    await mkdir(runsDir, { recursive: true });
    await writeFile(logPath, JSON.stringify(log, null, 2) + "\n", "utf8");
  }

  return { log, logPath, entries };
}
