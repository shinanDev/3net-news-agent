// Strict validation of the model's answer and the score computation. The model returns
// components only; the score is computed here so the caps cannot be bypassed.

import type { RatingComponents } from "../../domain/types.ts";

export interface ParsedAnswer {
  components: RatingComponents;
  reasoning: string;
  /** Characters of free text around the JSON object that were discarded. */
  discardedChars: number;
  warnings: string[];
}

export type ParseResult = { ok: true; value: ParsedAnswer } | { ok: false; error: string };

const BASE_VALUES = [0, 2, 4, 7] as const;
const CAPS: Record<RatingComponents["baseValue"], number> = { 0: 0, 2: 3, 4: 6, 7: 10 };
const FIELDS = ["baseValue", "actionBonus", "excluded", "reasoning", "products"];
const THINK_END = "</think>";
export const MAX_REASONING_CHARS = 400;

export function computeScore(c: RatingComponents): number {
  if (c.excluded) return 0;
  return Math.min(c.baseValue + c.actionBonus, CAPS[c.baseValue]);
}

/**
 * Drops everything up to and including the last "</think>", then returns the first balanced
 * top-level JSON object (braces inside strings are ignored). Nothing inside the object is repaired.
 */
export function extractJsonObject(text: string): { json: string; discardedChars: number } | { error: string } {
  const thinkEnd = text.lastIndexOf(THINK_END);
  const rest = thinkEnd >= 0 ? text.slice(thinkEnd + THINK_END.length) : text;
  const start = rest.indexOf("{");
  if (start < 0) return { error: "answer contains no JSON object" };
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < rest.length; i++) {
    const ch = rest[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      const json = rest.slice(start, i + 1);
      return { json, discardedChars: text.length - json.length };
    }
  }
  return { error: "JSON object in answer is not closed" };
}

export function parseAnswer(text: string): ParseResult {
  const extracted = extractJsonObject(text);
  if ("error" in extracted) return { ok: false, error: extracted.error };
  let value: unknown;
  try {
    value = JSON.parse(extracted.json);
  } catch {
    return { ok: false, error: "answer is not valid JSON" };
  }
  const v = value as Record<string, unknown>;
  const extra = Object.keys(v).filter((k) => !FIELDS.includes(k));
  if (extra.length) return { ok: false, error: `unexpected fields: ${extra.join(", ")}` };

  const { baseValue, actionBonus, excluded, reasoning, products } = v;
  if (!BASE_VALUES.includes(baseValue as never)) {
    return { ok: false, error: `baseValue ${JSON.stringify(baseValue)} not allowed, use 0, 2, 4 or 7` };
  }
  if (!Number.isInteger(actionBonus) || (actionBonus as number) < 0 || (actionBonus as number) > 3) {
    return { ok: false, error: `actionBonus ${JSON.stringify(actionBonus)} not allowed, use an integer 0-3` };
  }
  if (typeof excluded !== "boolean") return { ok: false, error: "excluded must be true or false" };
  if (typeof reasoning !== "string" || !reasoning.trim()) {
    return { ok: false, error: "reasoning must be a non-empty string" };
  }
  if (reasoning.length > MAX_REASONING_CHARS) {
    return { ok: false, error: `reasoning longer than ${MAX_REASONING_CHARS} characters` };
  }
  if (!Array.isArray(products) || !products.every((p) => typeof p === "string")) {
    return { ok: false, error: "products must be an array of strings" };
  }

  const warnings: string[] = [];
  const sentences = reasoning.trim().match(/[.!?](\s|$)/g)?.length ?? 0;
  if (sentences > 2) warnings.push(`reasoning has ${sentences} sentences, expected at most 2`);

  return {
    ok: true,
    value: {
      components: {
        baseValue: baseValue as RatingComponents["baseValue"],
        actionBonus: actionBonus as RatingComponents["actionBonus"],
        excluded,
        products: products as string[],
      },
      reasoning: reasoning.trim(),
      discardedChars: extracted.discardedChars,
      warnings,
    },
  };
}
