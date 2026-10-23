// Placeholder adapters so the pipeline runs end to end without Zetaris, H-MEM or Nightshift.
// All data here is fictional.

import { assertValidScore, type NewsItem, type Rating, type Summary } from "../../domain/types.ts";
import type { MemoryStore } from "../../ports/memory-store.ts";
import type { NewsSource } from "../../ports/news-source.ts";
import type { Output, ReportEntry, RunReport } from "../../ports/output.ts";
import type { RatingModel } from "../../ports/rating-model.ts";

export class StubNewsSource implements NewsSource {
  readonly name = "stub";
  constructor(private readonly items: NewsItem[] = sampleItems()) {}
  async fetch(): Promise<NewsItem[]> {
    return this.items;
  }
}

/** In-memory, exact URL match only. */
export class InMemoryMemoryStore implements MemoryStore {
  private readonly urls = new Set<string>();
  constructor(reportedUrls: string[] = []) {
    reportedUrls.forEach((u) => this.urls.add(u));
  }
  async wasReported(item: NewsItem): Promise<boolean> {
    return this.urls.has(item.url);
  }
  async markReported(item: NewsItem): Promise<void> {
    this.urls.add(item.url);
  }
}

/** Returns a fixed score per item id (default 5). */
export class StubRatingModel implements RatingModel {
  readonly model = "stub";
  constructor(private readonly scores: Record<string, number> = {}) {}
  async rate(item: NewsItem): Promise<Rating> {
    const score = this.scores[item.id] ?? 5;
    assertValidScore(score);
    return {
      itemId: item.id,
      score,
      reasoning: "stub rating",
      sourceUrl: item.url,
      model: this.model,
      ratedAt: new Date().toISOString(),
    };
  }
  async summarise(item: NewsItem): Promise<Summary> {
    return { itemId: item.id, text: item.title, model: this.model, summarisedAt: new Date().toISOString() };
  }
}

/** Keeps the rendered report in memory and prints a short overview. */
export class ConsoleOutput implements Output {
  entries: ReportEntry[] = [];
  report: RunReport | undefined;
  constructor(private readonly quiet = false) {}
  async render(report: RunReport): Promise<void> {
    this.report = report;
    this.entries = report.entries;
    if (this.quiet) return;
    console.log(`Draft with ${report.entries.length} item(s):`);
    for (const e of report.entries) console.log(`- [${e.rating.score}] ${e.item.title} <${e.item.url}>`);
  }
}

export function sampleItems(): NewsItem[] {
  const fetchedAt = new Date().toISOString();
  const item = (n: number, title: string, url: string): NewsItem => ({
    id: `stub:${n}`,
    source: "stub",
    title,
    summary: `Fictional sample item ${n}.`,
    url,
    status: "In development",
    tags: ["sample"],
    fetchedAt,
    raw: null,
  });
  return [
    item(1, "Sample feature A", "https://example.com/items/1"),
    item(2, "Sample feature B", "https://example.com/items/2"),
    item(3, "", "https://example.com/items/3"),
  ];
}
