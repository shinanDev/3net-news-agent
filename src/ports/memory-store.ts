import type { NewsItem } from "../domain/types.ts";

/** Why an item counts as already reported (or not). */
export interface MemoryFinding {
  reported: boolean;
  /** Which check matched: exact URL first, then similarity. null when not reported. */
  via: "url" | "similarity" | null;
  /** Id of the stored record that matched. */
  matchId?: string;
  /** Highest similarity to a stored record (also set when below the threshold). */
  similarity?: number;
}

/** Remembers what was already reported across weekly runs. */
export interface MemoryStore {
  wasReported(item: NewsItem): Promise<MemoryFinding>;
  markReported(item: NewsItem): Promise<void>;
}
