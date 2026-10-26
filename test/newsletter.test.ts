import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, test } from "node:test";
import {
  checkSmtpHost,
  NewsletterMailOutput,
  type NewsletterOptions,
  type SendRaw,
} from "../src/adapters/newsletter/newsletter-mail-output.ts";
import { renderNewsletter, scoreFormula } from "../src/adapters/newsletter/render.ts";
import { contrastRatio, loadBrand, type Brand } from "../src/domain/brand.ts";
import { newsletterConfig, outputKinds } from "../src/config.ts";
import type { NewsItem, Rating } from "../src/domain/types.ts";
import type { ReportEntry, RunReport } from "../src/ports/output.ts";

let brand: Brand;
let outDir: string;
before(async () => {
  brand = await loadBrand();
  outDir = await mkdtemp(join(tmpdir(), "news-agent-newsletter-"));
});
after(async () => {
  await rm(outDir, { recursive: true, force: true });
});

const RULE = { weekday: "sunday", start: "19:00", end: "07:00", timeZone: "Europe/Berlin", sameDay: true } as const;

function entry(o: { title?: string; url?: string; reasoning?: string; base?: 0 | 2 | 4 | 7; bonus?: 0 | 1 | 2 | 3; score?: number; summary?: boolean } = {}): ReportEntry {
  const item: NewsItem = {
    id: "m365:573696",
    source: "m365-roadmap",
    title: o.title ?? "SharePoint: Copilot Search",
    summary: "",
    url: o.url ?? "https://www.microsoft.com/microsoft-365/roadmap?id=573696",
    status: "In development",
    tags: [],
    fetchedAt: "2026-10-26T08:00:00Z",
    raw: null,
    m365: { products: ["SharePoint", "OneDrive"], platforms: [], cloudInstances: ["Worldwide"], gaMonth: "2027-01", previewMonth: null, modifiedAt: null },
  };
  const rating: Rating = {
    itemId: item.id,
    score: o.score ?? 8,
    reasoning: o.reasoning ?? "A core product is the subject, so baseValue is 7.",
    sourceUrl: item.url,
    model: "test/model",
    ratedAt: "2026-10-26T08:00:00Z",
    components: { baseValue: o.base ?? 7, actionBonus: o.bonus ?? 1, excluded: false, products: ["SharePoint"] },
    meta: { durationMs: 1, callDurationsMs: [1], attempts: 1, responseModel: "x", routedModel: "routed/ultra", latencyMs: 1, receiptId: "r", receiptSignature: null, discardedChars: 0, warnings: [] },
  };
  const e: ReportEntry = { item, rating };
  if (o.summary !== false) {
    e.summary = {
      itemId: item.id,
      text: "Search in SharePoint finds files with Copilot.",
      whyItMatters: "You find documents faster.",
      model: "test/model",
      summarisedAt: "2026-10-26T08:00:00Z",
      meta: { durationMs: 1, attempts: 1, responseModel: "x", routedModel: "routed/super", receiptId: "s", discardedChars: 0, warnings: [] },
    };
  }
  return e;
}

function report(entries: ReportEntry[], windows = 1): RunReport {
  return {
    runId: "2026-10-26T08-00-00-000Z",
    generatedAt: "2026-10-26T08:00:00.000Z",
    source: "zetaris",
    scoreThreshold: 5,
    ratingModel: "test/model",
    period: { from: "2026-10-18T08:00:00.000Z", to: "2026-10-26T08:00:00.000Z" },
    entries,
    belowThreshold: [],
    failed: [],
    prefilter: { input: 1, kept: 1, droppedByRule: {}, warnings: [] },
    alreadyReported: [],
    maintenance: {
      rule: "first Sunday on or after the update date, 19:00 to Monday 07:00 (Europe/Berlin); an update on a Sunday is installed the same evening",
      ruleSpec: RULE,
      lookaheadDays: 30,
      windows: Array.from({ length: windows }, () => ({
        uid: "u1",
        summary: "Software update <b>A</b>",
        updateDate: "2026-10-29",
        startLocal: "Sun 2026-11-01 19:00",
        endLocal: "Mon 2026-11-02 07:00",
        startUtc: "2026-11-01T18:00:00.000Z",
        endUtc: "2026-11-02T06:00:00.000Z",
      })),
      warnings: [],
    },
  };
}

