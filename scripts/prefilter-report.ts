// Runs the prefilter on a saved Zetaris snapshot and prints how many items each rule drops.
// Usage:
//   npx tsx scripts/prefilter-report.ts <snapshot.json> [--now <ISO date>] [--new-days <n> | --no-new]
//                                       [--horizon <m>] [--max <n>] [--ids <id,id,...>] [--profile <path>]
// --now defaults to the timestamp in the snapshot file name, --profile to config/profile.m365.json.

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { toNewsItems } from "../src/adapters/zetaris/m365-mapping.ts";
import {
  DEFAULT_PREFILTER_HORIZON_MONTHS,
  DEFAULT_PREFILTER_NEW_DAYS,
  DEFAULT_RATING_PROFILE,
} from "../src/config.ts";
import { loadProfile } from "../src/domain/profile.ts";
import { m365Rules, prefilter, requiredFields } from "../src/pipeline/prefilter.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    now: { type: "string" },
    "new-days": { type: "string" },
    "no-new": { type: "boolean", default: false },
    horizon: { type: "string" },
    max: { type: "string" },
    ids: { type: "string" },
    profile: { type: "string" },
  },
});

const file = positionals[0];
if (!file) throw new Error("usage: prefilter-report.ts <snapshot.json> [options]");

const now = values.now ? new Date(values.now) : timeFromFileName(file);
if (Number.isNaN(now.getTime())) throw new Error("no valid --now and no timestamp in the file name");
const newDays = values["no-new"] ? null : Number(values["new-days"] ?? DEFAULT_PREFILTER_NEW_DAYS);
const horizonMonths = Number(values.horizon ?? DEFAULT_PREFILTER_HORIZON_MONTHS);
const maxItems = values.max === undefined ? undefined : Number(values.max);

const profile = await loadProfile(values.profile ?? DEFAULT_RATING_PROFILE);
const items = toNewsItems(JSON.parse(await readFile(file, "utf8")) as unknown, now.toISOString());
const result = prefilter(items, {
  rules: [
    requiredFields,
    ...m365Rules({ now, newDays, horizonMonths, outOfScopeProducts: profile.outOfScopeProducts }),
  ],
  ...(maxItems !== undefined && { maxItems }),
});

console.log(`snapshot  ${basename(file)}`);
console.log(`now       ${now.toISOString()}`);
console.log(`settings  new-days=${newDays ?? "off"} horizon=${horizonMonths} max=${maxItems ?? "unlimited"}`);
console.log(`items     ${items.length}`);
for (const [rule, n] of Object.entries(result.droppedByRule)) console.log(`${rule.padEnd(16)} -${n}`);
console.log(`to model  ${result.kept.length}`);
for (const w of result.warnings) console.log(`warning   ${w}`);

for (const id of values.ids?.split(",") ?? []) {
  const d = result.decisions.find((x) => x.itemId === `m365:${id.trim()}`);
  console.log(`id ${id.trim()}: ${d ? `${d.kept ? "kept" : "dropped"} by ${d.ruleId} - ${d.reason}` : "not in snapshot"}`);
}

function timeFromFileName(path: string): Date {
  const m = /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(basename(path));
  return m ? new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : new Date(NaN);
}
