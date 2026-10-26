// Configuration from environment variables. Values are never logged; errors name the variable only.

import {
  isValidTime,
  isValidTimeZone,
  WEEKDAYS,
  type MaintenanceRule,
  type Weekday,
} from "./domain/maintenance-window.ts";

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

export const OUTPUT_KINDS = ["html", "console", "newsletter"] as const;
export type OutputKind = (typeof OUTPUT_KINDS)[number];

/** OUTPUT: comma-separated list, e.g. "html,newsletter"; default "html". */
export function outputKinds(): OutputKind[] {
  const values = (process.env["OUTPUT"]?.trim() || "html").split(",").map((s) => s.trim()).filter(Boolean);
  const bad = values.filter((v) => !(OUTPUT_KINDS as readonly string[]).includes(v));
  if (!values.length || bad.length) {
    throw new Error(`environment variable OUTPUT must be a comma-separated list of ${OUTPUT_KINDS.join(", ")}`);
  }
  return [...new Set(values)] as OutputKind[];
}

export const DEFAULT_NEWSLETTER_FROM = "news-agent@localhost";
export const DEFAULT_NEWSLETTER_TO = "review@localhost";
export const DEFAULT_NEWSLETTER_SMTP_PORT = 1025;
export const DEFAULT_BRAND_LOGO_PATH = "assets/3net-logo.png";

/** NEWSLETTER_* and BRAND_LOGO_PATH; audience "reviewers" (draft, default) or "customers" (approved). smtp is absent unless NEWSLETTER_SMTP_HOST is set. */
export function newsletterConfig(): {
  language: "en" | "de";
  audience: "reviewers" | "customers";
  from: string;
  to: string;
  logoPath: string;
  smtp?: { host: string; port: number; allowRemote: boolean };
} {
  const language = stringEnv("NEWSLETTER_LANGUAGE", "en");
  if (language !== "en" && language !== "de") throw new Error(`environment variable NEWSLETTER_LANGUAGE must be "en" or "de"`);
  const audience = stringEnv("NEWSLETTER_AUDIENCE", "reviewers");
  if (audience !== "reviewers" && audience !== "customers") {
    throw new Error(`environment variable NEWSLETTER_AUDIENCE must be "reviewers" or "customers"`);
  }
  const host = process.env["NEWSLETTER_SMTP_HOST"]?.trim();
  return {
    language,
    audience,
    from: stringEnv("NEWSLETTER_FROM", DEFAULT_NEWSLETTER_FROM),
    to: stringEnv("NEWSLETTER_TO", DEFAULT_NEWSLETTER_TO),
    logoPath: stringEnv("BRAND_LOGO_PATH", DEFAULT_BRAND_LOGO_PATH),
    ...(host && {
      smtp: {
        host,
        port: intEnv("NEWSLETTER_SMTP_PORT", DEFAULT_NEWSLETTER_SMTP_PORT),
        allowRemote: boolEnv("NEWSLETTER_ALLOW_REMOTE", false),
      },
    }),
  };
}

export type MemoryKind = "none" | "hmem";

export function memoryKind(): MemoryKind {
  const value = process.env["MEMORY"]?.trim() || "none";
  if (value !== "none" && value !== "hmem") {
    throw new Error(`environment variable MEMORY must be "none" or "hmem"`);
  }
  return value;
}

/** A number in (0, 1]; empty or unset falls back to the default. */
export function ratioEnv(name: string, fallback: number): number {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 1) throw new Error(`environment variable ${name} must be a number in (0, 1]`);
  return n;
}

/** DATEV_MAINTENANCE_*: the maintenance window rule; undefined when no ICS path is set. */
export function maintenanceConfig():
  | { icsPath: string; rule: MaintenanceRule; lookaheadDays: number }
  | undefined {
  const icsPath = process.env["DATEV_MAINTENANCE_ICS_PATH"]?.trim();
  if (!icsPath) return undefined;
  const weekday = stringEnv("DATEV_MAINTENANCE_WEEKDAY", "sunday").toLowerCase();
  if (!(WEEKDAYS as readonly string[]).includes(weekday)) {
    throw new Error(`environment variable DATEV_MAINTENANCE_WEEKDAY must be one of ${WEEKDAYS.join(", ")}`);
  }
  const start = stringEnv("DATEV_MAINTENANCE_START", "19:00");
  const end = stringEnv("DATEV_MAINTENANCE_END", "07:00");
  for (const [name, value] of [["DATEV_MAINTENANCE_START", start], ["DATEV_MAINTENANCE_END", end]] as const) {
    if (!isValidTime(value)) throw new Error(`environment variable ${name} must be a time HH:MM`);
  }
  const timeZone = stringEnv("DATEV_MAINTENANCE_TZ", "Europe/Berlin");
  if (!isValidTimeZone(timeZone)) throw new Error(`environment variable DATEV_MAINTENANCE_TZ is not a known time zone`);
  return {
    icsPath,
    rule: { weekday: weekday as Weekday, start, end, timeZone, sameDay: boolEnv("DATEV_MAINTENANCE_SAME_DAY", true) },
    lookaheadDays: intEnv("DATEV_MAINTENANCE_LOOKAHEAD_DAYS", 30),
  };
}

export const DEFAULT_MEMORY_DIR = "data/memory/hmem";
/** Calibrated on the 2026-10-23 snapshot: only identical normalized text counts as a duplicate. */
export const DEFAULT_MEMORY_SIMILARITY_THRESHOLD = 0.999;

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

/** Comma-separated numeric ids (e.g. RATE_ITEM_IDS=573696,560700); undefined when not set. */
export function idListEnv(name: string): string[] | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  const ids = value.split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.length || !ids.every((id) => /^\d+$/.test(id))) {
    throw new Error(`environment variable ${name} must be a comma-separated list of numeric ids`);
  }
  return [...new Set(ids)];
}

/** Like intEnv, but returns undefined when the variable is not set. */
export function optionalIntEnv(name: string): number | undefined {
  return process.env[name]?.trim() ? intEnv(name, 0) : undefined;
}

/** Default row limit for the M365 Roadmap query (2163 items on 2026-10-23). */
export const DEFAULT_ZETARIS_ROW_LIMIT = 5000;
/** VF-NEU window. Weekly runs: one day of overlap is fine, the memory check removes repeats. */
export const DEFAULT_PREFILTER_NEW_DAYS = 8;
export const DEFAULT_PREFILTER_HORIZON_MONTHS = 3;
