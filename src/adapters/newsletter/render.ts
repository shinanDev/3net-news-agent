// Newsletter content: mail-safe HTML (tables, 600 px, inline CSS, bgcolor, no external resources,
// no scripts, no tracking) and a plain-text part. Labels in English and German.
// Two audiences: "reviewers" get the draft with score, components and the agent's reasoning;
// "customers" get the approved version without draft banner, scores, reasoning or run details.
// All text from sources and the model is escaped; only http(s) URLs become links.
// Text sits in table cells rather than <p> margins, and every text style sets
// mso-line-height-rule (Outlook for Windows), as found by the Mailpit HTML check.

import type { Brand } from "../../domain/brand.ts";
import { WEEKDAYS, type MaintenanceRule } from "../../domain/maintenance-window.ts";
import type { ReportEntry, RunReport } from "../../ports/output.ts";
import { answeringModel, esc, isHttpUrl } from "../html/html-file-output.ts";

export type NewsletterLanguage = "en" | "de";
export const NEWSLETTER_LANGUAGES: readonly NewsletterLanguage[] = ["en", "de"];
export type NewsletterAudience = "reviewers" | "customers";
export const NEWSLETTER_AUDIENCES: readonly NewsletterAudience[] = ["reviewers", "customers"];

export interface NewsletterContent {
  subject: string;
  preheader: string;
  html: string;
  text: string;
}

export interface RenderOptions {
  language: NewsletterLanguage;
  audience: NewsletterAudience;
  brand: Brand;
  /** Image source of the logo, e.g. "cid:..." in the mail or a data URI in the review copy. */
  logoSrc: string;
  /** Time zone for dates in the mail. Default Europe/Berlin. */
  timeZone?: string;
}

interface Labels {
  locale: string;
  title: string;
  draft: string;
  preheader: (n: number) => string;
  draftNote: string;
  m365: string;
  why: string;
  reasoning: string;
  capped: string;
  products: string;
  status: string;
  ga: string;
  preview: string;
  available: string;
  availableNow: string;
  readOn: string;
  noItems: string;
  maintenance: string;
  noWindows: (days: number) => string;
  updateOn: (day: string) => string;
  notAvailable: (windows: number) => string;
  rule: string;
  everyItem: string;
  run: string;
  models: string;
  repo: string;
  sender: string;
  statuses: Record<string, string>;
  ruleText: (rule: MaintenanceRule, english: string) => string;
}

