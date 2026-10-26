// Strict validation of the summary answer: exactly { summary, whyItMatters }, each a short plain
// text in the model's own words. A copy heuristic rejects any run of COPY_WORDS consecutive
// words that also appears in the item's title or description.

import { ITEM_END, ITEM_START } from "./prompt.ts";
import { extractJsonObject } from "./rating-response.ts";

export interface ParsedSummary {
  summary: string;
  whyItMatters: string;
  discardedChars: number;
  warnings: string[];
}

export type SummaryParseResult = { ok: true; value: ParsedSummary } | { ok: false; error: string };

const FIELDS = ["summary", "whyItMatters"] as const;
export const MAX_SUMMARY_FIELD_CHARS = 400;
export const COPY_WORDS = 8;

export function parseSummary(text: string, sourceText: string): SummaryParseResult {
  const extracted = extractJsonObject(text);
  if ("error" in extracted) return { ok: false, error: extracted.error };
  let value: unknown;
  try {
    value = JSON.parse(extracted.json);
  } catch {
    return { ok: false, error: "answer is not valid JSON" };
  }
  const v = value as Record<string, unknown>;
  const extra = Object.keys(v).filter((k) => !(FIELDS as readonly string[]).includes(k));
  if (extra.length) return { ok: false, error: `unexpected fields: ${extra.join(", ")}` };

  const source = shingles(sourceText);
  const warnings: string[] = [];
  const out: Record<string, string> = {};
  for (const field of FIELDS) {
    const raw = v[field];
    if (typeof raw !== "string" || !raw.trim()) return { ok: false, error: `${field} must be a non-empty string` };
    const s = raw.trim().replace(/\s+/g, " ");
    if (s.length > MAX_SUMMARY_FIELD_CHARS) {
      return { ok: false, error: `${field} longer than ${MAX_SUMMARY_FIELD_CHARS} characters` };
    }
    if (s.includes(ITEM_START) || s.includes(ITEM_END)) return { ok: false, error: `${field} contains item markers` };
    if ([...shingles(s)].some((sh) => source.has(sh))) {
      return { ok: false, error: `${field} copies ${COPY_WORDS} or more consecutive words from the item; use your own words` };
    }
    const sentences = s.match(/[.!?](\s|$)/g)?.length ?? 0;
    if (sentences > 2) warnings.push(`${field} has ${sentences} sentences, expected at most 2`);
    out[field] = s;
  }
  return {
    ok: true,
    value: { summary: out["summary"]!, whyItMatters: out["whyItMatters"]!, discardedChars: extracted.discardedChars, warnings },
  };
}

function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Every run of COPY_WORDS consecutive words, joined by spaces. */
function shingles(text: string): Set<string> {
  const w = words(text);
  const result = new Set<string>();
  for (let i = 0; i + COPY_WORDS <= w.length; i++) result.add(w.slice(i, i + COPY_WORDS).join(" "));
  return result;
}
