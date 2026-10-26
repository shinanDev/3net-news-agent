// Rebuilds the run report from a run log and the items of the run's snapshot, so an output
// (e.g. the newsletter) can be rendered again without new model calls.
// Ratings, summaries and maintenance windows come from the log as they were in the run.

import type { NewsItem, Rating, RunLog, Summary } from "../domain/types.ts";
import type { FailedRating, RatedItem, ReportEntry, RunReport } from "../ports/output.ts";

interface RateDetails {
  model: string;
  ratings: Rating[];
  failed: { itemId: string; error: string; attempts?: number }[];
}

export function reportFromRunLog(log: RunLog, items: NewsItem[], options: { periodDays?: number } = {}): RunReport {
  const stage = (name: string) => log.stages.find((s) => s.stage === name);
  const byId = new Map(items.map((i) => [i.id, i]));
  const item = (id: string): NewsItem => {
    const found = byId.get(id);
    if (!found) throw new Error(`${id} from the run log is not in the given items (wrong snapshot?)`);
    return found;
  };

  const rate = stage("rate")?.details as RateDetails | undefined;
  if (!rate) throw new Error(`run log ${log.runId} has no rate stage`);
  const summarise = stage("summarise")?.details as
    | { summaries: Summary[]; failed?: { itemId: string; error: string }[] }
    | undefined;
  const summaries = new Map((summarise?.summaries ?? []).map((s) => [s.itemId, s]));
  const summaryErrors = new Map((summarise?.failed ?? []).map((f) => [f.itemId, f.error]));

  const byScore = (a: RatedItem, b: RatedItem) => b.rating.score - a.rating.score;
  const rated = rate.ratings.map((rating) => ({ item: item(rating.itemId), rating }));
  const entries: ReportEntry[] = rated
    .filter((p) => p.rating.score >= log.scoreThreshold)
    .sort(byScore)
    .map((p) => {
      const summary = summaries.get(p.item.id);
      const error = summaryErrors.get(p.item.id);
      return { ...p, ...(summary && { summary }), ...(error && { summaryError: error }) };
    });
  const failed: FailedRating[] = rate.failed.map((f) => ({
    item: item(f.itemId),
    error: f.error,
    ...(f.attempts !== undefined && { attempts: f.attempts }),
  }));

  const prefilter = stage("prefilter");
  const prefilterDetails = prefilter?.details as { droppedByRule?: Record<string, number>; warnings?: string[] } | undefined;
  const calendar = stage("calendar")?.details as (RunReport["maintenance"] & object) | undefined;
  const loggedPeriod = (stage("output")?.details as { period?: RunReport["period"] } | undefined)?.period;
  const period =
    loggedPeriod ??
    (options.periodDays === undefined
      ? undefined
      : {
          from: new Date(Date.parse(log.startedAt) - options.periodDays * 24 * 60 * 60 * 1000).toISOString(),
          to: log.startedAt,
        });

  return {
    runId: log.runId,
    generatedAt: log.finishedAt ?? log.startedAt,
    source: (stage("ingest")?.details as { source?: string } | undefined)?.source ?? "unknown",
    scoreThreshold: log.scoreThreshold,
    ratingModel: rate.model,
    ...(period && { period }),
    entries,
    belowThreshold: rated.filter((p) => p.rating.score < log.scoreThreshold).sort(byScore),
    failed,
    prefilter: {
      input: prefilter?.inputCount ?? 0,
      kept: prefilter?.outputCount ?? 0,
      droppedByRule: prefilterDetails?.droppedByRule ?? {},
      warnings: prefilterDetails?.warnings ?? [],
    },
    alreadyReported: [],
    ...(calendar && {
      maintenance: {
        rule: calendar.rule,
        ruleSpec: calendar.ruleSpec,
        lookaheadDays: calendar.lookaheadDays,
        windows: calendar.windows,
        warnings: calendar.warnings,
      },
    }),
  };
}