const render = (r: RunReport, language: "en" | "de" = "en") => renderNewsletter(r, { language, brand, logoSrc: "cid:logo" });

test("item content: link, summary, why, badge with components, reviewer reasoning, meta line", () => {
  const { html, subject, preheader } = render(report([entry()]));
  assert.match(html, /<a href="https:\/\/www\.microsoft\.com\/microsoft-365\/roadmap\?id=573696"[^>]*>SharePoint: Copilot Search<\/a>/);
  assert.ok(html.includes("Search in SharePoint finds files with Copilot."));
  assert.ok(html.includes("<strong>Why this matters:</strong> You find documents faster."));
  assert.ok(html.includes(">8 = 7 + 1</td>"));
  assert.ok(html.includes("<strong>Agent&#39;s reasoning (for reviewers):</strong> A core product is the subject, so baseValue is 7."));
  assert.ok(html.includes("Products: SharePoint, OneDrive · Status: In development · GA: 2027-01"));
  assert.ok(html.includes("This draft was prepared by the 3NET News Agent and is reviewed by a person before sending."));
  // ICU may put (thin) spaces around the range dash.
  assert.match(subject, /^3NET Microsoft 365 news, 18\s*–\s*26 Oct 2026 \(draft\)$/u);
  assert.equal(preheader, "1 Microsoft 365 change for your daily work, each with its reason.");
  assert.ok(html.includes("routed/ultra, routed/super"));
  assert.ok(html.includes("Every item carries its reason."));
  assert.ok(html.includes('href="https://github.com/shinanDev/3net-news-agent"'));
});

test("mail-safe HTML: tables, 600 px, inline styles only, no scripts, no external resources", () => {
  const { html } = render(report([entry()]));
  assert.match(html, /<table role="presentation" width="600"/);
  assert.ok(!/<style|<script|<link|<iframe|<form/i.test(html));
  assert.ok(html.includes('bgcolor="#0B1A2B"'));
  assert.ok(html.includes("font-family:Calibri, Carlito, Arial, Helvetica, sans-serif;"));
  const srcs = [...html.matchAll(/\ssrc="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(srcs, ["cid:logo"]);
  for (const [, href] of html.matchAll(/\shref="([^"]*)"/g)) assert.match(href!, /^https?:\/\//);
});

test("escaping: script and img in title, reasoning, summary and calendar text", () => {
  const e = entry({ title: '<script>alert(1)</script>', reasoning: '<img src=x onerror="alert(2)">' });
  e.summary!.text = "<script>alert(3)</script>";
  e.summary!.whyItMatters = '<img src="https://tracker.example/p.gif">';
  const { html, text } = render(report([e]));
  assert.ok(!html.includes("<script>"));
  assert.ok(!/<img[^>]*(onerror|tracker)/.test(html));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(2)&quot;&gt;"));
  assert.ok(html.includes("Software update &lt;b&gt;A&lt;/b&gt;"));
  // The plain-text part carries the text as is; it is never rendered as HTML.
  assert.ok(text.includes("<script>alert(1)</script>"));
});

test("only http(s) URLs become links", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,<b>x</b>", "file:///etc/passwd", "not a url"]) {
    const { html, text } = render(report([entry({ url })]));
    assert.ok(!html.includes(`href="${url}`), url);
    assert.ok(!html.includes("javascript:"), url);
    assert.ok(html.includes(">SharePoint: Copilot Search</p>"), url);
    assert.ok(!text.includes(url), url);
  }
});

test("score formula shows caps and works without components", () => {
  assert.equal(scoreFormula(entry({ base: 4, bonus: 3, score: 6 }), "capped"), "6 = 4 + 3, capped");
  const e = entry();
  delete e.rating.components;
  assert.equal(scoreFormula(e, "capped"), "8");
});

test("empty states: no item and no maintenance window", () => {
  const { html, text, preheader } = render(report([], 0));
  assert.ok(html.includes("No Microsoft 365 change passed the relevance check this time. Nothing to read, nothing to do."));
  assert.ok(html.includes("No maintenance window starts in the next 30 days."));
  assert.ok(text.includes("No maintenance window starts in the next 30 days."));
  assert.equal(preheader, "No Microsoft 365 change needs your attention this time.");
  const de = render(report([], 0), "de");
  assert.ok(de.html.includes("Diesmal hat keine Microsoft-365-Änderung die Relevanzprüfung bestanden."));
  assert.ok(de.html.includes("In den nächsten 30 Tagen beginnt kein Wartungsfenster."));
});

