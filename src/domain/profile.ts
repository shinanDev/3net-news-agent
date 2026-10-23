// Relevance profile (config/profile.m365.json): audience, rubric for the rating model and
// products the prefilter treats as out of scope. Shared by the prefilter and the rating adapter.

import { readFile } from "node:fs/promises";

export interface OutOfScopeProducts {
  /** Product names starting with one of these are out of scope (case-sensitive). */
  prefixes: string[];
  /** Product names equal to one of these are out of scope. */
  exact: string[];
}

export interface RelevanceProfile {
  id: string;
  audience: string;
  coreProducts: string[];
  notRelevant: string[];
  outOfScopeProducts: OutOfScopeProducts;
  baseValue: Record<"0" | "2" | "4" | "7", string>;
  actionBonus: Record<"0" | "1" | "2" | "3", string>;
  excluded: string;
}

export async function loadProfile(path: string): Promise<RelevanceProfile> {
  const p = JSON.parse(await readFile(path, "utf8")) as Partial<RelevanceProfile>;
  const isStrings = (v: unknown) => Array.isArray(v) && v.every((s) => typeof s === "string");
  const hasKeys = (v: unknown, keys: string[]) =>
    !!v && typeof v === "object" && keys.every((k) => typeof (v as Record<string, unknown>)[k] === "string");
  if (
    typeof p.id !== "string" ||
    typeof p.audience !== "string" ||
    !isStrings(p.coreProducts) ||
    !isStrings(p.notRelevant) ||
    !p.outOfScopeProducts ||
    !isStrings(p.outOfScopeProducts.prefixes) ||
    !isStrings(p.outOfScopeProducts.exact) ||
    !hasKeys(p.baseValue, ["0", "2", "4", "7"]) ||
    !hasKeys(p.actionBonus, ["0", "1", "2", "3"]) ||
    typeof p.excluded !== "string"
  ) {
    throw new Error(`relevance profile ${path} is incomplete or has wrong types`);
  }
  return p as RelevanceProfile;
}

export function isOutOfScopeProduct(product: string, list: OutOfScopeProducts): boolean {
  return list.exact.includes(product) || list.prefixes.some((prefix) => product.startsWith(prefix));
}
