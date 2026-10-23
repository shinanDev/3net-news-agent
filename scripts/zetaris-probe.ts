// One-off probe: runs the roadmap query with a small limit, saves the raw response
// to data/snapshots/ and prints the response shape plus two rows (long strings shortened).
// Usage: npx tsx scripts/zetaris-probe.ts

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ZetarisClient } from "../src/adapters/zetaris/zetaris-client.ts";
import { loadEnv, requireEnv } from "../src/config.ts";

const SQL = "SELECT item.* FROM m365_roadmap_rest.roadmap_raw2 LATERAL VIEW explode(value) AS item";
const LIMIT = 5;

loadEnv();
const client = new ZetarisClient({
  restUrl: requireEnv("ZETARIS_REST_URL"),
  orgId: requireEnv("ZETARIS_ORG_ID"),
  apiKey: requireEnv("ZETARIS_API_KEY"),
});

const started = Date.now();
const body = await client.runSql(SQL, LIMIT);
console.log(`ok after ${Date.now() - started} ms`);

const dir = join("data", "snapshots");
await mkdir(dir, { recursive: true });
const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-probe.json`);
await writeFile(file, JSON.stringify(body, null, 2) + "\n", "utf8");
console.log(`snapshot: ${file}`);

const shorten = (v: unknown): unknown =>
  typeof v === "string" && v.length > 300 ? `${v.slice(0, 300)}... [${v.length} chars]` : v;
const describe = (v: unknown): string => (Array.isArray(v) ? `array(${v.length})` : v === null ? "null" : typeof v);

if (body && typeof body === "object") {
  const top = body as Record<string, unknown>;
  console.log("top-level keys:", Object.entries(top).map(([k, v]) => `${k}: ${describe(v)}`).join(", "));
  const data = top["data"];
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    console.log("data keys:", Object.entries(d).map(([k, v]) => `${k}: ${describe(v)}`).join(", "));
  }
  const rows = Array.isArray(data) ? data : undefined;
  if (rows) {
    for (const row of rows.slice(0, 2)) console.log(JSON.stringify(row, (_k, v) => shorten(v), 2));
  }
}
