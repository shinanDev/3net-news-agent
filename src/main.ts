// Entry point. Wires the adapters and starts one pipeline run.
// SOURCE=stub|zetaris selects the news source, RATER=stub|nightshift the rating model
// (both default stub), OUTPUT=html|console the run report (default html, data/out/),
// MEMORY=none|hmem the "already reported" store (default none). OUTPUT=newsletter (or e.g.
// html,newsletter) adds the newsletter mail draft (NEWSLETTER_*). Items are only remembered
// for later runs with MEMORY_MARK=true. DATEV_MAINTENANCE_ICS_PATH adds upcoming maintenance
// windows to the report.

import {
  ConsoleOutput,
  InMemoryMemoryStore,
  StubNewsSource,
  StubRatingModel,
} from "./adapters/stub/stubs.ts";
import { HmemMemoryStore } from "./adapters/hmem/hmem-memory-store.ts";
import { IcsFileCalendar } from "./adapters/ics/ics-file-calendar.ts";
import { HtmlFileOutput } from "./adapters/html/html-file-output.ts";
import { MultiOutput } from "./adapters/multi-output.ts";
import { NewsletterMailOutput } from "./adapters/newsletter/newsletter-mail-output.ts";
import { loadNewsletterExtras } from "./adapters/newsletter/signature.ts";
import { loadBrand } from "./domain/brand.ts";
import { NightshiftClient } from "./adapters/nightshift/nightshift-client.ts";
import { NightshiftRatingModel } from "./adapters/nightshift/nightshift-rating-model.ts";
import { loadProfile, type RelevanceProfile } from "./domain/profile.ts";
import { ZetarisClient } from "./adapters/zetaris/zetaris-client.ts";
import { ZetarisNewsSource } from "./adapters/zetaris/zetaris-news-source.ts";
import {
  boolEnv,
  DEFAULT_MEMORY_DIR,
  DEFAULT_MEMORY_SIMILARITY_THRESHOLD,
  DEFAULT_NIGHTSHIFT_TIMEOUT_MS,
  DEFAULT_PREFILTER_HORIZON_MONTHS,
  DEFAULT_PREFILTER_NEW_DAYS,
  DEFAULT_RATING_LANGUAGE,
  DEFAULT_RATING_PROFILE,
  DEFAULT_ZETARIS_ROW_LIMIT,
  idListEnv,
  intEnv,
  loadEnv,
  maintenanceConfig,
  memoryKind,
  newsletterConfig,
  optionalIntEnv,
  outputKinds,
  raterKind,
  ratioEnv,
  requireEnv,
  sourceKind,
  stringEnv,
} from "./config.ts";
import type { RatingModel } from "./ports/rating-model.ts";
import { m365Rules, requiredFields } from "./pipeline/prefilter.ts";
import { runPipeline } from "./pipeline/run.ts";
import type { NewsSource } from "./ports/news-source.ts";
import type { Output } from "./ports/output.ts";

loadEnv();

function createSource(): NewsSource {
  if (sourceKind() === "stub") return new StubNewsSource();
  const client = new ZetarisClient({
    restUrl: requireEnv("ZETARIS_REST_URL"),
    orgId: requireEnv("ZETARIS_ORG_ID"),
    apiKey: requireEnv("ZETARIS_API_KEY"),
  });
  return new ZetarisNewsSource(client, { rowLimit: intEnv("ZETARIS_ROW_LIMIT", DEFAULT_ZETARIS_ROW_LIMIT) });
}

