// Maintenance window rule: the window starts on the first given weekday strictly after the
// update date, or on or after it with sameDay (an update on that weekday is then installed
// the same evening), and ends at the end time, on the next day if the end time is not after
// the start time. Times are local wall-clock times in the given time zone; conversion uses
// Intl, no library.

export const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface MaintenanceRule {
  weekday: Weekday;
  /** Local start time "HH:MM". */
  start: string;
  /** Local end time "HH:MM"; on the next day if not after start. */
  end: string;
  timeZone: string;
  /** true: an update on the window weekday gets that day's window; false: the next week's. */
  sameDay: boolean;
}

export interface MaintenanceWindow {
  /** Update date "YYYY-MM-DD" (local date in the rule's time zone). */
  updateDate: string;
  /** Local start and end, e.g. "Sun 2026-04-19 19:00". */
  startLocal: string;
  endLocal: string;
  startUtc: string;
  endUtc: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function computeWindow(updateDate: string, rule: MaintenanceRule): MaintenanceWindow {
  const update = parseDate(updateDate);
  const target = WEEKDAYS.indexOf(rule.weekday);
  const offset = (target - update.getUTCDay() + 7) % 7 || (rule.sameDay ? 0 : 7);
  const startDay = new Date(update.getTime() + offset * DAY_MS);
  const endDay = endsNextDay(rule) ? new Date(startDay.getTime() + DAY_MS) : startDay;
  const startUtc = localToUtc(startDay, rule.start, rule.timeZone);
  const endUtc = localToUtc(endDay, rule.end, rule.timeZone);
  return {
    updateDate,
    startLocal: `${SHORT[startDay.getUTCDay()]} ${isoDate(startDay)} ${rule.start}`,
    endLocal: `${SHORT[endDay.getUTCDay()]} ${isoDate(endDay)} ${rule.end}`,
    startUtc: startUtc.toISOString(),
    endUtc: endUtc.toISOString(),
  };
}

/** Plain-text explanation of the rule, for the report. */
export function ruleText(rule: MaintenanceRule): string {
  const day = capitalize(rule.weekday);
  const endDay = endsNextDay(rule) ? capitalize(WEEKDAYS[(WEEKDAYS.indexOf(rule.weekday) + 1) % 7]!) : day;
  const window = `${rule.start} to ${endDay} ${rule.end} (${rule.timeZone})`;
  return rule.sameDay
    ? `first ${day} on or after the update date, ${window}; an update on a ${day} is installed the same evening`
    : `first ${day} after the update date, ${window}; an update on a ${day} gets the following ${day}'s window`;
}

/** Windows that have not ended yet and start within the next lookaheadDays. */
export function isUpcoming(window: MaintenanceWindow, now: Date, lookaheadDays: number): boolean {
  const start = Date.parse(window.startUtc);
  const end = Date.parse(window.endUtc);
  return end > now.getTime() && start <= now.getTime() + lookaheadDays * DAY_MS;
}

/** Calendar date of an instant in a time zone, "YYYY-MM-DD". */
export function dateInZone(instant: Date, timeZone: string): string {
  const p = parts(instant, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

export function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function endsNextDay(rule: MaintenanceRule): boolean {
  return rule.end <= rule.start;
}

/** UTC instant of a local wall-clock time; two passes handle the DST offset change. */
function localToUtc(day: Date, time: string, timeZone: string): Date {
  const [h, m] = time.split(":").map(Number);
  const wall = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m);
  let utc = wall - offsetMs(new Date(wall), timeZone);
  utc = wall - offsetMs(new Date(utc), timeZone);
  return new Date(utc);
}

function offsetMs(instant: Date, timeZone: string): number {
  const p = parts(instant, timeZone);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

function parts(instant: Date, timeZone: string): Record<"year" | "month" | "day" | "hour" | "minute" | "second", string> {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(instant)) out[p.type] = p.value;
  return out as Record<"year" | "month" | "day" | "hour" | "minute" | "second", string>;
}

function parseDate(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) throw new Error(`invalid date ${value}`);
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
