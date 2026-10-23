// Rule-based pre-filter, no AI. Each rule has a stable id that ends up in the run log.
// Rules run in order; the first rule that drops an item decides its FilterDecision.
// After the per-item rules, VF-LIMIT caps the number of items that go to the model.

import type { FilterDecision, NewsItem } from "../domain/types.ts";

export interface RuleResult {
  kept: boolean;
  reason: string;
}

export interface RuleContext {
  warn(message: string): void;
}

export interface FilterRule {
  id: string;
  /** Returns null to pass silently, { kept: false } to drop, { kept: true } to pass with a note. */
  check(item: NewsItem, ctx: RuleContext): RuleResult | null;
}

export interface PrefilterOptions {
  rules?: FilterRule[];
  /** VF-LIMIT: keep at most this many items, most recently modified first. Default: unlimited. */
  maxItems?: number;
}

export interface PrefilterResult {
  kept: NewsItem[];
  decisions: FilterDecision[];
  droppedByRule: Record<string, number>;
  warnings: string[];
}

export const requiredFields: FilterRule = {
  id: "required-fields",
  check: (item) => (item.title.trim() && item.url.trim() ? null : { kept: false, reason: "missing title or url" }),
};

export const defaultRules: FilterRule[] = [requiredFields];

export interface M365RuleOptions {
  /** Reference time for VF-NEU and VF-HORIZONT (run date, or rating date for test-set measurements). */
  now: Date;
  /** VF-NEU window in days; null disables VF-NEU. */
  newDays: number | null;
  horizonMonths: number;
}

const LIVE_STATUSES = new Set(["Launched", "Rolling out"]);
const KNOWN_STATUSES = new Set(["Launched", "Rolling out", "In development", "Cancelled"]);

/** M365 Roadmap rules in order VF-NEU, VF-CLOUD, VF-STATUS, VF-HORIZONT. Items without m365 pass. */
export function m365Rules({ now, newDays, horizonMonths }: M365RuleOptions): FilterRule[] {
  const rules: FilterRule[] = [];

  if (newDays !== null) {
    const cutoff = now.getTime() - newDays * 24 * 60 * 60 * 1000;
    rules.push({
      id: "VF-NEU",
      check: (item) => {
        if (!item.m365) return null;
        const modified = Date.parse(item.m365.modifiedAt ?? "");
        if (Number.isNaN(modified)) return { kept: false, reason: "no valid modified date" };
        return modified >= cutoff
          ? null
          : { kept: false, reason: `modified ${item.m365.modifiedAt!.slice(0, 10)}, older than ${newDays} days` };
      },
    });
  }

  rules.push({
    id: "VF-CLOUD",
    check: (item) => {
      if (!item.m365) return null;
      const clouds = item.m365.cloudInstances;
      return clouds.some((c) => c.includes("Worldwide"))
        ? null
        : { kept: false, reason: `no Worldwide cloud (${clouds.join(", ") || "none"})` };
    },
  });

  rules.push({
    id: "VF-STATUS",
    check: (item) => (item.m365 && item.status === "Cancelled" ? { kept: false, reason: "status Cancelled" } : null),
  });

  const runMonth = monthIndex(now);
  const limitMonth = runMonth + horizonMonths;
  rules.push({
    id: "VF-HORIZONT",
    check: (item, ctx) => {
      if (!item.m365 || LIVE_STATUSES.has(item.status)) return null;
      if (!KNOWN_STATUSES.has(item.status)) {
        ctx.warn(`${item.id}: unknown status "${item.status}", treated like "In development"`);
      }
      const ga = item.m365.gaMonth;
      if (!ga) return { kept: false, reason: `no GA month, status ${item.status}` };
      const gaMonth = parseMonth(ga);
      if (gaMonth > limitMonth) {
        return { kept: false, reason: `GA ${ga} beyond horizon ${formatMonth(limitMonth)}` };
      }
      if (gaMonth < runMonth) return { kept: true, reason: `GA ${ga} passed, still ${item.status.toLowerCase()}` };
      return null;
    },
  });

  return rules;
}

export function prefilter(items: NewsItem[], options: PrefilterOptions = {}): PrefilterResult {
  const rules = options.rules ?? defaultRules;
  const warnings: string[] = [];
  const ctx: RuleContext = { warn: (m) => warnings.push(m) };
  const droppedByRule: Record<string, number> = Object.fromEntries(rules.map((r) => [r.id, 0]));
  const decisions = new Map<string, FilterDecision>();
  let kept: NewsItem[] = [];

  for (const item of items) {
    const notes: string[] = [];
    let dropped: FilterDecision | undefined;
    for (const rule of rules) {
      const result = rule.check(item, ctx);
      if (!result) continue;
      if (!result.kept) {
        dropped = { itemId: item.id, kept: false, ruleId: rule.id, reason: result.reason };
        break;
      }
      notes.push(`${rule.id}: ${result.reason}`);
    }
    if (dropped) {
      droppedByRule[dropped.ruleId] = (droppedByRule[dropped.ruleId] ?? 0) + 1;
      decisions.set(item.id, dropped);
    } else {
      kept.push(item);
      const reason = ["passed all rules", ...notes].join("; ");
      decisions.set(item.id, { itemId: item.id, kept: true, ruleId: "all", reason });
    }
  }

  if (options.maxItems !== undefined) {
    const max = options.maxItems;
    droppedByRule["VF-LIMIT"] = 0;
    if (kept.length > max) {
      const ranked = [...kept].sort(byModifiedDesc);
      ranked.slice(max).forEach((item, i) => {
        decisions.set(item.id, {
          itemId: item.id,
          kept: false,
          ruleId: "VF-LIMIT",
          reason: `rank ${max + i + 1} of ${ranked.length} by modified date (${item.m365?.modifiedAt?.slice(0, 10) ?? "none"}), limit ${max}`,
        });
      });
      droppedByRule["VF-LIMIT"] = ranked.length - max;
      const keptIds = new Set(ranked.slice(0, max).map((i) => i.id));
      kept = kept.filter((i) => keptIds.has(i.id));
    }
  }

  return { kept, decisions: items.map((i) => decisions.get(i.id)!), droppedByRule, warnings };
}

/** Most recently modified first; items without a date last; ties by id for a stable order. */
function byModifiedDesc(a: NewsItem, b: NewsItem): number {
  const ta = Date.parse(a.m365?.modifiedAt ?? "");
  const tb = Date.parse(b.m365?.modifiedAt ?? "");
  const va = Number.isNaN(ta) ? -Infinity : ta;
  const vb = Number.isNaN(tb) ? -Infinity : tb;
  return vb - va || a.id.localeCompare(b.id);
}

function monthIndex(d: Date): number {
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

function parseMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return y! * 12 + (m! - 1);
}

function formatMonth(index: number): string {
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}
