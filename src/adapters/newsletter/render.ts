// Newsletter content: mail-safe HTML (tables, 600 px, inline CSS, bgcolor, no external resources,
// no scripts, no tracking) and a plain-text part. Labels in English and German.
// All text from sources and the model is escaped; only http(s) URLs become links.

import type { Brand } from "../../domain/brand.ts";
import { WEEKDAYS, type MaintenanceRule } from "../../domain/maintenance-window.ts";
import type { ReportEntry, RunReport } from "../../ports/output.ts";
import { answeringModel, esc, isHttpUrl } from "../html/html-file-output.ts";

export type NewsletterLanguage = "en" | "de";
export const NEWSLETTER_LANGUAGES: readonly NewsletterLanguage[] = ["en", "de"];

export interface NewsletterContent {
  subject: string;
  preheader: string;
  html: string;
  text: string;
}

export interface RenderOptions {
  language: NewsletterLanguage;
  brand: Brand;
  /** Image source of the logo, e.g. "cid:logo" in the mail or a data URI in the review copy. */
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
  noItems: string;
  maintenance: string;
  noWindows: (days: number) => string;
  rule: string;
  update: string;
  everyItem: string;
  run: string;
  models: string;
  repo: string;
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
    noItems: "No Microsoft 365 change passed the relevance check this time. Nothing to read, nothing to do.",
    maintenance: "Maintenance windows (DATEV)",
    noWindows: (d) => `No maintenance window starts in the next ${d} days.`,
    rule: "Rule",
    update: "Update",
    everyItem: "Every item carries its reason.",
    run: "Run",
    models: "Answering models",
    repo: "Source code",
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
    noItems: "Diesmal hat keine Microsoft-365-Änderung die Relevanzprüfung bestanden. Nichts zu lesen, nichts zu tun.",
    maintenance: "Wartungsfenster (DATEV)",
    noWindows: (d) => `In den nächsten ${d} Tagen beginnt kein Wartungsfenster.`,
    rule: "Regel",
    update: "Update",
    everyItem: "Jeder Beitrag trägt seine Begründung.",
    run: "Lauf",
    models: "Antwortende Modelle",
    repo: "Quellcode",
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

function ruleTextDe(rule: MaintenanceRule): string {
  const i = WEEKDAYS.indexOf(rule.weekday);
  const day = DE_DAYS[i]!;
  const endDay = rule.end <= rule.start ? DE_DAYS[(i + 1) % 7]! : day;
  const window = `${day} ${rule.start} bis ${endDay} ${rule.end} Uhr (${rule.timeZone})`;
  return rule.sameDay
    ? `Ein Update wird im ersten Fenster am oder nach dem Update-Tag installiert, ${window}; ein Update an einem ${day} noch am selben Abend.`
    : `Ein Update wird im ersten Fenster nach dem Update-Tag installiert, ${window}; ein Update an einem ${day} im Fenster der Folgewoche.`;
}

/** "8 = 7 + 1", "6 = 4 + 3, capped", or just the score without components. */
export function scoreFormula(entry: ReportEntry, capped: string): string {
  const { score, components: c } = entry.rating;
  if (!c) return String(score);
  const formula = `${score} = ${c.baseValue} + ${c.actionBonus}`;
  return c.baseValue + c.actionBonus > score ? `${formula}, ${capped}` : formula;
}

export function renderNewsletter(report: RunReport, options: RenderOptions): NewsletterContent {
  const L = LABELS[options.language];
  const tz = options.timeZone ?? "Europe/Berlin";
  const dateRange = formatRange(report, L.locale, tz);
  const subject = `3NET ${L.title}, ${dateRange} (${L.draft})`;
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

function formatDay(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
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

function metaLine(e: ReportEntry, L: Labels): string {
  const products = e.item.m365?.products.length ? e.item.m365.products : (e.rating.components?.products ?? []);
  return [
    `${L.products}: ${products.join(", ") || "–"}`,
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
  const font = `font-family:${options.brand.fontStack};`;
  const tz = options.timeZone ?? "Europe/Berlin";
  const text = (size: number, color: string, extra = "") =>
    `${font}font-size:${size}px;line-height:${Math.round(size * 1.5)}px;color:${color};${extra}`;
  const heading = (label: string) =>
    `<tr><td style="padding:28px 0 8px 0;border-bottom:2px solid ${c.accent};${text(20, c.accent, "font-weight:bold;")}">${esc(label)}</td></tr>`;
  const card = (inner: string) =>
    `<tr><td style="padding:12px 0 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${c.cardBackground}" style="background-color:${c.cardBackground};"><tr><td style="padding:16px;">${inner}</td></tr></table></td></tr>`;

  const items = report.entries.length
    ? report.entries
        .map((e) => {
          const title = isHttpUrl(e.item.url)
            ? `<a href="${esc(e.item.url)}" style="color:${c.accent};text-decoration:underline;">${esc(e.item.title)}</a>`
            : esc(e.item.title);
          const summary = e.summary
            ? `<p style="margin:8px 0 0 0;${text(16, c.text)}">${esc(e.summary.text)}</p>` +
              (e.summary.whyItMatters
                ? `<p style="margin:8px 0 0 0;${text(16, c.text)}"><strong>${esc(L.why)}:</strong> ${esc(e.summary.whyItMatters)}</p>`
                : "")
            : "";
          const badge =
            `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:12px 0 0 0;"><tr>` +
            `<td valign="top" bgcolor="${c.accent}" style="background-color:${c.accent};padding:4px 10px;white-space:nowrap;${text(14, c.onAccent, "font-weight:bold;")}">${esc(scoreFormula(e, L.capped))}</td>` +
            `<td valign="top" style="padding:0 0 0 12px;${text(13, c.mutedText)}"><strong>${esc(L.reasoning)}:</strong> ${esc(e.rating.reasoning)}</td>` +
            `</tr></table>`;
          return card(
            `<p style="margin:0;${text(18, c.text, "font-weight:bold;")}">${title}</p>${summary}${badge}` +
              `<p style="margin:12px 0 0 0;${text(13, c.mutedText)}">${esc(metaLine(e, L))}</p>`,
          );
        })
        .join("\n")
    : card(`<p style="margin:0;${text(16, c.text)}">${esc(L.noItems)}</p>`);

  let maintenance = "";
  if (report.maintenance) {
    const m = report.maintenance;
    const windows = m.windows.length
      ? m.windows
          .map((w) =>
            card(
              `<p style="margin:0;${text(16, c.text, "font-weight:bold;")}">${esc(formatWindow(w.startUtc, w.endUtc, L.locale, m.ruleSpec.timeZone))}</p>` +
                `<p style="margin:4px 0 0 0;${text(14, c.mutedText)}">${esc(L.update)} ${esc(formatDay(w.updateDate, L.locale))}: ${esc(w.summary)}</p>`,
            ),
          )
          .join("\n")
      : card(`<p style="margin:0;${text(16, c.text)}">${esc(L.noWindows(m.lookaheadDays))}</p>`);
    maintenance =
      heading(L.maintenance) +
      "\n" +
      windows +
      `\n<tr><td style="padding:8px 0 0 0;${text(13, c.mutedText)}">${esc(L.rule)}: ${esc(L.ruleText(m.ruleSpec, m.rule))}</td></tr>`;
  }

  const repo = isHttpUrl(options.brand.repoUrl)
    ? `<a href="${esc(options.brand.repoUrl)}" style="color:${c.accent};text-decoration:underline;">${esc(options.brand.repoUrl)}</a>`
    : esc(options.brand.repoUrl);
  const usedModels = models(report);

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
<tr><td style="padding:0 0 16px 0;"><img src="${esc(options.logoSrc)}" width="120" height="49" alt="${esc(options.brand.name)}" style="display:block;border:0;outline:none;text-decoration:none;"></td></tr>
<tr><td style="${text(26, c.text, "font-weight:bold;")}">${esc(L.title)}</td></tr>
<tr><td style="padding:4px 0 16px 0;${text(15, c.mutedText)}">${esc(dateRange)}</td></tr>
<tr><td bgcolor="${c.cardBackground}" style="background-color:${c.cardBackground};border-left:4px solid ${c.accent};padding:12px 16px;${text(14, c.mutedText)}">${esc(L.draftNote)}</td></tr>
${heading(L.m365)}
${items}
${maintenance}
<tr><td style="padding:32px 0 0 0;${text(12, c.mutedText)}">${esc(L.everyItem)}<br>
${esc(L.run)}: ${esc(report.runId)}<br>
${esc(L.models)}: ${usedModels.length ? usedModels.map(esc).join(", ") : "–"}<br>
${esc(L.repo)}: ${repo}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}

function renderTextPart(report: RunReport, options: RenderOptions, L: Labels, dateRange: string): string {
  const lines: string[] = [`3NET ${L.title}`, dateRange, "", L.draftNote, "", L.m365.toUpperCase(), "=".repeat(L.m365.length), ""];
  if (!report.entries.length) lines.push(L.noItems, "");
  report.entries.forEach((e, i) => {
    lines.push(`${i + 1}. ${e.item.title}`);
    if (isHttpUrl(e.item.url)) lines.push(`   ${e.item.url}`);
    if (e.summary) {
      lines.push(`   ${e.summary.text}`);
      if (e.summary.whyItMatters) lines.push(`   ${L.why}: ${e.summary.whyItMatters}`);
    }
    lines.push(`   [${scoreFormula(e, L.capped)}] ${L.reasoning}: ${e.rating.reasoning}`);
    lines.push(`   ${metaLine(e, L)}`, "");
  });
  if (report.maintenance) {
    const m = report.maintenance;
    lines.push(L.maintenance.toUpperCase(), "=".repeat(L.maintenance.length), "");
    if (!m.windows.length) lines.push(L.noWindows(m.lookaheadDays));
    for (const w of m.windows) {
      lines.push(`- ${formatWindow(w.startUtc, w.endUtc, L.locale, m.ruleSpec.timeZone)}`);
      lines.push(`  ${L.update} ${formatDay(w.updateDate, L.locale)}: ${w.summary}`);
    }
    lines.push(`${L.rule}: ${L.ruleText(m.ruleSpec, m.rule)}`, "");
  }
  const usedModels = models(report);
  lines.push("--", L.everyItem, `${L.run}: ${report.runId}`, `${L.models}: ${usedModels.join(", ") || "–"}`, `${L.repo}: ${options.brand.repoUrl}`);
  return lines.join("\n") + "\n";
}
