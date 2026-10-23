import type { NewsItem } from "../domain/types.ts";

export interface NewsSource {
  readonly name: string;
  fetch(): Promise<NewsItem[]>;
}
