// Pipeline: ingest -> prefilter -> memory check -> rate -> summarise -> (calendar) -> output.
// Every stage is recorded in data/runs/<timestamp>.json, also when a stage fails.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { NewsItem, Rating, RunLog, StageLog, StageName } from "../domain/types.ts";
import { computeWindow, isUpcoming, ruleText, type MaintenanceRule } from "../domain/maintenance-window.ts";
import type { MaintenanceCalendar } from "../ports/maintenance-calendar.ts";
import type { MemoryFinding, MemoryStore } from "../ports/memory-store.ts";
import type { NewsSource } from "../ports/news-source.ts";
import type { FailedRating, Output, RatedItem, ReportEntry, RunReport } from "../ports/output.ts";
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
  /** RATE_ITEM_IDS: only these item ids go to the model; VF-LIMIT does not apply. */
  onlyIds?: string[];
  /** MEMORY_MARK: remember reported items for later runs. Default false (check only). */
  markReported?: boolean;
  /** Maintenance calendar: upcoming windows go into the report. Absent: the stage is skipped. */
  maintenance?: { calendar: MaintenanceCalendar; rule: MaintenanceRule; lookaheadDays: number };
  /** News window in days (VF-NEU), shown as the run's date range. Absent: no range. */
  periodDays?: number;
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
const DAY_MS = 24 * 60 * 60 * 1000;

