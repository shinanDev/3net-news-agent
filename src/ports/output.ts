import type { NewsItem, Rating, Summary } from "../domain/types.ts";

export interface ReportEntry {
  item: NewsItem;
  rating: Rating;
  summary: Summary;
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
  };
  alreadyReported: number;
}

export interface Output {
  render(report: RunReport): Promise<void>;
}