const LABELS: Record<NewsletterLanguage, Labels> = {
  en: {
    locale: "en-GB",
    title: "Microsoft 365 news",
    draft: "draft",
    preheader: (n) =>
      n === 0
        ? "No Microsoft 365 change needs your attention this time."
        : `${n} Microsoft 365 change${n === 1 ? "" : "s"} for your daily work, each with its reason.`,
    draftNote: "This draft was prepared by the 3NET News Agent and is reviewed by a person before sending.",
    m365: "Microsoft 365",
    why: "Why this matters",
    reasoning: "Agent's reasoning (for reviewers)",
    capped: "capped",
    products: "Products",
    status: "Status",
    ga: "GA",
    preview: "Preview",
    available: "Available",
    availableNow: "Available now",
    readOn: "Read on the Microsoft 365 Roadmap →",
    noItems: "No Microsoft 365 change passed the relevance check this time. Nothing to read, nothing to do.",
    maintenance: "Maintenance windows (DATEV)",
    noWindows: (d) => `No maintenance window starts in the next ${d} days.`,
    updateOn: (day) => `DATEV update on ${day}`,
    notAvailable: (n) => `DATEV systems are not available during ${n === 1 ? "this window" : "these windows"}.`,
    rule: "Rule",
    everyItem: "Every item carries its reason.",
    run: "Run",
    models: "Answering models",
    repo: "Source code",
    sender: "From 3NET, prepared with the 3NET News Agent.",
    statuses: {},
    ruleText: (_rule, english) => english.charAt(0).toUpperCase() + english.slice(1),
  },
  de: {
    locale: "de-DE",
    title: "Microsoft-365-News",
    draft: "Entwurf",
    preheader: (n) =>
      n === 0
        ? "Diesmal braucht keine Microsoft-365-Änderung Ihre Aufmerksamkeit."
        : `${n} Microsoft-365-Änderung${n === 1 ? "" : "en"} für Ihren Arbeitsalltag, jede mit Begründung.`,
    draftNote: "Dieser Entwurf wurde vom 3NET News Agent erstellt und wird vor dem Versand von einer Person geprüft.",
    m365: "Microsoft 365",
    why: "Warum das wichtig ist",
    reasoning: "Begründung des Agenten (für die Prüfung)",
    capped: "gedeckelt",
    products: "Produkte",
    status: "Status",
    ga: "GA",
    preview: "Vorschau",
    available: "Verfügbar",
    availableNow: "Jetzt verfügbar",
    readOn: "Auf der Microsoft-365-Roadmap lesen →",
    noItems: "Diesmal hat keine Microsoft-365-Änderung die Relevanzprüfung bestanden. Nichts zu lesen, nichts zu tun.",
    maintenance: "Wartungsfenster (DATEV)",
    noWindows: (d) => `In den nächsten ${d} Tagen beginnt kein Wartungsfenster.`,
    updateOn: (day) => `DATEV-Update am ${day}`,
    notAvailable: (n) =>
      n === 1
        ? "In diesem Zeitraum sind die DATEV-Systeme nicht verfügbar."
        : "In diesen Zeiträumen sind die DATEV-Systeme nicht verfügbar.",
    rule: "Regel",
    everyItem: "Jeder Beitrag trägt seine Begründung.",
    run: "Lauf",
    models: "Antwortende Modelle",
    repo: "Quellcode",
    sender: "Von 3NET, erstellt mit dem 3NET News Agent.",
    statuses: {
      Launched: "Veröffentlicht",
      "Rolling out": "Wird ausgerollt",
      "In development": "In Entwicklung",
      Cancelled: "Abgesagt",
    },
    ruleText: ruleTextDe,
  },
};

const DE_DAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const LIVE_STATUSES = new Set(["Launched", "Rolling out"]);

function ruleTextDe(rule: MaintenanceRule): string {
  const i = WEEKDAYS.indexOf(rule.weekday);
  const day = DE_DAYS[i]!;
  const endDay = rule.end <= rule.start ? DE_DAYS[(i + 1) % 7]! : day;
  const window = `${day} ${rule.start} bis ${endDay} ${rule.end} Uhr (${rule.timeZone})`;
  return rule.sameDay
    ? `Ein Update wird im ersten Fenster am oder nach dem Update-Tag installiert, ${window}; ein Update an einem ${day} noch am selben Abend.`
    : `Ein Update wird im ersten Fenster nach dem Update-Tag installiert, ${window}; ein Update an einem ${day} im Fenster der Folgewoche.`;
}

/** Badge text: "8/10" and the components below ("7 + 1", "4 + 3, capped"); parts is null without components. */
export function scoreParts(entry: ReportEntry, capped: string): { score: string; parts: string | null } {
  const { score: value, components: c } = entry.rating;
  const score = `${value}/10`;
  if (!c) return { score, parts: null };
  const parts = `${c.baseValue} + ${c.actionBonus}`;
  return { score, parts: c.baseValue + c.actionBonus > value ? `${parts}, ${capped}` : parts };
}