test("item without summary: no summary or why line, the rest stays", () => {
  const { html, text } = render(report([entry({ summary: false })]));
  assert.ok(!html.includes("Why this matters"));
  assert.ok(html.includes(">8 = 7 + 1</td>"));
  assert.ok(!text.includes("Why this matters"));
});

test("plain-text part: all content, no HTML", () => {
  const { text } = render(report([entry()]));
  const expected = [
    "3NET Microsoft 365 news",
    "This draft was prepared by the 3NET News Agent and is reviewed by a person before sending.",
    "1. SharePoint: Copilot Search",
    "   https://www.microsoft.com/microsoft-365/roadmap?id=573696",
    "   Search in SharePoint finds files with Copilot.",
    "   Why this matters: You find documents faster.",
    "   [8 = 7 + 1] Agent's reasoning (for reviewers): A core product is the subject, so baseValue is 7.",
    "   Products: SharePoint, OneDrive · Status: In development · GA: 2027-01",
    "- Sun 1 Nov, 19:00 – Mon 2 Nov, 07:00",
    "  Update 29 Oct 2026: Software update <b>A</b>",
    "Every item carries its reason.",
    "Source code: https://github.com/shinanDev/3net-news-agent",
  ];
  for (const line of expected) assert.ok(text.split("\n").includes(line), line);
  assert.match(text.split("\n")[1]!, /^18\s*–\s*26 Oct 2026$/u);
  assert.ok(!/<(table|td|p|a|strong)\b/.test(text));
});

test("German labels, status, dates and maintenance rule", () => {
  const { html, text, subject } = render(report([entry()]), "de");
  assert.match(html, /<html lang="de">/);
  assert.ok(html.includes("<strong>Warum das wichtig ist:</strong>"));
  assert.ok(html.includes("<strong>Begründung des Agenten (für die Prüfung):</strong>"));
  assert.ok(html.includes("Produkte: SharePoint, OneDrive · Status: In Entwicklung · GA: 2027-01"));
  assert.ok(html.includes("Dieser Entwurf wurde vom 3NET News Agent erstellt und wird vor dem Versand von einer Person geprüft."));
  assert.ok(html.includes("Regel: Ein Update wird im ersten Fenster am oder nach dem Update-Tag installiert, Sonntag 19:00 bis Montag 07:00 Uhr (Europe/Berlin); ein Update an einem Sonntag noch am selben Abend."));
  assert.ok(html.includes("Jeder Beitrag trägt seine Begründung."));
  assert.match(subject, /^3NET Microsoft-365-News, 18\.–26\. Okt\. 2026 \(Entwurf\)$/);
  assert.ok(text.includes("So., 1. Nov., 19:00 – Mo., 2. Nov., 07:00"));
  const en = render(report([entry()]));
  assert.ok(en.html.includes("Rule: First Sunday on or after the update date, 19:00 to Monday 07:00 (Europe/Berlin)"));
});

test("brand colors pass WCAG AA (4.5:1) for all text on both backgrounds", () => {
  const c = brand.colors;
  for (const bg of [c.pageBackground, c.cardBackground]) {
    for (const fg of [c.text, c.mutedText, c.accent]) assert.ok(contrastRatio(fg, bg) >= 4.5, `${fg} on ${bg}`);
  }
  assert.ok(contrastRatio(c.onAccent, c.accent) >= 4.5);
  assert.equal(contrastRatio("#000000", "#FFFFFF").toFixed(0), "21");
});

test("SMTP host guard: localhost only unless remote is allowed", () => {
  for (const host of ["localhost", "127.0.0.1", "::1", "LOCALHOST"]) assert.doesNotThrow(() => checkSmtpHost(host, false), host);
  for (const host of ["smtp.example.com", "10.0.0.5", "localhost.example.com", "127.0.0.2"]) {
    assert.throws(() => checkSmtpHost(host, false), /refused: only localhost/, host);
  }
  assert.doesNotThrow(() => checkSmtpHost("smtp.example.com", true));
});