export async function runPipeline(deps: PipelineDeps, options: RunOptions = {}): Promise<RunResult> {
  const now = options.now ?? (() => new Date());
  const scoreThreshold = options.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD;
  const runsDir = options.runsDir ?? join("data", "runs");
  const warn = options.warn ?? ((m: string) => console.warn(`warning: ${m}`));
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

  // Collected along the stages for the run report.
  let entries: ReportEntry[] = [];
  let prefilterSummary: RunReport["prefilter"] = { input: 0, kept: 0, droppedByRule: {}, warnings: [] };
  let alreadyReported: RunReport["alreadyReported"] = [];
  let belowThreshold: RatedItem[] = [];
  const failedRatings: FailedRating[] = [];
  const byScore = (a: RatedItem, b: RatedItem) => b.rating.score - a.rating.score;
  try {
    const fetched = await stage("ingest", 0, async () => {
      const items = await deps.source.fetch();
      return { result: items, outputCount: items.length, details: { source: deps.source.name } };
    });

    const filtered = await stage("prefilter", fetched.length, async () => {
      const { kept, decisions, droppedByRule, warnings, selected } = prefilter(fetched, {
        ...(options.rules && { rules: options.rules }),
        ...(options.maxItems !== undefined && { maxItems: options.maxItems }),
        ...(options.onlyIds && { onlyIds: options.onlyIds }),
      });
      warnings.forEach(warn);
      for (const d of selected ?? []) {
        if (!d.kept && d.ruleId !== "not-found") warn(`${d.itemId}: selected but dropped by ${d.ruleId} (${d.reason})`);
      }
      prefilterSummary = { input: fetched.length, kept: kept.length, droppedByRule, warnings, ...(selected && { selected }) };
      return {
        result: kept,
        outputCount: kept.length,
        details: { droppedByRule, warnings, ...(selected && { selected }), decisions },
      };
    });

    const fresh = await stage("memory", filtered.length, async () => {
      const kept: NewsItem[] = [];
      const findings: ({ itemId: string } & MemoryFinding)[] = [];
      for (const item of filtered) {
        const finding = await deps.memory.wasReported(item);
        findings.push({ itemId: item.id, ...finding });
        if (finding.reported) alreadyReported.push({ item, finding });
        else kept.push(item);
      }
      return {
        result: kept,
        outputCount: kept.length,
        details: { alreadyReported: findings.filter((f) => f.reported), findings },
      };
    });

    const rated = await stage("rate", fresh.length, async () => {
      // A failed item gets no score, is not reported and not marked, so the next run retries it.
      const pairs: { item: NewsItem; rating: Rating }[] = [];
      const failed: { itemId: string; error: string; attempts?: number; callDurationsMs?: number[] }[] = [];
      for (const item of fresh) {
        try {
          const rating = await deps.model.rate(item);
          rating.meta?.warnings.forEach((w) => warn(`${item.id}: ${w}`));
          pairs.push({ item, rating });
        } catch (err) {
          const e = err as { message?: string; attempts?: number; callDurationsMs?: number[] };
          failed.push({
            itemId: item.id,
            error: e.message ?? String(err),
            ...(e.attempts !== undefined && { attempts: e.attempts }),
            ...(e.callDurationsMs !== undefined && { callDurationsMs: e.callDurationsMs }),
          });
          warn(`${item.id}: ${e.message ?? String(err)}`);
          failedRatings.push({
            item,
            error: e.message ?? String(err),
            ...(e.attempts !== undefined && { attempts: e.attempts }),
          });
        }
      }
      const above = pairs.filter((p) => p.rating.score >= scoreThreshold).sort(byScore);
      belowThreshold = pairs.filter((p) => p.rating.score < scoreThreshold).sort(byScore);
      return {
        result: above,
        outputCount: above.length,
        details: { model: deps.model.model, ratings: pairs.map((p) => p.rating), failed },
      };
    });

    // Only items at or above the threshold are summarised. A failed summary does not stop the
    // run: the item is reported without summary.
    entries = await stage("summarise", rated.length, async () => {
      const result: ReportEntry[] = [];
      const failed: { itemId: string; error: string }[] = [];
      for (const p of rated) {
        try {
          const summary = await deps.model.summarise(p.item);
          summary.meta?.warnings.forEach((w) => warn(`${p.item.id}: summary: ${w}`));
          result.push({ ...p, summary });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          warn(`${p.item.id}: ${error}`);
          failed.push({ itemId: p.item.id, error });
          result.push({ ...p, summaryError: error });
        }
      }
      return {
        result,
        outputCount: result.length - failed.length,
        details: { summaries: result.flatMap((e) => e.summary ?? []), failed },
      };
    });

    // No network, no model: dates from a calendar file and a fixed rule.
    let maintenance: RunReport["maintenance"];
    if (options.maintenance) {
      const { calendar, rule, lookaheadDays } = options.maintenance;
      maintenance = await stage("calendar", 0, async () => {
        const { updates, warnings } = await calendar.updates();
        warnings.forEach(warn);
        const at = now();
        const windows = updates
          .map((u) => ({ uid: u.uid, summary: u.summary, ...computeWindow(u.updateDate, rule) }))
          .filter((w) => isUpcoming(w, at, lookaheadDays))
          .sort((a, b) => a.startUtc.localeCompare(b.startUtc) || a.updateDate.localeCompare(b.updateDate));
        const result = { rule: ruleText(rule), ruleSpec: rule, lookaheadDays, windows, warnings };
        return {
          result,
          outputCount: windows.length,
          details: { source: calendar.name, updates: updates.length, ...result },
        };
      });
    }

    await stage("output", entries.length, async () => {
      await deps.output.render({
        runId,
        generatedAt: now().toISOString(),
        source: deps.source.name,
        scoreThreshold,
        ratingModel: deps.model.model,
        ...(options.periodDays !== undefined && {
          period: { from: new Date(Date.parse(startedAt) - options.periodDays * DAY_MS).toISOString(), to: startedAt },
        }),
        entries,
        belowThreshold,
        failed: failedRatings,
        prefilter: prefilterSummary,
        alreadyReported,
        ...(maintenance && { maintenance }),
      });
      // Mark as reported only after the draft was rendered, and only when asked (MEMORY_MARK).
      const marked = options.markReported === true;
      if (marked) for (const e of entries) await deps.memory.markReported(e.item);
      return {
        result: undefined,
        outputCount: entries.length,
        details: { marked, reported: marked ? entries.map((e) => e.item.id) : [] },
      };
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
