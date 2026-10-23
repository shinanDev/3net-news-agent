// Maps the Zetaris SQL editor response for the M365 Roadmap query to NewsItems.
// Response shape (seen in a real response): { headers: string[], data: unknown[][], total, timeUsed }.
// Rows are positional; list values arrive as JSON text inside strings.

import type { NewsItem } from "../../domain/types.ts";
import { htmlToText } from "./html-text.ts";

export const M365_SOURCE = "m365-roadmap";
export const M365_ROADMAP_URL = "https://www.microsoft.com/microsoft-365/roadmap?id=";

export interface ZetarisResult {
  headers: string[];
  rows: unknown[][];
}

export function parseZetarisResult(body: unknown): ZetarisResult {
  const b = body as { headers?: unknown; data?: unknown } | null;
  if (!b || !Array.isArray(b.headers) || !b.headers.every((h) => typeof h === "string")) {
    throw new Error("Zetaris response has no string[] headers");
  }
  if (!Array.isArray(b.data) || !b.data.every(Array.isArray)) {
    throw new Error("Zetaris response has no row array in data");
  }
  return { headers: b.headers as string[], rows: b.data as unknown[][] };
}

/** Turns positional rows into objects keyed by header, with JSON list strings parsed. */
export function rowsToRecords({ headers, rows }: ZetarisResult): Record<string, unknown>[] {
  return rows.map((row) => Object.fromEntries(headers.map((h, i) => [h, parseJsonText(row[i] ?? null)])));
}

export function toNewsItems(body: unknown, fetchedAt: string): NewsItem[] {
  return rowsToRecords(parseZetarisResult(body)).map((r) => toNewsItem(r, fetchedAt));
}

export function toNewsItem(record: Record<string, unknown>, fetchedAt: string): NewsItem {
  const id = str(record["id"]);
  if (!id) throw new Error("M365 roadmap row without id");
  const { locale: _dropped, ...raw } = record;
  const item: NewsItem = {
    id: `m365:${id}`,
    source: M365_SOURCE,
    // Some titles contain line breaks (seen in the full snapshot).
    title: (str(record["title"]) ?? "").replace(/\s+/g, " "),
    summary: htmlToText(str(record["description"]) ?? ""),
    url: M365_ROADMAP_URL + encodeURIComponent(id),
    status: str(record["status"]) ?? "",
    tags: unique([...strList(record["platforms"]), ...strList(record["releaseRings"])]),
    fetchedAt,
    raw,
    m365: {
      products: strList(record["products"]),
      platforms: strList(record["platforms"]),
      cloudInstances: strList(record["cloudInstances"]),
      gaMonth: month(record["generalAvailabilityDate"]),
      previewMonth: month(record["previewAvailabilityDate"]),
      modifiedAt: str(record["modified"]),
    },
  };
  const created = str(record["created"]);
  if (created) item.publishedAt = created;
  return item;
}

function parseJsonText(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const t = value.trim();
  if (!(t.startsWith("[") || t.startsWith("{"))) return value;
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return value;
  }
}

function str(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  return null;
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "") : [];
}

function month(value: unknown): string | null {
  const s = str(value);
  return s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s) ? s : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
