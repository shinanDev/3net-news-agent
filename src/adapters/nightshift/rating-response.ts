// Strict validation of the model's answer and the score computation. The model returns
// components only; the score is computed here so the caps cannot be bypassed.

import type { RatingComponents } from "../../domain/types.ts";

export interface ParsedAnswer {
  components: RatingComponents;
  reasoning: string;
  warnings: string[];
}

export type ParseResult = { ok: true; value: ParsedAnswer } | { ok: false; error: string };

const BASE_VALUES = [0, 2, 4, 7] as const;
const CAPS: Record<RatingComponents["baseValue"], number> = { 0: 0, 2: 3, 4: 6, 7: 10 };
const FIELDS = ["baseValue", "actionBonus", "excluded", "reasoning", "products"];
export const MAX_REASONING_CHARS = 400;

export function computeScore(c: RatingComponents): number {
  if (c.excluded) return 0;
  return Math.min(c.baseValue + c.actionBonus, CAPS[c.baseValue]);
}

export function parseAnswer(text: string): ParseResult {
  // Only a surrounding ```json fence is tolerated; nothing else is repaired.
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text.trim());
  const json = fenced ? fenced[1]! : text.trim();
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { ok: false, error: "answer is not valid JSON" };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "answer is not a JSON object" };
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
      warnings,
    },
  };
}
