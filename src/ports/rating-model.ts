import type { NewsItem, Rating, Summary } from "../domain/types.ts";

/** Scores and summarises text. Gets no tools and no credentials beyond its own endpoint. */
export interface RatingModel {
  readonly model: string;
  rate(item: NewsItem): Promise<Rating>;
  summarise(item: NewsItem): Promise<Summary>;
}
