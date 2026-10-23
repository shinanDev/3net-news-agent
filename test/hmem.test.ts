import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, test } from "node:test";
import { comparedText, HmemMemoryStore } from "../src/adapters/hmem/hmem-memory-store.ts";
import { HtmlFileOutput } from "../src/adapters/html/html-file-output.ts";
import { StubRatingModel } from "../src/adapters/stub/stubs.ts";
import type { NewsItem } from "../src/domain/types.ts";
import type { NewsSource } from "../src/ports/news-source.ts";
import { runPipeline } from "../src/pipeline/run.ts";

const T0 = Date.parse("2026-10-23T12:00:00Z");
const clock = () => T0;
const THRESHOLD = 0.999;

let root: string;
let n = 0;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "news-agent-hmem-"));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});
const freshDir = () => join(root, `mem-${++n}`);

// The adapter must never touch the network (no mining model, no embeddings service).
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
function forbidNetwork() {
  globalThis.fetch = (() => {
    throw new Error("network access in H-MEM adapter");
  }) as typeof fetch;
}

function item(id: string, title: string, platforms = ["Desktop"], clouds = ["Worldwide (Standard Multi-Tenant)"]): NewsItem {
  return {
    id: `m365:${id}`,
    source: "m365-roadmap",
    title,
    summary: "",
    url: `https://www.microsoft.com/microsoft-365/roadmap?id=${id}`,
    status: "Rolling out",
    tags: [],
    fetchedAt: "2026-10-23T00:00:00Z",
    raw: null,
    m365: { products: ["Microsoft Teams"], platforms, cloudInstances: clouds, gaMonth: "2026-11", previewMonth: null, modifiedAt: null },
  };
}

test("exact URL match comes first", async () => {
  forbidNetwork();
  const store = await HmemMemoryStore.create({ dir: freshDir(), threshold: THRESHOLD, clock });
  const a = item("1", "Microsoft Teams: Resizable gallery");
  await store.markReported(a);
  // Same URL, completely different text: still reported, via url.
  const finding = await store.wasReported({ ...a, title: "Something else entirely" });
  assert.equal(finding.reported, true);
  assert.equal(finding.via, "url");
  assert.match(finding.matchId!, /^mem-\d+$/);
});

test("re-published duplicate with a new id is found by similarity", async () => {
  forbidNetwork();
  const store = await HmemMemoryStore.create({ dir: freshDir(), threshold: THRESHOLD, clock });
  await store.markReported(item("1", "Microsoft Teams: Resizable gallery in meetings"));
  // New id and URL, same text up to case and punctuation.
  const finding = await store.wasReported(item("2", "Microsoft Teams - resizable gallery in meetings!"));
  assert.deepEqual({ reported: finding.reported, via: finding.via }, { reported: true, via: "similarity" });
  assert.ok(finding.similarity! >= THRESHOLD);
});

test("platform or cloud variants and similar titles are not suppressed", async () => {
  forbidNetwork();
  const store = await HmemMemoryStore.create({ dir: freshDir(), threshold: THRESHOLD, clock });
  await store.markReported(item("1", "Microsoft Teams: Resizable gallery in meetings", ["Desktop"]));
  for (const other of [
    item("2", "Microsoft Teams: Resizable gallery in meetings", ["iOS"]),
    item("3", "Microsoft Teams: Resizable gallery in meetings", ["Desktop"], ["GCC"]),
    item("4", "Microsoft Teams: Resizable gallery in webinars", ["Desktop"]),
  ]) {
    const finding = await store.wasReported(other);
    assert.equal(finding.reported, false, other.id);
    assert.equal(finding.via, null);
    assert.ok(finding.similarity! < THRESHOLD, `${other.id}: ${finding.similarity}`);
  }
});

test("empty memory reports nothing and has no similarity", async () => {
  const store = await HmemMemoryStore.create({ dir: freshDir(), threshold: THRESHOLD, clock });
  assert.deepEqual(await store.wasReported(item("1", "Anything")), { reported: false, via: null });
});

