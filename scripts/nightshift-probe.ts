// Diagnoses Nightshift model routing: sends request variants and prints only the response
// model and duration per call (no content, no header values).
// Usage: npx tsx scripts/nightshift-probe.ts <snapshot.json> [A1,A2,A3,B,C,D,E,F,G]
//   One call per listed id; without a list A1-A3, B, C, D run (6 calls).
//   A1-A3:  replica of a minimal manual call (user message only, temperature 0)
//   B:      A plus Accept and the project User-Agent
//   C:      B headers, project system prompt plus a short item
//   D:      B headers, full project prompt for item 577827 from the snapshot
//   E:      A headers, full project prompt for item 577827
//   F:      A plus the project User-Agent only
//   G:      A plus Accept only
//   H1, H2: project headers, "/no_think" as first system message, max_tokens 2000, "Reply with OK."
//   H3, H4: same settings, full rating prompt for item 573696 (passes the prefilter);
//           also reports whether the rating JSON is valid
//   H5:     like H3, plus the values of selected metadata fields (routing, mode, phases, cross-check)
// Also prints routed_model (if present anywhere in the response), the output length and,
// once, the key paths of a response without values.
// Results 2026-10-23 (see CLAUDE.md, "Known issue: model routing"): A pinned 3 of 3 at first,
// B-G routed to other models, and a later control call A1 was routed elsewhere too.

import { readFile } from "node:fs/promises";
import { buildMessages } from "../src/adapters/nightshift/prompt.ts";
import { parseAnswer } from "../src/adapters/nightshift/rating-response.ts";
import { loadProfile } from "../src/domain/profile.ts";
import { toNewsItems } from "../src/adapters/zetaris/m365-mapping.ts";
import { DEFAULT_RATING_PROFILE, loadEnv, requireEnv, USER_AGENT } from "../src/config.ts";
import type { NewsItem } from "../src/domain/types.ts";

const snapshot = process.argv[2];
if (!snapshot) throw new Error("usage: nightshift-probe.ts <snapshot.json>");

loadEnv();
const baseUrl = requireEnv("METERLESS_BASE_URL").replace(/\/+$/, "");
const token = requireEnv("METERLESS_RUNTIME_TOKEN");
const model = requireEnv("METERLESS_MODEL");
const app = requireEnv("METERLESS_APP");
const scope = requireEnv("METERLESS_SCOPE");

const profile = await loadProfile(DEFAULT_RATING_PROFILE);
const items = toNewsItems(JSON.parse(await readFile(snapshot, "utf8")) as unknown, new Date().toISOString());
const full = items.find((i) => i.id === "m365:577827");
if (!full) throw new Error("item 577827 not in snapshot");
const passing = items.find((i) => i.id === "m365:573696");
if (!passing) throw new Error("item 573696 not in snapshot");
const short: NewsItem = { ...full, summary: "Short test item.", title: "Teams: test item" };
const today = new Date().toISOString().slice(0, 10);

const minimalHeaders = {
  Authorization: `Bearer ${token}`,
  "meterless-app": app,
  "meterless-scope": scope,
  "Content-Type": "application/json",
};
const projectHeaders = { ...minimalHeaders, Accept: "application/json", "User-Agent": USER_AGENT };
const okMessages = [{ role: "user", content: "Reply with OK." }];

const noThink = { role: "system", content: "/no_think" };
const fast = { max_tokens: 2000 };

const variants: {
  name: string;
  headers: Record<string, string>;
  messages: unknown[];
  extra?: Record<string, unknown>;
  rating?: boolean;
  metadata?: boolean;
}[] = [
  { name: "A1 minimal", headers: minimalHeaders, messages: okMessages },
  { name: "A2 minimal", headers: minimalHeaders, messages: okMessages },
  { name: "A3 minimal", headers: minimalHeaders, messages: okMessages },
  { name: "B  +Accept +UA", headers: projectHeaders, messages: okMessages },
  { name: "C  system+short", headers: projectHeaders, messages: buildMessages(profile, "en", today, short) },
  { name: "D  full 577827", headers: projectHeaders, messages: buildMessages(profile, "en", today, full) },
  { name: "E  full, min hdr", headers: minimalHeaders, messages: buildMessages(profile, "en", today, full) },
  { name: "F  +UA only", headers: { ...minimalHeaders, "User-Agent": USER_AGENT }, messages: okMessages },
  { name: "G  +Accept only", headers: { ...minimalHeaders, Accept: "application/json" }, messages: okMessages },
  { name: "H1 nothink OK", headers: projectHeaders, messages: [noThink, ...okMessages], extra: fast },
  { name: "H2 nothink OK", headers: projectHeaders, messages: [noThink, ...okMessages], extra: fast },
  {
    name: "H3 nothink rate",
    headers: projectHeaders,
    messages: [noThink, ...buildMessages(profile, "en", today, passing)],
    extra: fast,
    rating: true,
  },
  {
    name: "H4 nothink rate",
    headers: projectHeaders,
    messages: [noThink, ...buildMessages(profile, "en", today, passing)],
    extra: fast,
    rating: true,
  },
  {
    name: "H5 metadata",
    headers: projectHeaders,
    messages: [noThink, ...buildMessages(profile, "en", today, passing)],
    extra: fast,
    rating: true,
    metadata: true,
  },
];

