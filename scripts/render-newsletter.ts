// Renders the newsletter again from a run log and the run's snapshot, without model calls.
// Usage:
//   npx tsx scripts/render-newsletter.ts --run data/runs/<runId>.json --snapshot data/snapshots/<file>.json
//                                        [--audience reviewers,customers] [--period-days <n>] [--send]
// --audience defaults to both, --period-days is only needed for logs written before the period
// was logged. Language, addresses, logo, signature, partner badge and SMTP settings come from
// NEWSLETTER_* / BRAND_LOGO_PATH; --send sends via NEWSLETTER_SMTP_HOST (localhost only unless
// NEWSLETTER_ALLOW_REMOTE=true).

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { NewsletterMailOutput } from "../src/adapters/newsletter/newsletter-mail-output.ts";
import { NEWSLETTER_AUDIENCES, type NewsletterAudience } from "../src/adapters/newsletter/render.ts";
import { loadNewsletterExtras } from "../src/adapters/newsletter/signature.ts";
import { toNewsItems } from "../src/adapters/zetaris/m365-mapping.ts";
import { loadEnv, newsletterConfig } from "../src/config.ts";
import { loadBrand } from "../src/domain/brand.ts";
import type { RunLog } from "../src/domain/types.ts";
import { reportFromRunLog } from "../src/pipeline/report-from-log.ts";

const { values } = parseArgs({
  options: {
    run: { type: "string" },
    snapshot: { type: "string" },
    audience: { type: "string", default: NEWSLETTER_AUDIENCES.join(",") },
    "period-days": { type: "string" },
    send: { type: "boolean", default: false },
  },
});
if (!values.run || !values.snapshot) throw new Error("usage: render-newsletter.ts --run <log.json> --snapshot <snapshot.json> [options]");
const audiences = values.audience.split(",").map((s) => s.trim());
for (const a of audiences) {
  if (!(NEWSLETTER_AUDIENCES as readonly string[]).includes(a)) throw new Error(`--audience: ${NEWSLETTER_AUDIENCES.join(", ")}`);
}

loadEnv();
const log = JSON.parse(await readFile(values.run, "utf8")) as RunLog;
const items = toNewsItems(JSON.parse(await readFile(values.snapshot, "utf8")) as unknown, log.startedAt);
const report = reportFromRunLog(log, items, {
  ...(values["period-days"] !== undefined && { periodDays: Number(values["period-days"]) }),
});

const { smtp, signaturePath, partnerLogoPath, ...settings } = newsletterConfig();
const extras = await loadNewsletterExtras({
  ...(signaturePath && { signaturePath }),
  ...(partnerLogoPath && { partnerLogoPath }),
});
if (values.send && !smtp) throw new Error("--send needs NEWSLETTER_SMTP_HOST");
const brand = await loadBrand();
console.log(
  `run ${log.runId}: ${report.entries.length} item(s) in the newsletter, ${report.maintenance?.windows.length ?? 0} window(s), ` +
    `signature ${extras.signature ? "on" : "off"}, partner badge ${extras.signature && extras.partnerLogo ? "on" : "off"}`,
);
for (const audience of audiences as NewsletterAudience[]) {
  const out = new NewsletterMailOutput({ ...settings, ...extras, audience, brand, ...(values.send && smtp && { smtp }) });
  await out.render(report);
  console.log(`${audience.padEnd(9)} ${out.last!.eml}${out.last!.sent ? ` (sent via ${smtp!.host}:${smtp!.port})` : ""}`);
}
