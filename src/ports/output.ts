import type { FilterDecision, NewsItem, Rating, Summary } from "../domain/types.ts";
import type { MaintenanceRule, MaintenanceWindow } from "../domain/maintenance-window.ts";
import type { MemoryFinding } from "./memory-store.ts";

export interface ReportEntry {
  item: NewsItem;
  rating: Rating;
  /** Absent if summarising failed; the item is still reported. */
  summary?: Summary;
  summaryError?: string;
}

export interface RatedItem {
  item: NewsItem;
  rating: Rating;
}

export interface FailedRating {
  item: NewsItem;
  error: string;
  attempts?: number;
}

/** Everything one run produced, for the internal run report. */
export interface RunReport {
  runId: string;
  generatedAt: string;
  source: string;
  scoreThreshold: number;
  /** Configured rating model; the model that answered is in each rating's meta. */
  ratingModel: string;
  /** News window of the run (VF-NEU), ISO timestamps; absent when not configured. */
  period?: { from: string; to: string };
  /** Rated at or above the threshold, highest score first. */
  entries: ReportEntry[];
  /** Rated below the threshold, highest score first. */
  belowThreshold: RatedItem[];
  failed: FailedRating[];
  prefilter: {
    input: number;
    kept: number;
    droppedByRule: Record<string, number>;
    warnings: string[];
    /** With RATE_ITEM_IDS: the prefilter decision for each listed item. */
    selected?: FilterDecision[];
  };
  /** Items that passed the prefilter but were already reported in an earlier run, with the reason. */
  alreadyReported: { item: NewsItem; finding: MemoryFinding }[];
  /** Upcoming maintenance windows; absent when no maintenance calendar is configured. */
  maintenance?: {
    /** The rule as plain text ("why this window"). */
    rule: string;
    /** The rule itself, so outputs can phrase it in another language. */
    ruleSpec: MaintenanceRule;
    lookaheadDays: number;
    windows: (MaintenanceWindow & { uid: string; summary: string })[];
    warnings: string[];
  };
}

export interface Output {
  render(report: RunReport): Promise<void>;
}
