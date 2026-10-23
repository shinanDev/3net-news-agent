// Reads software update dates from an ICS file (RFC 5545 subset, no dependency).
// Only UID, SUMMARY and DTSTART of each VEVENT are used. DTSTAMP is checked but not used:
// malformed values (seen: 7 digits in the time part) produce one warning, not a failure.

import { readFile } from "node:fs/promises";
import { dateInZone } from "../../domain/maintenance-window.ts";
import type { MaintenanceCalendar, MaintenanceUpdate } from "../../ports/maintenance-calendar.ts";

export class IcsFileCalendar implements MaintenanceCalendar {
  readonly name: string;

  constructor(
    private readonly path: string,
    private readonly timeZone: string,
  ) {
    this.name = `ics:${path}`;
  }

  async updates(): Promise<{ updates: MaintenanceUpdate[]; warnings: string[] }> {
    return parseIcs(await readFile(this.path, "utf8"), this.timeZone);
  }
}

interface Property {
  name: string;
  params: Record<string, string>;
  value: string;
}

export function parseIcs(text: string, timeZone: string): { updates: MaintenanceUpdate[]; warnings: string[] } {
  const updates: MaintenanceUpdate[] = [];
  const warnings: string[] = [];
  const badStamps: string[] = [];
  let event: Property[] | undefined;
  let index = 0;

  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") {
      event = [];
      index++;
    } else if (line === "END:VEVENT" && event) {
      const get = (name: string) => event!.find((p) => p.name === name);
      const uid = get("UID")?.value || `event #${index}`;
      const stamp = get("DTSTAMP")?.value;
      if (stamp !== undefined && !/^\d{8}T\d{6}Z?$/.test(stamp)) badStamps.push(`${uid}: ${stamp}`);
      const start = get("DTSTART");
      const updateDate = start && toLocalDate(start, timeZone);
      if (!updateDate) {
        warnings.push(`${uid}: ${start ? `DTSTART "${start.value}" not understood` : "no DTSTART"}; event skipped`);
      } else {
        updates.push({ uid, summary: unescape(get("SUMMARY")?.value ?? ""), updateDate });
      }
      event = undefined;
    } else if (event) {
      const p = parseProperty(line);
      if (p) event.push(p);
    }
  }

  if (badStamps.length) {
    warnings.unshift(
      `DTSTAMP not in the format YYYYMMDDTHHMMSSZ in ${badStamps.length} event(s), e.g. ${badStamps[0]}; DTSTAMP is not used`,
    );
  }
  return { updates, warnings };
}

/** Joins folded lines (continuation lines start with a space or tab). */
function unfold(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && lines.length) lines[lines.length - 1] += raw.slice(1);
    else if (raw.trim()) lines.push(raw);
  }
  return lines;
}

function parseProperty(line: string): Property | undefined {
  const colon = line.indexOf(":");
  if (colon < 0) return undefined;
  const [name, ...rawParams] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
  }
  return { name: name!.toUpperCase(), params, value: line.slice(colon + 1).trim() };
}

/** DTSTART as a local date: date-only, UTC ("...Z", converted to the zone), or local/TZID (date part). */
function toLocalDate(p: Property, timeZone: string): string | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(p.value);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s, z] = m;
  if (+mo! < 1 || +mo! > 12 || +d! < 1 || +d! > 31) return undefined;
  if (z) return dateInZone(new Date(Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!)), timeZone);
  return `${y}-${mo}-${d}`;
}

function unescape(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_m, c: string) => (c === "n" || c === "N" ? " " : c));
}
