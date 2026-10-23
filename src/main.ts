// Entry point. Wires the adapters and starts one pipeline run.
// SOURCE=stub|zetaris selects the news source (default stub). Memory, model and output
// are still placeholders; real ones (H-MEM, Nightshift) follow.

import {
  ConsoleOutput,
  InMemoryMemoryStore,
  StubNewsSource,
  StubRatingModel,
} from "./adapters/stub/stubs.ts";
import { ZetarisClient } from "./adapters/zetaris/zetaris-client.ts";
import { ZetarisNewsSource } from "./adapters/zetaris/zetaris-news-source.ts";
import {
  DEFAULT_PREFILTER_HORIZON_MONTHS,
  DEFAULT_PREFILTER_NEW_DAYS,
  DEFAULT_ZETARIS_ROW_LIMIT,
  intEnv,
  loadEnv,
  optionalIntEnv,
  requireEnv,
  sourceKind,
} from "./config.ts";
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

const source = createSource();
const rules = [
  requiredFields,
  ...m365Rules({
    now: new Date(),
    newDays: intEnv("PREFILTER_NEW_DAYS", DEFAULT_PREFILTER_NEW_DAYS),
    horizonMonths: intEnv("PREFILTER_HORIZON_MONTHS", DEFAULT_PREFILTER_HORIZON_MONTHS),
  }),
];
const maxItems = optionalIntEnv("RATE_MAX_ITEMS");
const { log, logPath } = await runPipeline(
  {
    source,
    memory: new InMemoryMemoryStore(),
    model: new StubRatingModel(),
    output: new ConsoleOutput(),
  },
  { rules, ...(maxItems !== undefined && { maxItems }) },
);

for (const s of log.stages) console.log(`${s.stage.padEnd(10)} ${s.inputCount} -> ${s.outputCount}`);
if (source instanceof ZetarisNewsSource) console.log(`Snapshot: ${source.lastSnapshotPath}`);
console.log(`Run log: ${logPath}`);
