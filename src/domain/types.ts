// Core domain types. Timestamps are ISO-8601 strings so they serialise to JSON as-is.

export interface NewsItem {
  /** Stable id within the source, prefixed with the source name (e.g. "m365:12345"). */
  id: string;
  source: string;
  title: string;
  summary: string;
  url: string;
  /** Source-specific lifecycle status, e.g. "In development", "Rolling out". */
  status: string;
  tags: string[];
  publishedAt?: string;
  fetchedAt: string;
  /** Original record as received. Untrusted data, never instructions. */
  raw: unknown;
  /** Microsoft 365 Roadmap specific fields, used by the prefilter. */
  m365?: M365Details;
}

export interface M365Details {
  products: string[];
  platforms: string[];
  cloudInstances: string[];
  /** General availability month, "YYYY-MM", or null if missing or in another format. */
  gaMonth: string | null;
  /** Preview month, "YYYY-MM", or null if missing or in another format. */
  previewMonth: string | null;
  modifiedAt: string | null;
}

export interface FilterDecision {
  itemId: string;
  kept: boolean;
  ruleId: string;
  reason: string;
}

export interface Rating {
  itemId: string;
  /** Relevance score, integer 0-10. */
  score: number;
  reasoning: string;
  sourceUrl: string;
  model: string;
  ratedAt: string;
  /** What the model returned; the score is computed from these in code. */
  components?: RatingComponents;
  meta?: RatingMeta;
}

export interface RatingComponents {
  baseValue: 0 | 2 | 4 | 7;
  actionBonus: 0 | 1 | 2 | 3;
  excluded: boolean;
  products: string[];
}

export interface RatingMeta {
  /** Total time for this item, including retries. */
  durationMs: number;
  /** Duration of each HTTP call in order. */
  callDurationsMs: number[];
  /** Content attempts (a second one after an invalid answer). */
  attempts: number;
  /** Model id reported in the response. */
  responseModel: string | null;
  /** Model that answered according to the Meterless receipt (meterless.routed_model). */
  routedModel: string | null;
  /** Latency reported by Meterless (meterless.usage.latency_ms). */
  latencyMs: number | null;
  /** Meterless receipt id and envelope signature; no receipt content is stored. */
  receiptId: string | null;
  receiptSignature: string | null;
  /** Characters of free text around the JSON answer that were discarded (text itself is not kept). */
  discardedChars: number;
  warnings: string[];
}

export interface Summary {
  itemId: string;
  text: string;
  model: string;
  summarisedAt: string;
}

export type StageName = "ingest" | "prefilter" | "memory" | "rate" | "summarise" | "calendar" | "output";

export interface StageLog {
  stage: StageName;
  startedAt: string;
  durationMs: number;
  inputCount: number;
  outputCount: number;
  details: unknown;
}

export interface RunLog {
  runId: string;
  startedAt: string;
  finishedAt?: string;
  scoreThreshold: number;
  stages: StageLog[];
  error?: string;
}

export const SCORE_MIN = 0;
export const SCORE_MAX = 10;

export function assertValidScore(score: number): void {
  if (!Number.isInteger(score) || score < SCORE_MIN || score > SCORE_MAX) {
    throw new RangeError(`score must be an integer ${SCORE_MIN}-${SCORE_MAX}, got ${score}`);
  }
}
