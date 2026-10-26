// RatingModel backed by Nightshift. The model returns components; the score is computed in code.
// An invalid answer gets one more attempt; after that the item fails and gets no score.
// Summaries use their own prompt and JSON answer ({ summary, whyItMatters }) with the same rules.

import type { NewsItem, Rating, Summary } from "../../domain/types.ts";
import type { RatingModel } from "../../ports/rating-model.ts";
import { NightshiftError, type NightshiftClient } from "./nightshift-client.ts";
import type { RelevanceProfile } from "../../domain/profile.ts";
import { buildMessages, summaryMessages } from "./prompt.ts";
import { computeScore, parseAnswer } from "./rating-response.ts";
import { parseSummary } from "./summary-response.ts";

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
  /**
   * Fail the rating if the response model differs from the configured one. Default true.
   * Nightshift only pins the model for an app name registered in its console.
   */
  strictModel?: boolean;
  /** Language of the newsletter summary (NEWSLETTER_LANGUAGE). Default: language. */
  summaryLanguage?: string;
}

const MAX_ATTEMPTS = 2;

export class NightshiftRatingModel implements RatingModel {
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

      const warnings: string[] = [];
      if (result.model !== this.model) {
        const mismatch = `response model ${result.model ?? "(none)"} differs from configured ${this.model}`;
        if (this.options.strictModel ?? true) {
          throw new RatingFailedError(
            `rating failed: ${mismatch} (strict model check; is the meterless-app name registered in Nightshift?)`,
            attempt,
            durations,
          );
        }
        warnings.push(mismatch);
      }

      const parsed = parseAnswer(result.content);
      if (!parsed.ok) {
        retry = { previousAnswer: result.content, error: parsed.error };
        continue;
      }
      warnings.push(...parsed.value.warnings);
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
          ...result.receipt,
          discardedChars: parsed.value.discardedChars,
          warnings,
        },
      };
    }
    throw new RatingFailedError(`rating failed: invalid answer twice (${retry!.error})`, MAX_ATTEMPTS, durations);
  }

  /** Called by the pipeline only for items at or above the threshold. Same retry and model check as rate(). */
  async summarise(item: NewsItem): Promise<Summary> {
    const language = this.options.summaryLanguage ?? this.options.language;
    const sourceText = `${item.title}\n${item.summary}`;
    const started = Date.now();
    const durations: number[] = [];
    let retry: { previousAnswer: string; error: string } | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const messages = summaryMessages(this.options.profile, language, item, retry);
      let result;
      try {
        result = await this.client.chat(messages);
      } catch (err) {
        if (err instanceof NightshiftError) durations.push(...err.callDurationsMs);
        const message = err instanceof Error ? err.message : String(err);
        throw new RatingFailedError(`summary failed: ${message}`, attempt, durations);
      }
      durations.push(...result.callDurationsMs);

      const warnings: string[] = [];
      if (result.model !== this.model) {
        const mismatch = `response model ${result.model ?? "(none)"} differs from configured ${this.model}`;
        if (this.options.strictModel ?? true) {
          throw new RatingFailedError(`summary failed: ${mismatch} (strict model check)`, attempt, durations);
        }
        warnings.push(mismatch);
      }

      const parsed = parseSummary(result.content, sourceText);
      if (!parsed.ok) {
        retry = { previousAnswer: result.content, error: parsed.error };
        continue;
      }
      warnings.push(...parsed.value.warnings);
      return {
        itemId: item.id,
        text: parsed.value.summary,
        whyItMatters: parsed.value.whyItMatters,
        model: this.model,
        summarisedAt: new Date().toISOString(),
        meta: {
          durationMs: Date.now() - started,
          attempts: attempt,
          responseModel: result.model,
          routedModel: result.receipt.routedModel,
          receiptId: result.receipt.receiptId,
          discardedChars: parsed.value.discardedChars,
          warnings,
        },
      };
    }
    throw new RatingFailedError(`summary failed: invalid answer twice (${retry!.error})`, MAX_ATTEMPTS, durations);
  }
}