test("memory persists in the folder across instances", async () => {
  const dir = freshDir();
  const first = await HmemMemoryStore.create({ dir, threshold: THRESHOLD, clock });
  await first.markReported(item("1", "Microsoft Teams: Resizable gallery"));
  const second = await HmemMemoryStore.create({ dir, threshold: THRESHOLD, clock });
  assert.equal((await second.wasReported(item("1", "Microsoft Teams: Resizable gallery"))).via, "url");
  const state = JSON.parse(await readFile(join(dir, "state.json"), "utf8")) as { records: { tags: string[]; source: string }[] };
  assert.deepEqual(state.records[0]!.tags, ["url:https://www.microsoft.com/microsoft-365/roadmap?id=1", "item:m365:1"]);
  assert.equal(state.records[0]!.source, "m365-roadmap:m365:1");
});

test("sleep, dreaming and retrieval never run: the ledger only has create entries", async () => {
  const store = await HmemMemoryStore.create({ dir: freshDir(), threshold: THRESHOLD, clock });
  await store.markReported(item("1", "Microsoft Teams: Resizable gallery"));
  await store.markReported(item("2", "Outlook: New calendar view"));
  await store.wasReported(item("3", "SharePoint: Copilot search"));
  assert.deepEqual(store.ledgerActions(), ["create", "create"]);
});

test("compared text is title plus platforms and clouds", () => {
  assert.equal(
    comparedText(item("1", "Teams: X", ["Desktop", "Web"], ["GCC"])),
    "Teams: X | platforms Desktop Web | cloud GCC",
  );
  const { m365: _ignored, ...plain } = item("2", "Plain title");
  assert.equal(comparedText(plain), "Plain title");
});

test("known limitation: one-character words are ignored by the reference tokenizer", async () => {
  const store = await HmemMemoryStore.create({ dir: freshDir(), threshold: THRESHOLD, clock });
  await store.markReported(item("1", "Sample feature A"));
  // "A" and "B" are dropped by the vendored tokenizer, so both titles compare as identical.
  assert.equal((await store.wasReported(item("2", "Sample feature B"))).via, "similarity");
});

test("demo proof: the second run reports the item as already reported via url", async () => {
  forbidNetwork();
  const dir = freshDir();
  const runsDir = join(root, "runs");
  const source: NewsSource = {
    name: "demo",
    fetch: async () => [
      item("573696", "SharePoint: Copilot Search in SharePoint and OneDrive", ["Web"]),
      item("577000", "Outlook: New calendar sharing options", ["Desktop"]),
    ],
  };
  const run = async (at: string) => {
    const memory = await HmemMemoryStore.create({ dir, threshold: THRESHOLD, clock });
    const output = new HtmlFileOutput({ outDir: join(root, "out") });
    // 573696 scores 8 (above the threshold), 577000 scores 2 (below).
    const model = new StubRatingModel({ "m365:573696": 8, "m365:577000": 2 });
    const result = await runPipeline(
      { source, memory, model, output },
      { runsDir, markReported: true, now: () => new Date(at) },
    );
    return { ...result, html: await readFile(output.lastPath!, "utf8") };
  };

  const first = await run("2026-10-23T12:00:00.000Z");
  assert.deepEqual(first.entries.map((e) => e.item.id), ["m365:573696"]);
  assert.ok(first.html.includes("Already reported (0)"));

  const second = await run("2026-10-30T12:00:00.000Z");
  assert.deepEqual(second.entries, [], "the item is not reported again");
  const memoryStage = second.log.stages.find((s) => s.stage === "memory")!;
  const details = memoryStage.details as { alreadyReported: { itemId: string; via: string; matchId: string }[] };
  assert.deepEqual(details.alreadyReported.map((f) => [f.itemId, f.via, f.matchId]), [["m365:573696", "url", "mem-1"]]);
  assert.ok(second.html.includes("Already reported (1)"));
  assert.ok(second.html.includes("<td>url</td><td>mem-1</td>"));
  // 577000 was below the threshold in run 1, so it was not remembered and is rated again.
  assert.equal(memoryStage.outputCount, 1);
});
