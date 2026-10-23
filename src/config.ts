// Configuration from environment variables. Values are never logged; errors name the variable only.

export const USER_AGENT = "3net-news-agent/0.1 (+https://github.com/shinanDev/3net-news-agent)";

/** Loads .env into process.env if the file exists. Variables already set win. */
export function loadEnv(path = ".env"): void {
  try {
    process.loadEnvFile(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing environment variable ${name}`);
  return value;
}

export function intEnv(name: string, fallback: number): number {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`environment variable ${name} must be a positive integer`);
  return n;
}

export type SourceKind = "stub" | "zetaris";

export function sourceKind(): SourceKind {
  const value = process.env["SOURCE"]?.trim() || "stub";
  if (value !== "stub" && value !== "zetaris") {
    throw new Error(`environment variable SOURCE must be "stub" or "zetaris"`);
  }
  return value;
}

export type RaterKind = "stub" | "nightshift";

export function raterKind(): RaterKind {
  const value = process.env["RATER"]?.trim() || "stub";
  if (value !== "stub" && value !== "nightshift") {
    throw new Error(`environment variable RATER must be "stub" or "nightshift"`);
  }
  return value;
}

export function stringEnv(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

export type OutputKind = "html" | "console";

export function outputKind(): OutputKind {
  const value = process.env["OUTPUT"]?.trim() || "html";
  if (value !== "html" && value !== "console") {
    throw new Error(`environment variable OUTPUT must be "html" or "console"`);
  }
  return value;
}

/** "true"/"false" (case-insensitive); empty or unset falls back to the default. */
export function boolEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`environment variable ${name} must be "true" or "false"`);
}

export const DEFAULT_NIGHTSHIFT_TIMEOUT_MS = 120_000;
export const DEFAULT_RATING_LANGUAGE = "en";
export const DEFAULT_RATING_PROFILE = "config/profile.m365.json";

/** Like intEnv, but returns undefined when the variable is not set. */
export function optionalIntEnv(name: string): number | undefined {
  return process.env[name]?.trim() ? intEnv(name, 0) : undefined;
}

/** Default row limit for the M365 Roadmap query (2163 items on 2026-10-23). */
export const DEFAULT_ZETARIS_ROW_LIMIT = 5000;
/** VF-NEU window. Weekly runs: one day of overlap is fine, the memory check removes repeats. */
export const DEFAULT_PREFILTER_NEW_DAYS = 8;
export const DEFAULT_PREFILTER_HORIZON_MONTHS = 3;
