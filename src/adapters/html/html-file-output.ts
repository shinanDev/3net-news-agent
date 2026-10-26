// Internal run report as a plain HTML file in data/out/<runId>.html. No design, no branding.
// All text from sources and the model is escaped; only http(s) URLs become links.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { NewsItem, Rating } from "../../domain/types.ts";
import type { Output, RunReport } from "../../ports/output.ts";

export interface HtmlFileOutputOptions {
  /** Default: data/out */
  outDir?: string;
}

export class HtmlFileOutput implements Output {
  /** Path of the file written by the last render. */
  lastPath: string | undefined;

  constructor(private readonly options: HtmlFileOutputOptions = {}) {}

  async render(report: RunReport): Promise<void> {
    const dir = this.options.outDir ?? join("data", "out");
    await mkdir(dir, { recursive: true });
    this.lastPath = join(dir, `${report.runId}.html`);
    await writeFile(this.lastPath, renderHtml(report), "utf8");
  }
}

export function renderHtml(r: RunReport): string {
  const rated = [...r.entries, ...r.belowThreshold];
  const models = countBy(rated.map((e) => answeringModel(e.rating)));
  const sentToModel = rated.length + r.failed.length;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Run report ${esc(r.runId)}</title>
<style>
body { font-family: sans-serif; max-width: 60rem; margin: 1rem auto; padding: 0 1rem; }
table { border-collapse: collapse; }
th, td { border: 1px solid #999; padding: 0.25rem 0.5rem; text-align: left; vertical-align: top; }
</style>
</head>
<body>
<h1>Run report</h1>
<ul>
<li>Run: ${esc(r.runId)}</li>
<li>Generated: ${esc(r.generatedAt)}</li>
<li>Source: ${esc(r.source)}</li>
<li>Score threshold: ${r.scoreThreshold}</li>
<li>Requested model: ${esc(r.ratingModel)}</li>
<li>Answering models: ${models.length ? models.map(([m, n]) => `${esc(m)} (${n})`).join(", ") : "none"}</li>
</ul>

<h2>Above threshold (${r.entries.length})</h2>
${r.entries.length ? r.entries.map((e) => itemBlock(e.item, e.rating)).join("\n") : "<p>None.</p>"}

<h2>Rated below threshold (${r.belowThreshold.length})</h2>
${
  r.belowThreshold.length
    ? `<table>
<tr><th>Score</th><th>Item</th><th>Components</th><th>Reasoning</th><th>Model</th></tr>
${r.belowThreshold
  .map(
    (e) =>
      `<tr><td>${e.rating.score}</td><td>${link(e.item)}</td><td>${components(e.rating)}</td><td>${esc(e.rating.reasoning)}</td><td>${esc(answeringModel(e.rating))}</td></tr>`,
  )
  .join("\n")}
</table>`
    : "<p>None.</p>"
}

<h2>Rating failed (${r.failed.length})</h2>
${
  r.failed.length
    ? `<table>
<tr><th>Item</th><th>Attempts</th><th>Reason</th></tr>
${r.failed
  .map((f) => `<tr><td>${link(f.item)}</td><td>${f.attempts ?? ""}</td><td>${esc(f.error)}</td></tr>`)
  .join("\n")}
</table>`
    : "<p>None.</p>"
}

<h2>Already reported (${r.alreadyReported.length})</h2>
${
  r.alreadyReported.length
    ? `<table>
<tr><th>Item</th><th>Matched by</th><th>Memory record</th><th>Similarity</th></tr>
${r.alreadyReported
  .map(
    ({ item, finding: f }) =>
      `<tr><td>${link(item)}</td><td>${esc(f.via ?? "")}</td><td>${esc(f.matchId ?? "")}</td><td>${f.similarity ?? ""}</td></tr>`,
  )
  .join("\n")}
</table>`
    : "<p>None.</p>"
}

${r.maintenance ? maintenanceSection(r.maintenance) : ""}
<h2>Prefilter</h2>
<table>
<tr><th>Step</th><th>Items</th></tr>
<tr><td>Fetched</td><td>${r.prefilter.input}</td></tr>
${Object.entries(r.prefilter.droppedByRule)
  .map(([rule, n]) => `<tr><td>Dropped by ${esc(rule)}</td><td>${n}</td></tr>`)
  .join("\n")}
<tr><td>Passed prefilter</td><td>${r.prefilter.kept}</td></tr>
<tr><td>Already reported</td><td>${r.alreadyReported.length}</td></tr>
<tr><td>Sent to model</td><td>${sentToModel}</td></tr>
</table>
${
  r.prefilter.selected
    ? `<h3>Selected items (RATE_ITEM_IDS)</h3>
<table>
<tr><th>Item</th><th>Result</th><th>Rule</th><th>Reason</th></tr>
${r.prefilter.selected
  .map(
    (d) =>
      `<tr><td>${esc(d.itemId)}</td><td>${d.kept ? "passed" : "dropped"}</td><td>${esc(d.ruleId)}</td><td>${esc(d.reason)}</td></tr>`,
  )
  .join("\n")}
</table>`
    : ""
}
${r.prefilter.warnings.length ? `<p>Warnings:</p>\n<ul>\n${r.prefilter.warnings.map((w) => `<li>${esc(w)}</li>`).join("\n")}\n</ul>` : ""}
</body>
</html>
`;
}

function itemBlock(item: NewsItem, rating: Rating): string {
  const facts = [
    `Score: ${rating.score}`,
    `Components: ${components(rating)}`,
    `Status: ${esc(item.status)}`,
    item.m365?.gaMonth ? `GA: ${esc(item.m365.gaMonth)}` : "",
    item.m365?.products.length ? `Products: ${esc(item.m365.products.join(", "))}` : "",
    `Model: ${esc(answeringModel(rating))}`,
    rating.meta?.receiptId ? `Receipt: ${esc(rating.meta.receiptId)}` : "",
  ].filter(Boolean);
  return `<h3>${link(item)}</h3>
<p>${esc(rating.reasoning)}</p>
<ul>
${facts.map((f) => `<li>${f}</li>`).join("\n")}
</ul>`;
}

function maintenanceSection(m: NonNullable<RunReport["maintenance"]>): string {
  const rows = m.windows
    .map(
      (w) =>
        `<tr><td>${esc(w.updateDate)}</td><td>${esc(w.summary)}</td><td>${esc(w.startLocal)} to ${esc(w.endLocal)}</td></tr>`,
    )
    .join("\n");
  return `<h2>Maintenance windows (next ${m.lookaheadDays} days, ${m.windows.length})</h2>
<p>Why this window: ${esc(m.rule)}.</p>
${m.windows.length ? `<table>\n<tr><th>Update date</th><th>Update</th><th>Maintenance window</th></tr>\n${rows}\n</table>` : "<p>None.</p>"}
${m.warnings.length ? `<p>Calendar warnings:</p>\n<ul>\n${m.warnings.map((w) => `<li>${esc(w)}</li>`).join("\n")}\n</ul>` : ""}
`;
}

function components(rating: Rating): string {
  const c = rating.components;
  if (!c) return "";
  return esc(
    `base ${c.baseValue}, bonus ${c.actionBonus}, excluded ${c.excluded}` +
      (c.products.length ? `, products ${c.products.join(", ")}` : ""),
  );
}

/** Model that answered: Meterless routed model, else the response model, else the configured one. */
export function answeringModel(rating: Rating): string {
  return rating.meta?.routedModel ?? rating.meta?.responseModel ?? rating.model;
}

function link(item: NewsItem): string {
  const title = esc(item.title || item.id);
  return isHttpUrl(item.url) ? `<a href="${esc(item.url)}">${title}</a>` : title;
}

export function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function countBy(values: string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
}
