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
import {
  availabilityLine,
  renderNewsletter,
  scoreParts,
  type NewsletterAudience,
  type NewsletterLanguage,
} from "../src/adapters/newsletter/render.ts";
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
const URL_573696 = "https://www.microsoft.com/microsoft-365/roadmap?id=573696";

function entry(o: { title?: string; url?: string; reasoning?: string; base?: 0 | 2 | 4 | 7; bonus?: 0 | 1 | 2 | 3; score?: number; summary?: boolean } = {}): ReportEntry {
  const item: NewsItem = {
    id: "m365:573696",
    source: "m365-roadmap",
    title: o.title ?? "SharePoint: Copilot Search",
    summary: "",
    url: o.url ?? URL_573696,
    status: "In development",
    tags: [],
    fetchedAt: "2026-10-26T08:00:00Z",
    raw: null,
    m365: { products: ["SharePoint", "OneDrive"], platforms: [], cloudInstances: ["Worldwide"], gaMonth: "2027-01", previewMonth: "2026-10", modifiedAt: null },
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
      windows: [
        { updateDate: "2026-10-29", startUtc: "2026-11-01T18:00:00.000Z", endUtc: "2026-11-02T06:00:00.000Z", startLocal: "Sun 2026-11-01 19:00", endLocal: "Mon 2026-11-02 07:00" },
        { updateDate: "2026-11-26", startUtc: "2026-11-29T18:00:00.000Z", endUtc: "2026-11-30T06:00:00.000Z", startLocal: "Sun 2026-11-29 19:00", endLocal: "Mon 2026-11-30 07:00" },
      ]
        .slice(0, windows)
        .map((w, i) => ({ uid: `u${i}`, summary: `DATEV Update-Termin <b>${w.updateDate}</b>`, ...w })),
      warnings: [],
    },
  };
}

const render = (r: RunReport, language: NewsletterLanguage = "en", audience: NewsletterAudience = "reviewers") =>
  renderNewsletter(r, { language, audience, brand, logoSrc: "cid:logo" });

