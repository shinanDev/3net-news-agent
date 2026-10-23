// MemoryStore backed by the vendored H-MEM reference (vendor/hmem, unchanged).
// wasReported: exact URL first, then cosine similarity of H-MEM embeddings with its own,
// strict threshold. Only store.add and the exported embed/cosine are used: no query()
// (its score mixes recency and confidence and it writes "read" entries), no mining model,
// and sleep, dreaming and conflict scans are never called.

import type { NewsItem } from "../../domain/types.ts";
import type { MemoryFinding, MemoryStore } from "../../ports/memory-store.ts";

/**
 * The part of the H-MEM reference this adapter uses. The engine is loaded at runtime because
 * the vendored code does not pass this project's stricter type checks; tests cover the shape.
 */
interface HmemRecord {
  id: string;
  tags: string[];
  embedding: number[];
}

interface HmemEngine {
  store: {
    add(input: {
      content: string;
      type: "factual";
      layer: "long_term";
      tags: string[];
      source: string;
      confidence: number;
    }): HmemRecord;
    all(): HmemRecord[];
  };
  ledger: { all(): readonly { action: string }[] };
}

interface HmemModule {
  HMEM: new (opts: { clock?: () => number; persistDir?: string; actor?: string }) => HmemEngine;
  embed(text: string): number[];
  cosine(a: number[], b: number[]): number;
}

const VENDOR_INDEX = new URL("../../../vendor/hmem/src/index.ts", import.meta.url);

export interface HmemMemoryStoreOptions {
  /** Folder for state.json and ledger.jsonl, e.g. data/memory/hmem. */
  dir: string;
  /** Similarity at or above this counts as already reported. Calibrated default: 0.999. */
  threshold: number;
  clock?: () => number;
}

export class HmemMemoryStore implements MemoryStore {
  private constructor(
    private readonly mod: HmemModule,
    private readonly engine: HmemEngine,
    private readonly threshold: number,
  ) {}

  static async create(options: HmemMemoryStoreOptions): Promise<HmemMemoryStore> {
    const mod = (await import(VENDOR_INDEX.href)) as HmemModule;
    const engine = new mod.HMEM({
      persistDir: options.dir,
      actor: "3net-news-agent",
      ...(options.clock && { clock: options.clock }),
    });
    return new HmemMemoryStore(mod, engine, options.threshold);
  }

  async wasReported(item: NewsItem): Promise<MemoryFinding> {
    const records = this.engine.store.all();
    const urlTag = `url:${item.url}`;
    const byUrl = records.find((r) => r.tags.includes(urlTag));
    if (byUrl) return { reported: true, via: "url", matchId: byUrl.id };

    const vector = this.mod.embed(comparedText(item));
    let best: { id: string; similarity: number } | undefined;
    for (const r of records) {
      const similarity = this.mod.cosine(vector, r.embedding);
      if (!best || similarity > best.similarity) best = { id: r.id, similarity };
    }
    if (best && best.similarity >= this.threshold) {
      return { reported: true, via: "similarity", matchId: best.id, similarity: round(best.similarity) };
    }
    return { reported: false, via: null, ...(best && { similarity: round(best.similarity) }) };
  }

  async markReported(item: NewsItem): Promise<void> {
    this.engine.store.add({
      content: comparedText(item),
      type: "factual",
      layer: "long_term",
      tags: [`url:${item.url}`, `item:${item.id}`],
      source: `${item.source}:${item.id}`,
      confidence: 1,
    });
  }

  /** Ledger actions so far, for checks that sleep and dreaming never ran. */
  ledgerActions(): string[] {
    return this.engine.ledger.all().map((e) => e.action);
  }
}

/**
 * Text compared for similarity: title plus platforms and clouds. Calibrated on the 2026-10-23
 * snapshot: with the title alone, platform and cloud variants of one feature look identical.
 */
export function comparedText(item: NewsItem): string {
  if (!item.m365) return item.title;
  return [item.title, `platforms ${item.m365.platforms.join(" ")}`, `cloud ${item.m365.cloudInstances.join(" ")}`].join(
    " | ",
  );
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}
