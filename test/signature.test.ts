import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { NewsletterMailOutput } from "../src/adapters/newsletter/newsletter-mail-output.ts";
import { renderNewsletter, type NewsletterAudience } from "../src/adapters/newsletter/render.ts";
import { loadNewsletterExtras, loadPartnerLogo, loadSignature, type Signature } from "../src/adapters/newsletter/signature.ts";
import { loadBrand, type Brand } from "../src/domain/brand.ts";
import type { RunReport } from "../src/ports/output.ts";

let brand: Brand;
let dir: string;
before(async () => {
  brand = await loadBrand();
  dir = await mkdtemp(join(tmpdir(), "news-agent-signature-"));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

const SIGNATURE: Signature = {
  companyName: "Example GmbH",
  partnerLine: "Example Solution Partner",
  addressLine: "Street 1 | 12345 City",
  phone: "+49 00 000000-0",
  website: "https://www.example.com/",
  email: "info@example.com",
  legalLines: ["Managing directors: Name 1, Name 2", "Register court: City, HRB 00000"],
  privacyUrl: "https://www.example.com/privacy",
};

const REPORT: RunReport = {
  runId: "r1",
  generatedAt: "2026-10-26T08:00:00.000Z",
  source: "stub",
  scoreThreshold: 5,
  ratingModel: "m",
  entries: [],
  belowThreshold: [],
  failed: [],
  prefilter: { input: 0, kept: 0, droppedByRule: {}, warnings: [] },
  alreadyReported: [],
  maintenance: {
    rule: "first Sunday on or after the update date",
    ruleSpec: { weekday: "sunday", start: "19:00", end: "07:00", timeZone: "Europe/Berlin", sameDay: true },
    lookaheadDays: 30,
    windows: [],
    warnings: [],
  },
};

function render(o: { signature?: Signature; partner?: boolean; audience?: NewsletterAudience } = {}) {
  return renderNewsletter(REPORT, {
    language: "en",
    audience: o.audience ?? "customers",
    brand,
    logoSrc: "cid:logo",
    ...(o.signature && { signature: o.signature }),
    ...(o.partner && { partnerLogoSrc: "cid:partner" }),
  });
}

async function file(name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content, "utf8");
  return path;
}

test("the committed example signature loads", async () => {
  const s = await loadSignature("config/signature.example.json");
  assert.equal(s.companyName, "Example GmbH");
  assert.equal(s.website, "https://www.example.com");
  assert.equal(s.legalLines.length, 2);
});

test("signature and badge in both audiences: logo, details, links, badge on a light tile, legal lines", () => {
  for (const audience of ["reviewers", "customers"] as const) {
    const { html, text } = render({ signature: SIGNATURE, partner: true, audience });
    // Small logo with the header's CID, the badge as a second image.
    assert.deepEqual([...html.matchAll(/\ssrc="([^"]*)"/g)].map((m) => m[1]), ["cid:logo", "cid:logo", "cid:partner"], audience);
    assert.match(html, /<img src="cid:logo" width="78" height="32" alt="3NET"/);
    assert.match(html, /font-size:15px;[^"]*font-weight:bold;">Example GmbH<\/td>/);
    assert.ok(html.includes(">Example Solution Partner</td>"));
    assert.ok(html.includes(">Street 1 | 12345 City</td>"));
    assert.ok(html.includes(">+49 00 000000-0</td>"), "phone stays text");
    assert.match(html, /<a href="https:\/\/www\.example\.com\/"[^>]*>www\.example\.com<\/a>/);
    assert.match(html, /<a href="mailto:info@example\.com"[^>]*>info@example\.com<\/a>/);
    assert.match(html, /<td bgcolor="#F5F7FA" style="background-color:#F5F7FA;padding:8px;border-radius:6px;"><img src="cid:partner" width="84" height="84" alt="DATEV Solution Partner"/);
    assert.match(html, /font-size:12px;[^"]*color:#A7C6F1;">Managing directors: Name 1, Name 2<\/td>/);
    assert.match(html, /<a href="https:\/\/www\.example\.com\/privacy" style="[^"]*font-size:12px;[^"]*color:#A7C6F1;[^"]*">Privacy policy<\/a>/);
    // The signature sits above the footer, the maintenance heading stays text only.
    assert.ok(html.indexOf("Example GmbH") < html.indexOf("Source code:"), audience);
    assert.match(html, /<tr><td style="padding:28px 0 8px 0;[^"]*">Maintenance windows \(DATEV\)<\/td><\/tr>/);
    for (const line of ["Example GmbH", "Street 1 | 12345 City", "www.example.com", "info@example.com", "Privacy policy: https://www.example.com/privacy"]) {
      assert.ok(text.includes(line), line);
    }
  }
  assert.ok(render({ signature: SIGNATURE, partner: true }).html.includes("Datenschutz") === false);
  assert.ok(renderNewsletter(REPORT, { language: "de", audience: "customers", brand, logoSrc: "cid:logo", signature: SIGNATURE }).html.includes(">Datenschutz</a>"));
});

test("without signature: no signature block; signature without badge: no badge", () => {
  const none = render().html;
  assert.ok(!none.includes("Example GmbH"));
  assert.deepEqual([...none.matchAll(/\ssrc="([^"]*)"/g)].map((m) => m[1]), ["cid:logo"]);
  const noBadge = render({ signature: SIGNATURE }).html;
  assert.ok(noBadge.includes("Example GmbH"));
  assert.ok(!noBadge.includes("DATEV Solution Partner"));
  assert.ok(!noBadge.includes("#F5F7FA"));
  const minimal = render({ signature: { companyName: "Example GmbH", legalLines: [] } }).html;
  assert.ok(minimal.includes("Example GmbH") && !minimal.includes("mailto:") && !minimal.includes("Privacy policy"));
});

test("signature fields are escaped", () => {
  const { html } = render({
    signature: { ...SIGNATURE, companyName: "<script>alert(1)</script>", partnerLine: '<img src=x onerror="alert(2)">', legalLines: ["A & B <b>"] },
  });
  assert.ok(!html.includes("<script>"));
  assert.ok(!/<img src=x/.test(html));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(2)&quot;&gt;"));
  assert.ok(html.includes("A &amp; B &lt;b&gt;"));
});

test("only https: and mailto: links in the signature, also if the loader is bypassed", () => {
  const { html } = render({
    signature: {
      ...SIGNATURE,
      website: "javascript:alert(1)",
      email: "x@example.com?bcc=other@example.com",
      privacyUrl: "http://www.example.com/privacy",
    },
  });
  const signature = html.slice(html.indexOf("Example GmbH"));
  const hrefs = [...signature.matchAll(/\shref="([^"]*)"/g)].map((m) => m[1]!);
  assert.deepEqual(hrefs, ["https://github.com/shinanDev/3net-news-agent"]);
  assert.ok(html.includes("javascript:alert(1)</td>"), "shown as text, not as a link");
});

test("loader: clear errors naming the variable", async () => {
  await assert.rejects(loadSignature(join(dir, "missing.json")), /^Error: NEWSLETTER_SIGNATURE_PATH: .*missing\.json: cannot read the file \(ENOENT\)/);
  await assert.rejects(loadSignature(await file("bad.json", "{ not json")), /NEWSLETTER_SIGNATURE_PATH: .*bad\.json: not valid JSON/);
  await assert.rejects(loadSignature(await file("array.json", "[]")), /NEWSLETTER_SIGNATURE_PATH: .*expected a JSON object/);
  const write = (name: string, o: Record<string, unknown>) => file(name, JSON.stringify({ companyName: "Example GmbH", ...o }));
  await assert.rejects(loadSignature(await file("noname.json", "{}")), /NEWSLETTER_SIGNATURE_PATH: .*companyName must be a non-empty string/);
  await assert.rejects(loadSignature(await write("http.json", { website: "http://www.example.com" })), /website must be an https:\/\/ URL/);
  await assert.rejects(loadSignature(await write("js.json", { privacyUrl: "javascript:alert(1)" })), /privacyUrl must be an https:\/\/ URL/);
  await assert.rejects(loadSignature(await write("mail.json", { email: "a@example.com?bcc=b@example.com" })), /email must be a plain address/);
  await assert.rejects(loadSignature(await write("legal.json", { legalLines: "one line" })), /legalLines must be an array of strings/);
  await assert.rejects(loadSignature(await write("extra.json", { banner: "Event!" })), /unknown fields: banner/);
  await assert.rejects(loadSignature(await write("phone.json", { phone: 123 })), /phone must be a string/);

  await assert.rejects(loadPartnerLogo(join(dir, "badge.png")), /^Error: NEWSLETTER_PARTNER_LOGO_PATH: .*badge\.png: cannot read the file \(ENOENT\)/);
  await assert.rejects(loadPartnerLogo(join(dir, "badge.svg")), /NEWSLETTER_PARTNER_LOGO_PATH: .*use a \.png, \.jpg or \.gif file/);
  assert.deepEqual(await loadNewsletterExtras({}), {});
});

test("mail: partner badge as a second inline CID attachment, only with a signature", async () => {
  const badge = await loadPartnerLogo("assets/3net-logo.png"); // any PNG; the real badge stays outside the repository
  const out = (o: { signature?: Signature }) =>
    new NewsletterMailOutput({
      language: "en",
      audience: "customers",
      brand,
      from: "news-agent@localhost",
      to: "review@localhost",
      logoPath: "assets/3net-logo.png",
      outDir: dir,
      partnerLogo: badge,
      ...o,
    });
  const withSig = out({ signature: SIGNATURE });
  await withSig.render(REPORT);
  const eml = await readFile(withSig.last!.eml, "utf8");
  assert.match(eml, /Content-ID: <logo@3net-news-agent>/);
  assert.match(eml, /Content-ID: <partner@3net-news-agent>/);
  assert.ok(eml.includes("cid:partner@3net-news-agent"));
  const review = await readFile(withSig.last!.html, "utf8");
  assert.equal(review.match(/src="data:image\/png;base64,/g)?.length, 3);

  const withoutSig = out({});
  await withoutSig.render(REPORT);
  assert.ok(!(await readFile(withoutSig.last!.eml, "utf8")).includes("partner@3net-news-agent"));
});
