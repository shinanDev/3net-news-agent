// Entry point. Wires the adapters and starts one pipeline run.
// SOURCE=stub|zetaris selects the news source, RATER=stub|nightshift the rating model
// (both default stub), OUTPUT=html|console the run report (default html, data/out/).
// Memory is still a placeholder.

import {
  ConsoleOutput,
  InMemoryMemoryStore,
  StubNewsSource,
  StubRatingModel,
} from "./adapters/stub/stubs.ts";
import { HtmlFileOutput } from "./adapters/html/html-file-output.ts";
import { NightshiftClient } from "./adapters/nightshift/nightshift-client.ts";
import { NightshiftRatingModel } from "./adapters/nightshift/nightshift-rating-model.ts";
import { loadProfile, type RelevanceProfile } from "./domain/profile.ts";
import { ZetarisClient } from "./adapters/zetaris/zetaris-client.ts";
import { ZetarisNewsSource } from "./adapters/zetaris/zetaris-news-source.ts";
import {
  boolEnv,
  DEFAULT_NIGHTSHIFT_TIMEOUT_MS,
  DEFAULT_PREFILTER_HORIZON_MONTHS,
  DEFAULT_PREFILTER_NEW_DAYS,
  DEFAULT_RATING_LANGUAGE,
  DEFAULT_RATING_PROFILE,
  DEFAULT_ZETARIS_ROW_LIMIT,
  idListEnv,
  intEnv,
  loadEnv,
  optionalIntEnv,
  outputKind,
  raterKind,
  requireEnv,
  sourceKind,
  stringEnv,
} from "./config.ts";
import type { RatingModel } from "./ports/rating-model.ts";
import { m365Rules, requiredFields } from "./pipeline/prefilter.ts";
import { runPipeline } from "./pipeline/run.ts";
import type { NewsSource } from "./ports/news-source.ts";

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
  });
}

// The profile is needed by the prefilter (VF-PRODUCT) and by the rating model.
const profile = await loadProfile(stringEnv("RATING_PROFILE", DEFAULT_RATING_PROFILE));
const source = createSource();
const model = createModel(profile);
const rules = [
  requiredFields,
  ...m365Rules({
    now: new Date(),
    newDays: intEnv("PREFILTER_NEW_DAYS", DEFAULT_PREFILTER_NEW_DAYS),
    horizonMonths: intEnv("PREFILTER_HORIZON_MONTHS", DEFAULT_PREFILTER_HORIZON_MONTHS),
    outOfScopeProducts: profile.outOfScopeProducts,
  }),
];
const maxItems = optionalIntEnv("RATE_MAX_ITEMS");
const onlyIds = idListEnv("RATE_ITEM_IDS")?.map((id) => `m365:${id}`);
const output = outputKind() === "html" ? new HtmlFileOutput() : new ConsoleOutput();
const { log, logPath } = await runPipeline(
  {
    source,
    memory: new InMemoryMemoryStore(),
    model,
    output,
  },
  { rules, ...(maxItems !== undefined && { maxItems }), ...(onlyIds && { onlyIds }) },
);

for (const s of log.stages) console.log(`${s.stage.padEnd(10)} ${s.inputCount} -> ${s.outputCount}`);
if (source instanceof ZetarisNewsSource) console.log(`Snapshot: ${source.lastSnapshotPath}`);
console.log(`Run log: ${logPath}`);
if (output instanceof HtmlFileOutput) console.log(`Report: ${output.lastPath}`);
