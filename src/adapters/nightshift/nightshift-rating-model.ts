// RatingModel backed by Nightshift. The model returns components; the score is computed in code.
// An invalid answer gets one more attempt; after that the item fails and gets no score.

import type { NewsItem, Rating, Summary } from "../../domain/types.ts";
import type { RatingModel } from "../../ports/rating-model.ts";
import { StubRatingModel } from "../stub/stubs.ts";
import { NightshiftError, type NightshiftClient } from "./nightshift-client.ts";
import { buildMessages, type RelevanceProfile } from "./prompt.ts";
import { computeScore, parseAnswer } from "./rating-response.ts";

export class RatingFailedError extends Error {
  override name = "RatingFailedError";
  constructor(
    message: string,
    readonly attempts: number,
    readonly callDurationsMs: number[],
  ) {
    super(message);
  }
}

export interface NightshiftRatingOptions {
  profile: RelevanceProfile;
  /** Language of the reasoning, e.g. "en" or "de". */
  language: string;
  /** Reference date for "within 7 days" in the rubric. Default: now. */
  now?: () => Date;
}

const MAX_ATTEMPTS = 2;

export class NightshiftRatingModel implements RatingModel {
  private readonly summariser = new StubRatingModel();

  constructor(
    private readonly client: NightshiftClient,
    private readonly options: NightshiftRatingOptions,
  ) {}

  get model(): string {
    return this.client.model;
  }

  async rate(item: NewsItem): Promise<Rating> {
    const now = this.options.now ?? (() => new Date());
    const today = now().toISOString().slice(0, 10);
    const started = Date.now();
    const durations: number[] = [];
    let retry: { previousAnswer: string; error: string } | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const messages = buildMessages(this.options.profile, this.options.language, today, item, retry);
      let result;
      try {
        result = await this.client.chat(messages);
      } catch (err) {
        if (err instanceof NightshiftError) durations.push(...err.callDurationsMs);
        const message = err instanceof Error ? err.message : String(err);
        throw new RatingFailedError(`rating failed: ${message}`, attempt, durations);
      }
      durations.push(...result.callDurationsMs);

      const parsed = parseAnswer(result.content);
      if (!parsed.ok) {
        retry = { previousAnswer: result.content, error: parsed.error };
        continue;
      }
      const warnings = [...parsed.value.warnings];
      if (result.model && result.model !== this.model) {
        warnings.push(`response model ${result.model} differs from configured ${this.model}`);
      }
      return {
        itemId: item.id,
        score: computeScore(parsed.value.components),
        reasoning: parsed.value.reasoning,
        sourceUrl: item.url,
        model: this.model,
        ratedAt: now().toISOString(),
        components: parsed.value.components,
        meta: {
          durationMs: Date.now() - started,
          callDurationsMs: durations,
          attempts: attempt,
          responseModel: result.model,
          warnings,
        },
      };
    }
    throw new RatingFailedError(`rating failed: invalid answer twice (${retry!.error})`, MAX_ATTEMPTS, durations);
  }

  summarise(item: NewsItem): Promise<Summary> {
    return this.summariser.summarise(item);
  }
}