function createModel(profile: RelevanceProfile): RatingModel {
  if (raterKind() === "stub") return new StubRatingModel();
  const client = new NightshiftClient({
    baseUrl: requireEnv("METERLESS_BASE_URL"),
    token: requireEnv("METERLESS_RUNTIME_TOKEN"),
    model: requireEnv("METERLESS_MODEL"),
    app: requireEnv("METERLESS_APP"),
    scope: requireEnv("METERLESS_SCOPE"),
    timeoutMs: intEnv("NIGHTSHIFT_TIMEOUT_MS", DEFAULT_NIGHTSHIFT_TIMEOUT_MS),
  });
  return new NightshiftRatingModel(client, {
    profile,
    language: stringEnv("RATING_LANGUAGE", DEFAULT_RATING_LANGUAGE),
    strictModel: boolEnv("RATING_STRICT_MODEL", true),
    summaryLanguage: newsletterConfig().language,
  });
}

// The profile is needed by the prefilter (VF-PRODUCT) and by the rating model.
const profile = await loadProfile(stringEnv("RATING_PROFILE", DEFAULT_RATING_PROFILE));
const source = createSource();
const model = createModel(profile);
const newDays = intEnv("PREFILTER_NEW_DAYS", DEFAULT_PREFILTER_NEW_DAYS);
const rules = [
  requiredFields,
  ...m365Rules({
    now: new Date(),
    newDays,
    horizonMonths: intEnv("PREFILTER_HORIZON_MONTHS", DEFAULT_PREFILTER_HORIZON_MONTHS),
    outOfScopeProducts: profile.outOfScopeProducts,
  }),
];
const maxItems = optionalIntEnv("RATE_MAX_ITEMS");
const onlyIds = idListEnv("RATE_ITEM_IDS")?.map((id) => `m365:${id}`);
const newsletterSettings = newsletterConfig();
const outputs: Output[] = [];
for (const kind of outputKinds()) {
  if (kind === "html") outputs.push(new HtmlFileOutput());
  else if (kind === "console") outputs.push(new ConsoleOutput());
  else {
    const { signaturePath, partnerLogoPath, ...settings } = newsletterSettings;
    const extras = await loadNewsletterExtras({
      ...(signaturePath && { signaturePath }),
      ...(partnerLogoPath && { partnerLogoPath }),
    });
    outputs.push(new NewsletterMailOutput({ ...settings, ...extras, brand: await loadBrand() }));
  }
}
const output = outputs.length === 1 ? outputs[0]! : new MultiOutput(outputs);
const memory =
  memoryKind() === "hmem"
    ? await HmemMemoryStore.create({
        dir: stringEnv("MEMORY_DIR", DEFAULT_MEMORY_DIR),
        threshold: ratioEnv("MEMORY_SIMILARITY_THRESHOLD", DEFAULT_MEMORY_SIMILARITY_THRESHOLD),
      })
    : new InMemoryMemoryStore();
const markReported = boolEnv("MEMORY_MARK", false);
const maintenanceSettings = maintenanceConfig();
const maintenance = maintenanceSettings && {
  calendar: new IcsFileCalendar(maintenanceSettings.icsPath, maintenanceSettings.rule.timeZone),
  rule: maintenanceSettings.rule,
  lookaheadDays: maintenanceSettings.lookaheadDays,
};
const { log, logPath } = await runPipeline(
  {
    source,
    memory,
    model,
    output,
  },
  {
    rules,
    markReported,
    ...(maxItems !== undefined && { maxItems }),
    ...(onlyIds && { onlyIds }),
    ...(maintenance && { maintenance }),
    periodDays: newDays,
  },
);

for (const s of log.stages) console.log(`${s.stage.padEnd(10)} ${s.inputCount} -> ${s.outputCount}`);
if (source instanceof ZetarisNewsSource) console.log(`Snapshot: ${source.lastSnapshotPath}`);
console.log(`Run log: ${logPath}`);
for (const o of outputs) {
  if (o instanceof HtmlFileOutput) console.log(`Report: ${o.lastPath}`);
  if (o instanceof NewsletterMailOutput && o.last) {
    console.log(`Newsletter: ${o.last.eml}, ${o.last.html}${o.last.sent ? ` (sent via ${newsletterSettings.smtp!.host}:${newsletterSettings.smtp!.port})` : " (not sent: NEWSLETTER_SMTP_HOST not set)"}`);
  }
}
