import type { NewsItem, Rating, Summary } from "../domain/types.ts";

export interface ReportEntry {
  item: NewsItem;
  rating: Rating;
  summary: Summary;
}

export interface Output {
  render(entries: ReportEntry[]): Promise<void>;
}