test("reviewers: link, summary, why, compact badge, muted reasoning with divider, meta, roadmap link", () => {
  const { html, subject, preheader } = render(report([entry()]));
  assert.match(html, /<a href="https:\/\/www\.microsoft\.com\/microsoft-365\/roadmap\?id=573696"[^>]*>SharePoint: Copilot Search<\/a>/);
  assert.ok(html.includes(">Search in SharePoint finds files with Copilot.</td>"));
  assert.ok(html.includes("<strong>Why this matters:</strong> You find documents faster."));
  // Badge: fixed width, large score, components below.
  assert.match(html, /<table role="presentation" width="88"[^>]*bgcolor="#1F9EFF"/);
  assert.match(html, /font-size:22px;[^"]*font-weight:bold;">8\/10<\/td>/);
  assert.match(html, /font-size:12px;[^"]*">7 \+ 1<\/td>/);
  // Reasoning in the muted color, not the accent, with a thin divider above.
  assert.match(html, /border-top:1px solid #2A4260;/);
  assert.match(html, /color:#A7C6F1;"><strong style="color:#A7C6F1;">Agent&#39;s reasoning \(for reviewers\):<\/strong> A core product is the subject/);
  assert.ok(html.includes("Products: SharePoint, OneDrive · Status: In development · GA: 2027-01"));
  assert.match(html, new RegExp(`<a href="${URL_573696.replace(/[?.]/g, "\\$&")}"[^>]*>Read on the Microsoft 365 Roadmap →</a>`));
  assert.ok(html.includes("This draft was prepared by the 3NET News Agent and is reviewed by a person before sending."));
  // ICU may put (thin) spaces around the range dash.
  assert.match(subject, /^3NET Microsoft 365 news, 18\s*–\s*26 Oct 2026 \(draft\)$/u);
  assert.equal(preheader, "1 Microsoft 365 change for your daily work, each with its reason.");
  assert.ok(html.includes("routed/ultra, routed/super"));
  assert.ok(html.includes("Run: 2026-10-26T08-00-00-000Z"));
  assert.ok(html.includes("Every item carries its reason."));
  assert.ok(html.includes('href="https://github.com/shinanDev/3net-news-agent"'));
});

test("customers: no draft banner, score, reasoning, run id or models; availability and sender line", () => {
  const { html, text, subject } = render(report([entry()]), "en", "customers");
  for (const absent of ["This draft", "8/10", "7 + 1", "Agent&#39;s reasoning", "baseValue", "Run:", "routed/", "Every item", "Status:", "GA:"]) {
    assert.ok(!html.includes(absent), absent);
  }
  for (const absent of ["This draft", "8/10", "Agent's reasoning", "baseValue", "Run:", "routed/"]) assert.ok(!text.includes(absent), absent);
  assert.ok(html.includes(">SharePoint: Copilot Search</a>"));
  assert.ok(html.includes("Search in SharePoint finds files with Copilot."));
  assert.ok(html.includes("<strong>Why this matters:</strong> You find documents faster."));
  assert.ok(html.includes(">Products: SharePoint, OneDrive</td>"));
  assert.ok(html.includes(">Preview: October 2026 · Available: January 2027</td>"));
  assert.ok(html.includes("Read on the Microsoft 365 Roadmap →"));
  assert.ok(html.includes("From 3NET, prepared with the 3NET News Agent."));
  assert.ok(html.includes('href="https://github.com/shinanDev/3net-news-agent"'));
  assert.match(subject, /^3NET Microsoft 365 news, 18\s*–\s*26 Oct 2026$/u);
  assert.ok(html.includes("DATEV systems are not available during this window."));
  assert.ok(!html.includes("Rule:"));
  assert.ok(render(report([entry()], 2), "en", "customers").html.includes("DATEV systems are not available during these windows."));
});

test("availability line: preview and GA month, live without GA, nothing known", () => {
  const e = entry();
  assert.equal(availabilityLine(e, "en"), "Preview: October 2026 · Available: January 2027");
  assert.equal(availabilityLine(e, "de"), "Vorschau: Oktober 2026 · Verfügbar: Januar 2027");
  e.item.m365!.previewMonth = null;
  e.item.m365!.gaMonth = null;
  e.item.status = "Rolling out";
  assert.equal(availabilityLine(e, "en"), "Available now");
  e.item.status = "In development";
  assert.equal(availabilityLine(e, "en"), null);
});

test("maintenance windows: one line per window with the update day, no ICS summary", () => {
  for (const audience of ["reviewers", "customers"] as const) {
    const { html, text } = render(report([entry()], 2), "en", audience);
    assert.ok(html.includes("<strong>DATEV update on Thu 29 Oct:</strong> Sun 1 Nov, 19:00 – Mon 2 Nov, 07:00"), audience);
    assert.ok(html.includes("<strong>DATEV update on Thu 26 Nov:</strong> Sun 29 Nov, 19:00 – Mon 30 Nov, 07:00"), audience);
    assert.ok(!html.includes("Update-Termin") && !text.includes("Update-Termin"), audience);
    assert.ok(text.split("\n").includes("- DATEV update on Thu 29 Oct: Sun 1 Nov, 19:00 – Mon 2 Nov, 07:00"), audience);
  }
  const reviewers = render(report([entry()], 2));
  assert.ok(reviewers.html.includes("Rule: First Sunday on or after the update date, 19:00 to Monday 07:00 (Europe/Berlin)"));
  assert.ok(!reviewers.html.includes("not available during"));
  const de = render(report([entry()], 1), "de", "customers");
  assert.ok(de.html.includes("<strong>DATEV-Update am Do., 29. Okt.:</strong> So., 1. Nov., 19:00 – Mo., 2. Nov., 07:00"));
  assert.ok(de.html.includes("In diesem Zeitraum sind die DATEV-Systeme nicht verfügbar."));
});

test("mail-safe HTML for both audiences: tables, 600 px, inline styles, Outlook line height, no scripts or external resources", () => {
  for (const audience of ["reviewers", "customers"] as const) {
    const { html } = render(report([entry()]), "en", audience);
    assert.match(html, /<table role="presentation" width="600"/);
    assert.ok(!/<style|<script|<link|<iframe|<form|<p[ >]/i.test(html), audience);
    assert.ok(!/white-space|outline/.test(html), audience);
    assert.ok(html.includes('bgcolor="#0B1A2B"'));
    // Every px line height is pinned for Outlook for Windows.
    const lineHeights = html.match(/line-height:\d+px;/g)!.length;
    assert.equal(html.match(/line-height:\d+px;mso-line-height-rule:exactly;/g)?.length, lineHeights - 1, audience); // minus the preheader
    // Every link carries the font itself (Outlook does not inherit it into <a>).
    for (const [, style] of html.matchAll(/<a [^>]*style="([^"]*)"/g)) assert.ok(style!.includes("font-family:Calibri"), audience);
    const srcs = [...html.matchAll(/\ssrc="([^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(srcs, ["cid:logo"]);
    for (const [, href] of html.matchAll(/\shref="([^"]*)"/g)) assert.match(href!, /^https?:\/\//);
    // Footer text at least 13px.
    assert.match(html, /<tr><td style="padding:32px 0 0 0;[^"]*font-size:13px;/);
  }
});

test("escaping: script and img in title, reasoning and summary, both audiences", () => {
  const e = entry({ title: "<script>alert(1)</script>", reasoning: '<img src=x onerror="alert(2)">' });
  e.summary!.text = "<script>alert(3)</script>";
  e.summary!.whyItMatters = '<img src="https://tracker.example/p.gif">';
  for (const audience of ["reviewers", "customers"] as const) {
    const { html, text } = render(report([e]), "en", audience);
    assert.ok(!html.includes("<script>"), audience);
    assert.ok(!/<img[^>]*(onerror|tracker)/.test(html), audience);
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), audience);
    assert.ok(html.includes("&lt;img src=&quot;https://tracker.example/p.gif&quot;&gt;"), audience);
    // The plain-text part carries the text as is; it is never rendered as HTML.
    assert.ok(text.includes("<script>alert(1)</script>"), audience);
  }
  assert.ok(render(report([e])).html.includes("&lt;img src=x onerror=&quot;alert(2)&quot;&gt;"));
});

test("only http(s) URLs become links, and no roadmap link for others", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,<b>x</b>", "file:///etc/passwd", "not a url"]) {
    for (const audience of ["reviewers", "customers"] as const) {
      const { html, text } = render(report([entry({ url })]), "en", audience);
      assert.ok(!html.includes("javascript:"), url);
      assert.ok(!html.includes(`href="${url}`), url);
      assert.ok(!html.includes("Read on the Microsoft 365 Roadmap"), url);
      assert.ok(html.includes(">SharePoint: Copilot Search</td>"), url);
      assert.ok(!text.includes(url), url);
    }
  }
});

test("score parts show caps and work without components", () => {
  assert.deepEqual(scoreParts(entry({ base: 4, bonus: 3, score: 6 }), "capped"), { score: "6/10", parts: "4 + 3, capped" });
  assert.deepEqual(scoreParts(entry(), "capped"), { score: "8/10", parts: "7 + 1" });
  const e = entry();
  delete e.rating.components;
  assert.deepEqual(scoreParts(e, "capped"), { score: "8/10", parts: null });
});

test("empty states for both audiences and languages", () => {
  for (const audience of ["reviewers", "customers"] as const) {
    const { html, text, preheader } = render(report([], 0), "en", audience);
    assert.ok(html.includes("No Microsoft 365 change passed the relevance check this time. Nothing to read, nothing to do."));
    assert.ok(html.includes("No maintenance window starts in the next 30 days."));
    assert.ok(text.includes("No maintenance window starts in the next 30 days."));
    assert.ok(!html.includes("not available during"));
    assert.equal(preheader, "No Microsoft 365 change needs your attention this time.");
    const de = render(report([], 0), "de", audience);
    assert.ok(de.html.includes("Diesmal hat keine Microsoft-365-Änderung die Relevanzprüfung bestanden."));
    assert.ok(de.html.includes("In den nächsten 30 Tagen beginnt kein Wartungsfenster."));
  }
});

test("item without summary: no summary or why line, the rest stays", () => {
  const { html, text } = render(report([entry({ summary: false })]));
  assert.ok(!html.includes("Why this matters"));
  assert.ok(html.includes(">8/10</td>"));
  assert.ok(!text.includes("Why this matters"));
});

test("plain-text part for reviewers and customers", () => {
  const reviewers = render(report([entry()])).text.split("\n");
  for (const line of [
    "3NET Microsoft 365 news",
    "This draft was prepared by the 3NET News Agent and is reviewed by a person before sending.",
    "1. SharePoint: Copilot Search",
    "   Search in SharePoint finds files with Copilot.",
    "   Why this matters: You find documents faster.",
    "   [8/10: 7 + 1] Agent's reasoning (for reviewers): A core product is the subject, so baseValue is 7.",
    "   Products: SharePoint, OneDrive · Status: In development · GA: 2027-01",
    `   Read on the Microsoft 365 Roadmap → ${URL_573696}`,
    "- DATEV update on Thu 29 Oct: Sun 1 Nov, 19:00 – Mon 2 Nov, 07:00",
    "Every item carries its reason.",
    "Source code: https://github.com/shinanDev/3net-news-agent",
  ]) {
    assert.ok(reviewers.includes(line), line);
  }
  assert.match(reviewers[1]!, /^18\s*–\s*26 Oct 2026$/u);

  const customers = render(report([entry()]), "en", "customers").text;
  const lines = customers.split("\n");
  for (const line of [
    "   Products: SharePoint, OneDrive",
    "   Preview: October 2026 · Available: January 2027",
    `   Read on the Microsoft 365 Roadmap → ${URL_573696}`,
    "DATEV systems are not available during this window.",
    "From 3NET, prepared with the 3NET News Agent.",
  ]) {
    assert.ok(lines.includes(line), line);
  }
  assert.ok(!/<(table|td|a|strong)\b/.test(customers));
});

test("German labels for reviewers and customers", () => {
  const { html, subject } = render(report([entry()]), "de");
  assert.match(html, /<html lang="de">/);
  assert.ok(html.includes("<strong>Warum das wichtig ist:</strong>"));
  assert.ok(html.includes("Begründung des Agenten (für die Prüfung):</strong>"));
  assert.ok(html.includes("Produkte: SharePoint, OneDrive · Status: In Entwicklung · GA: 2027-01"));
  assert.ok(html.includes("Auf der Microsoft-365-Roadmap lesen →"));
  assert.ok(html.includes("Regel: Ein Update wird im ersten Fenster am oder nach dem Update-Tag installiert, Sonntag 19:00 bis Montag 07:00 Uhr (Europe/Berlin); ein Update an einem Sonntag noch am selben Abend."));
  assert.ok(html.includes("Jeder Beitrag trägt seine Begründung."));
  assert.match(subject, /^3NET Microsoft-365-News, 18\.\s*–\s*26\. Okt\. 2026 \(Entwurf\)$/u);
  const customers = render(report([entry()]), "de", "customers");
  assert.ok(customers.html.includes(">Vorschau: Oktober 2026 · Verfügbar: Januar 2027</td>"));
  assert.ok(customers.html.includes("Von 3NET, erstellt mit dem 3NET News Agent."));
  assert.ok(!customers.html.includes("Entwurf"));
  assert.match(customers.subject, /^3NET Microsoft-365-News, 18\.\s*–\s*26\. Okt\. 2026$/u);
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
    audience: "reviewers",
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

test("without SMTP host: writes .eml, review .html and .txt per audience, sends nothing", async () => {
  const { out, sent } = output();
  await out.render(report([entry()]));
  assert.equal(sent.length, 0);
  assert.equal(out.last!.sent, false);
  assert.match(out.last!.eml, /2026-10-26T08-00-00-000Z\.newsletter-reviewers\.eml$/);
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

  const customers = output({ audience: "customers" });
  await customers.out.render(report([entry()]));
  assert.match(customers.out.last!.eml, /newsletter-customers\.eml$/);
  assert.ok(!(await readFile(customers.out.last!.eml, "utf8")).includes("(draft)"));
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
    for (const k of ["OUTPUT", "NEWSLETTER_LANGUAGE", "NEWSLETTER_AUDIENCE", "NEWSLETTER_FROM", "NEWSLETTER_TO", "NEWSLETTER_SMTP_HOST", "NEWSLETTER_SMTP_PORT", "NEWSLETTER_ALLOW_REMOTE", "BRAND_LOGO_PATH"]) {
      delete process.env[k];
    }
    assert.deepEqual(outputKinds(), ["html"]);
    process.env["OUTPUT"] = "html, newsletter";
    assert.deepEqual(outputKinds(), ["html", "newsletter"]);
    process.env["OUTPUT"] = "html,mail";
    assert.throws(() => outputKinds(), /OUTPUT must be/);
    assert.deepEqual(newsletterConfig(), {
      language: "en",
      audience: "reviewers",
      from: "news-agent@localhost",
      to: "review@localhost",
      logoPath: "assets/3net-logo.png",
    });
    process.env["NEWSLETTER_SMTP_HOST"] = "localhost";
    process.env["NEWSLETTER_LANGUAGE"] = "de";
    process.env["NEWSLETTER_AUDIENCE"] = "customers";
    assert.deepEqual(newsletterConfig().smtp, { host: "localhost", port: 1025, allowRemote: false });
    assert.equal(newsletterConfig().language, "de");
    assert.equal(newsletterConfig().audience, "customers");
    process.env["NEWSLETTER_AUDIENCE"] = "everyone";
    assert.throws(() => newsletterConfig(), /NEWSLETTER_AUDIENCE/);
    process.env["NEWSLETTER_AUDIENCE"] = "";
    process.env["NEWSLETTER_LANGUAGE"] = "fr";
    assert.throws(() => newsletterConfig(), /NEWSLETTER_LANGUAGE/);
  } finally {
    process.env = saved;
  }
});