afterEach(async () => {
  for (const f of await readdir(outDir)) await rm(join(outDir, f));
});

function output(o: Partial<NewsletterOptions> = {}) {
  const sent: { host: string; envelope: { from: string; to: string }; raw: Buffer }[] = [];
  const sendRaw: SendRaw = async (smtp, envelope, raw) => {
    sent.push({ host: smtp.host, envelope, raw });
  };
  const out = new NewsletterMailOutput({
    language: "en",
    brand,
    from: "news-agent@localhost",
    to: "review@localhost",
    logoPath: "assets/3net-logo.png",
    outDir,
    sendRaw,
    ...o,
  });
  return { out, sent };
}

test("without SMTP host: writes .eml, review .html and .txt, sends nothing", async () => {
  const { out, sent } = output();
  await out.render(report([entry()]));
  assert.equal(sent.length, 0);
  assert.equal(out.last!.sent, false);
  const eml = await readFile(out.last!.eml, "utf8");
  assert.match(eml, /^From: news-agent@localhost$/m);
  assert.match(eml, /^To: review@localhost$/m);
  assert.match(eml, /Content-Type: multipart\/alternative/);
  assert.match(eml, /Content-Type: text\/plain; charset=utf-8/);
  assert.match(eml, /Content-Type: multipart\/related/);
  // CID logo: inline attachment with Content-ID, referenced from the HTML part.
  assert.match(eml, /Content-ID: <logo@3net-news-agent>/);
  assert.match(eml, /Content-Disposition: inline; filename=3net-logo\.png/);
  assert.ok(eml.includes("cid:logo@3net-news-agent"));
  const review = await readFile(out.last!.html, "utf8");
  assert.ok(review.includes('src="data:image/png;base64,'));
  assert.ok(!review.includes("cid:"));
  assert.ok((await readFile(out.last!.text, "utf8")).startsWith("3NET Microsoft 365 news\n"));
});

test("localhost SMTP: sends the exact .eml once", async () => {
  const { out, sent } = output({ smtp: { host: "127.0.0.1", port: 1025, allowRemote: false } });
  await out.render(report([entry()]));
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0]!.envelope, { from: "news-agent@localhost", to: "review@localhost" });
  assert.deepEqual(sent[0]!.raw, await readFile(out.last!.eml));
  assert.equal(out.last!.sent, true);
});

test("remote SMTP host is refused before anything is written or sent", async () => {
  const { out, sent } = output({ smtp: { host: "smtp.example.com", port: 25, allowRemote: false } });
  await assert.rejects(out.render(report([entry()])), /SMTP host "smtp\.example\.com" refused/);
  assert.equal(sent.length, 0);
  assert.deepEqual(await readdir(outDir), []);
});

test("config: OUTPUT list and newsletter defaults", () => {
  const saved = { ...process.env };
  try {
    for (const k of ["OUTPUT", "NEWSLETTER_LANGUAGE", "NEWSLETTER_FROM", "NEWSLETTER_TO", "NEWSLETTER_SMTP_HOST", "NEWSLETTER_SMTP_PORT", "NEWSLETTER_ALLOW_REMOTE", "BRAND_LOGO_PATH"]) {
      delete process.env[k];
    }
    assert.deepEqual(outputKinds(), ["html"]);
    process.env["OUTPUT"] = "html, newsletter";
    assert.deepEqual(outputKinds(), ["html", "newsletter"]);
    process.env["OUTPUT"] = "html,mail";
    assert.throws(() => outputKinds(), /OUTPUT must be/);
    assert.deepEqual(newsletterConfig(), {
      language: "en",
      from: "news-agent@localhost",
      to: "review@localhost",
      logoPath: "assets/3net-logo.png",
    });
    process.env["NEWSLETTER_SMTP_HOST"] = "localhost";
    process.env["NEWSLETTER_LANGUAGE"] = "de";
    assert.deepEqual(newsletterConfig().smtp, { host: "localhost", port: 1025, allowRemote: false });
    assert.equal(newsletterConfig().language, "de");
    process.env["NEWSLETTER_LANGUAGE"] = "fr";
    assert.throws(() => newsletterConfig(), /NEWSLETTER_LANGUAGE/);
  } finally {
    process.env = saved;
  }
});