/** "Preview: October 2026 · Available: January 2027"; "Available now" for live items without GA month. */
export function availabilityLine(entry: ReportEntry, language: NewsletterLanguage): string | null {
  const L = LABELS[language];
  const m = entry.item.m365;
  const month = (ym: string) =>
    new Intl.DateTimeFormat(L.locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${ym}-01T00:00:00Z`));
  const parts: string[] = [];
  if (m?.previewMonth) parts.push(`${L.preview}: ${month(m.previewMonth)}`);
  if (m?.gaMonth) parts.push(`${L.available}: ${month(m.gaMonth)}`);
  else if (LIVE_STATUSES.has(entry.item.status)) parts.push(L.availableNow);
  return parts.length ? parts.join(" · ") : null;
}

export function renderNewsletter(report: RunReport, options: RenderOptions): NewsletterContent {
  const L = LABELS[options.language];
  const tz = options.timeZone ?? "Europe/Berlin";
  const dateRange = formatRange(report, L.locale, tz);
  const subject = `3NET ${L.title}, ${dateRange}${options.audience === "reviewers" ? ` (${L.draft})` : ""}`;
  const preheader = L.preheader(report.entries.length);
  return {
    subject,
    preheader,
    html: renderHtmlPart(report, options, L, dateRange, subject, preheader),
    text: renderTextPart(report, options, L, dateRange),
  };
}

function formatRange(report: RunReport, locale: string, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone });
  if (!report.period) return fmt.format(new Date(report.generatedAt));
  return fmt.formatRange(new Date(report.period.from), new Date(report.period.to));
}

function formatWindow(startUtc: string, endUtc: string, locale: string, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  });
  return `${fmt.format(new Date(startUtc))} – ${fmt.format(new Date(endUtc))}`;
}

/** Update date "YYYY-MM-DD" as "Thu 29 Oct" / "Do., 29. Okt.". */
function formatUpdateDay(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

function models(report: RunReport): string[] {
  const all = report.entries.flatMap((e) => [
    answeringModel(e.rating),
    ...(e.summary ? [e.summary.meta?.routedModel ?? e.summary.meta?.responseModel ?? e.summary.model] : []),
  ]);
  return [...new Set(all)];
}

function products(e: ReportEntry): string[] {
  return e.item.m365?.products.length ? e.item.m365.products : (e.rating.components?.products ?? []);
}

/** Reviewers: products, status and GA month as in the roadmap. */
function reviewerMetaLine(e: ReportEntry, L: Labels): string {
  return [
    `${L.products}: ${products(e).join(", ") || "–"}`,
    `${L.status}: ${L.statuses[e.item.status] ?? e.item.status ?? "–"}`,
    `${L.ga}: ${e.item.m365?.gaMonth ?? "–"}`,
  ].join(" · ");
}

function renderHtmlPart(
  report: RunReport,
  options: RenderOptions,
  L: Labels,
  dateRange: string,
  subject: string,
  preheader: string,
): string {
  const c = options.brand.colors;
  const reviewers = options.audience === "reviewers";
  const font = `font-family:${options.brand.fontStack};`;
  const text = (size: number, color: string, extra = "") =>
    `${font}font-size:${size}px;line-height:${Math.round(size * 1.5)}px;mso-line-height-rule:exactly;color:${color};${extra}`;
  const link = (url: string, label: string, size: number) =>
    `<a href="${esc(url)}" style="${text(size, c.accent, "text-decoration:underline;")}">${esc(label)}</a>`;
  const table = (rows: string, attrs = 'width="100%"') =>
    `<table role="presentation" ${attrs} cellpadding="0" cellspacing="0" border="0">${rows}</table>`;
  /** One text row in a card; padTop is the space above it. */
  const row = (html: string, style: string, padTop = 0) => `<tr><td style="padding:${padTop}px 0 0 0;${style}">${html}</td></tr>`;
  const heading = (label: string) =>
    `<tr><td style="padding:28px 0 8px 0;border-bottom:2px solid ${c.accent};${text(20, c.accent, "font-weight:bold;")}">${esc(label)}</td></tr>`;
  const card = (rows: string[]) =>
    `<tr><td style="padding:12px 0 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${c.cardBackground}" style="background-color:${c.cardBackground};"><tr><td style="padding:16px;">${table(rows.join(""))}</td></tr></table></td></tr>`;

  const badge = (e: ReportEntry) => {
    const { score, parts } = scoreParts(e, L.capped);
    const cell = (html: string, size: number, pad: string, extra = "") =>
      `<tr><td align="center" style="padding:${pad};${text(size, c.onAccent, extra)}">${html}</td></tr>`;
    return table(
      cell(esc(score), 22, parts ? "8px 4px 0 4px" : "8px 4px 8px 4px", "font-weight:bold;") +
        (parts ? cell(esc(parts), 12, "0 4px 8px 4px") : ""),
      `width="88" bgcolor="${c.accent}" style="width:88px;background-color:${c.accent};"`,
    );
  };

  const itemCard = (e: ReportEntry) => {
    const http = isHttpUrl(e.item.url);
    const rows = [row(http ? link(e.item.url, e.item.title, 18) : esc(e.item.title), text(18, c.text, "font-weight:bold;"))];
    if (e.summary) {
      rows.push(row(esc(e.summary.text), text(16, c.text), 8));
      if (e.summary.whyItMatters) {
        rows.push(row(`<strong>${esc(L.why)}:</strong> ${esc(e.summary.whyItMatters)}`, text(16, c.text), 8));
      }
    }
    if (reviewers) {
      const reasoning =
        `<td valign="top" width="88" style="width:88px;padding:0;">${badge(e)}</td>` +
        `<td valign="top" style="padding:0 0 0 12px;${text(13, c.mutedText)}"><strong style="color:${c.mutedText};">${esc(L.reasoning)}:</strong> ${esc(e.rating.reasoning)}</td>`;
      rows.push(
        row(table(`<tr><td style="padding:12px 0 0 0;border-top:1px solid ${c.divider};">${table(`<tr>${reasoning}</tr>`)}</td></tr>`), "", 12),
      );
      rows.push(row(esc(reviewerMetaLine(e, L)), text(13, c.mutedText), 12));
    } else {
      rows.push(row(esc(`${L.products}: ${products(e).join(", ") || "–"}`), text(14, c.mutedText), 12));
      const availability = availabilityLine(e, options.language);
      if (availability) rows.push(row(esc(availability), text(14, c.mutedText), 4));
    }
    if (http) rows.push(row(link(e.item.url, L.readOn, 14), text(14, c.accent), 12));
    return card(rows);
  };

  const items = report.entries.length
    ? report.entries.map(itemCard).join("\n")
    : card([row(esc(L.noItems), text(16, c.text))]);

  let maintenance = "";
  if (report.maintenance) {
    const m = report.maintenance;
    const lines = m.windows.length
      ? m.windows.map((w, i) =>
          row(
            `<strong>${esc(L.updateOn(formatUpdateDay(w.updateDate, L.locale)))}:</strong> ${esc(formatWindow(w.startUtc, w.endUtc, L.locale, m.ruleSpec.timeZone))}`,
            text(16, c.text),
            i === 0 ? 0 : 8,
          ),
        )
      : [row(esc(L.noWindows(m.lookaheadDays)), text(16, c.text))];
    const note = reviewers ? `${L.rule}: ${L.ruleText(m.ruleSpec, m.rule)}` : m.windows.length ? L.notAvailable(m.windows.length) : "";
    maintenance =
      heading(L.maintenance) + "\n" + card(lines) + (note ? `\n<tr><td style="padding:8px 0 0 0;${text(13, c.mutedText)}">${esc(note)}</td></tr>` : "");
  }

  const repo = isHttpUrl(options.brand.repoUrl) ? link(options.brand.repoUrl, options.brand.repoUrl, 13) : esc(options.brand.repoUrl);
  const usedModels = models(report);
  const footer = reviewers
    ? `${esc(L.everyItem)}<br>
${esc(L.run)}: ${esc(report.runId)}<br>
${esc(L.models)}: ${usedModels.length ? usedModels.map(esc).join(", ") : "–"}<br>
${esc(L.repo)}: ${repo}`
    : `${esc(L.sender)}<br>
${esc(L.repo)}: ${repo}`;
  const draftNote = reviewers
    ? `<tr><td bgcolor="${c.cardBackground}" style="background-color:${c.cardBackground};border-left:4px solid ${c.accent};padding:12px 16px;${text(14, c.mutedText)}">${esc(L.draftNote)}</td></tr>\n`
    : "";

  return `<!doctype html>
<html lang="${options.language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${c.pageBackground};" bgcolor="${c.pageBackground}">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${c.pageBackground};">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${c.pageBackground}" style="background-color:${c.pageBackground};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
<tr><td style="padding:0 0 16px 0;"><img src="${esc(options.logoSrc)}" width="120" height="49" alt="${esc(options.brand.name)}" style="display:block;border:0;text-decoration:none;"></td></tr>
<tr><td style="${text(26, c.text, "font-weight:bold;")}">${esc(L.title)}</td></tr>
<tr><td style="padding:4px 0 16px 0;${text(15, c.mutedText)}">${esc(dateRange)}</td></tr>
${draftNote}${heading(L.m365)}
${items}
${maintenance}
<tr><td style="padding:32px 0 0 0;${text(13, c.mutedText)}">${footer}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}

function renderTextPart(report: RunReport, options: RenderOptions, L: Labels, dateRange: string): string {
  const reviewers = options.audience === "reviewers";
  const lines: string[] = [`3NET ${L.title}`, dateRange, ""];
  if (reviewers) lines.push(L.draftNote, "");
  lines.push(L.m365.toUpperCase(), "=".repeat(L.m365.length), "");
  if (!report.entries.length) lines.push(L.noItems, "");
  report.entries.forEach((e, i) => {
    lines.push(`${i + 1}. ${e.item.title}`);
    if (e.summary) {
      lines.push(`   ${e.summary.text}`);
      if (e.summary.whyItMatters) lines.push(`   ${L.why}: ${e.summary.whyItMatters}`);
    }
    if (reviewers) {
      const { score, parts } = scoreParts(e, L.capped);
      lines.push(`   [${parts ? `${score}: ${parts}` : score}] ${L.reasoning}: ${e.rating.reasoning}`);
      lines.push(`   ${reviewerMetaLine(e, L)}`);
    } else {
      lines.push(`   ${L.products}: ${products(e).join(", ") || "–"}`);
      const availability = availabilityLine(e, options.language);
      if (availability) lines.push(`   ${availability}`);
    }
    if (isHttpUrl(e.item.url)) lines.push(`   ${L.readOn} ${e.item.url}`);
    lines.push("");
  });
  if (report.maintenance) {
    const m = report.maintenance;
    lines.push(L.maintenance.toUpperCase(), "=".repeat(L.maintenance.length), "");
    if (!m.windows.length) lines.push(L.noWindows(m.lookaheadDays));
    for (const w of m.windows) {
      lines.push(`- ${L.updateOn(formatUpdateDay(w.updateDate, L.locale))}: ${formatWindow(w.startUtc, w.endUtc, L.locale, m.ruleSpec.timeZone)}`);
    }
    if (reviewers) lines.push(`${L.rule}: ${L.ruleText(m.ruleSpec, m.rule)}`);
    else if (m.windows.length) lines.push(L.notAvailable(m.windows.length));
    lines.push("");
  }
  lines.push("--");
  if (reviewers) {
    lines.push(L.everyItem, `${L.run}: ${report.runId}`, `${L.models}: ${models(report).join(", ") || "–"}`);
  } else {
    lines.push(L.sender);
  }
  lines.push(`${L.repo}: ${options.brand.repoUrl}`);
  return lines.join("\n") + "\n";
}