// Metadata fields printed by H5. Content fields (prompt_preview, summary, check messages) are never printed.
const METADATA_PATHS = [
  "meterless.requested_model",
  "meterless.provider_model",
  "meterless.routed_model",
  "meterless.mode",
  "meterless.winning_route",
  "meterless.usage.latency_ms",
  "meterless.consensus.level",
  "meterless.consensus.raced",
  "meterless.consensus.agreed",
  "meterless.receipt.app_policy",
  "meterless.receipt.autopilot",
  "meterless.receipt.routing",
  "meterless.receipt.requested_mode",
  "meterless.receipt.mode",
  "meterless.receipt.quality_race",
  "meterless.receipt.test_time_compute",
  "meterless_cross_check.verifier_ran",
  "meterless_cross_check.verifier_model",
  "meterless_cross_check.verifier_ms",
];

function at(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), value);
}

/** Key paths of a JSON value up to a depth, without values (arrays: first element only). */
function keyPaths(value: unknown, prefix = "", depth = 3): string[] {
  if (depth === 0 || value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.length ? keyPaths(value[0], `${prefix}[0]`, depth) : [];
  return Object.entries(value).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return [path, ...keyPaths(v, path, depth - 1)];
  });
}

/** Finds the first string value under a key named like routed_model anywhere in the response. */
function findRoutedModel(value: unknown): string | null {
  if (value === null || typeof value !== "object") return null;
  for (const [k, v] of Object.entries(value)) {
    if (/^routed_?model$/i.test(k) && typeof v === "string") return v;
    const found = findRoutedModel(v);
    if (found) return found;
  }
  return null;
}

let keysShown = false;

// Exact ids only (A1, A2, A3, B, ...), so a selection never sends more calls than listed.
const ids = variants.map((v) => v.name.split(" ")[0]!);
const selected = (process.argv[3] ?? "A1,A2,A3,B,C,D").split(",").map((s) => s.trim().toUpperCase());
const unknown = selected.filter((s) => !ids.includes(s));
if (unknown.length) throw new Error(`unknown variant(s): ${unknown.join(", ")}; use ${ids.join(", ")}`);
for (const v of variants.filter((x) => selected.includes(x.name.split(" ")[0]!))) {
  const body = JSON.stringify({ model, temperature: 0, messages: v.messages, ...v.extra });
  const started = Date.now();
  let result: string;
  let details = "";
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: v.headers,
      body,
      signal: AbortSignal.timeout(120_000),
    });
    const text = await res.text();
    let responseModel = "(no model field)";
    try {
      const parsed = JSON.parse(text) as { model?: unknown; choices?: { message?: { content?: unknown } }[] };
      if (typeof parsed.model === "string") responseModel = parsed.model;
      const content = parsed.choices?.[0]?.message?.content;
      const length = typeof content === "string" ? content.length : -1;
      details = `routed_model=${findRoutedModel(parsed) ?? "(none)"} output=${length} chars`;
      if (v.rating && typeof content === "string") {
        const answer = parseAnswer(content);
        details += answer.ok
          ? ` rating JSON valid (discarded ${answer.value.discardedChars} chars)`
          : ` rating JSON INVALID (${answer.error})`;
      }
      if (v.metadata) {
        for (const path of METADATA_PATHS) {
          const value = JSON.stringify(at(parsed, path)) ?? "undefined";
          console.log(`  ${path} = ${value.length > 400 ? `${value.slice(0, 400)}... [${value.length} chars]` : value}`);
        }
        const phases = at(parsed, "meterless.phases");
        if (Array.isArray(phases)) {
          for (const p of phases as Record<string, unknown>[]) {
            console.log(`  meterless.phases[] = ${JSON.stringify({ phase: p["phase"], model: p["model"], ms: p["ms"] })}`);
          }
        }
      }
      if (!keysShown) {
        console.log(`response keys (no values): ${keyPaths(parsed).join(", ")}`);
        keysShown = true;
      }
    } catch {
      responseModel = "(not JSON)";
    }
    result = `HTTP ${res.status}  ${responseModel}`;
  } catch (err) {
    result = `failed: ${err instanceof Error ? err.name : "error"}`;
  }
  const ms = Date.now() - started;
  const pinned = result.endsWith(model) ? "pinned" : "OTHER";
  console.log(
    `${v.name.padEnd(16)} ${String(ms).padStart(6)} ms  ${pinned.padEnd(6)}  ${result}  (request ${body.length} chars) ${details}`,
  );
}
