import type { NewsItem } from "../domain/types.ts";

/**
 * Remembers what was already reported across weekly runs.
 * Takes the whole item so an implementation can check the URL first and then similarity.
 */
export interface MemoryStore {
  wasReported(item: NewsItem): Promise<boolean>;
  markReported(item: NewsItem): Promise<void>;
}
