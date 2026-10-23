import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { toNewsItems } from "../src/adapters/zetaris/m365-mapping.ts";
import type { M365Details, NewsItem } from "../src/domain/types.ts";
import { m365Rules, prefilter, requiredFields, type M365RuleOptions } from "../src/pipeline/prefilter.ts";

const NOW = new Date("2026-10-23T08:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function item(id: string, status: string, m365: Partial<M365Details> | null = {}): NewsItem {
  const base: NewsItem = {
    id,
    source: "test",
    title: `Item ${id}`,
    summary: "",
    url: `https://example.com/${id}`,
    status,
    tags: [],
    fetchedAt: NOW.toISOString(),
    raw: null,
  };
  if (m365 === null) return base;
  return {
    ...base,
    m365: {
      products: [],
      cloudInstances: ["Worldwide (Standard Multi-Tenant)"],
      gaMonth: "2026-11",
      previewMonth: null,
      modifiedAt: new Date(NOW.getTime() - DAY).toISOString(),
      ...m365,
    },
  };
}

const OUT_OF_SCOPE = {
  prefixes: ["Dynamics 365", "Power "],
  exact: ["Microsoft Dataverse", "Microsoft Power Platform governance and administration", "Microsoft Copilot Studio"],
};

function run(items: NewsItem[], opts: Partial<M365RuleOptions> = {}, maxItems?: number) {
  const rules = [
    requiredFields,
    ...m365Rules({ now: NOW, newDays: 8, horizonMonths: 3, outOfScopeProducts: OUT_OF_SCOPE, ...opts }),
  ];
  return prefilter(items, { rules, ...(maxItems !== undefined && { maxItems }) });
}

function decision(result: ReturnType<typeof run>, id: string) {
  return result.decisions.find((d) => d.itemId === id)!;
}

test("VF-NEU keeps items modified exactly N days ago and drops older ones", () => {
  const exact = new Date(NOW.getTime() - 8 * DAY).toISOString();
  const older = new Date(NOW.getTime() - 8 * DAY - 1).toISOString();
  const r = run([item("a", "Launched", { modifiedAt: exact }), item("b", "Launched", { modifiedAt: older }), item("c", "Launched", { modifiedAt: null })]);
  assert.equal(decision(r, "a").kept, true);
  assert.deepEqual(decision(r, "b"), { itemId: "b", kept: false, ruleId: "VF-NEU", reason: "modified 2026-10-15, older than 8 days" });
  assert.equal(decision(r, "c").reason, "no valid modified date");
});

test("VF-NEU can be disabled and now set explicitly", () => {
  const old = item("a", "In development", { modifiedAt: "2025-01-01T00:00:00Z", gaMonth: "2027-01" });
  assert.equal(decision(run([old]), "a").ruleId, "VF-NEU");
  const r = run([old], { newDays: null, now: new Date("2026-10-19T00:00:00Z") });
  assert.equal(decision(r, "a").kept, true);
  assert.ok(!("VF-NEU" in r.droppedByRule));
});

test("VF-CLOUD drops items without a Worldwide cloud", () => {
  const r = run([item("a", "Launched", { cloudInstances: ["GCC", "DoD"] }), item("b", "Launched", { cloudInstances: [] })]);
  assert.equal(decision(r, "a").ruleId, "VF-CLOUD");
  assert.equal(decision(r, "a").reason, "no Worldwide cloud (GCC, DoD)");
  assert.equal(decision(r, "b").reason, "no Worldwide cloud (none)");
});

test("VF-STATUS drops Cancelled", () => {
  assert.equal(decision(run([item("a", "Cancelled")]), "a").ruleId, "VF-STATUS");
});

test("VF-HORIZONT keeps live items and limits the rest by GA month", () => {
  const r = run([
    item("live", "Rolling out", { gaMonth: "2028-01" }),
    item("edge", "In development", { gaMonth: "2027-01" }),
    item("beyond", "In development", { gaMonth: "2027-02" }),
    item("passed", "In development", { gaMonth: "2026-08" }),
    item("nodate", "In development", { gaMonth: null }),
  ]);
  assert.equal(decision(r, "live").kept, true);
  assert.equal(decision(r, "edge").kept, true);
  assert.deepEqual(decision(r, "beyond"), { itemId: "beyond", kept: false, ruleId: "VF-HORIZONT", reason: "GA 2027-02 beyond horizon 2027-01" });
  assert.deepEqual(decision(r, "passed"), {
    itemId: "passed",
    kept: true,
    ruleId: "all",
    reason: "passed all rules; VF-HORIZONT: GA 2026-08 passed, still in development",
  });
  assert.equal(decision(r, "nodate").reason, "no GA month, status In development");
});

test("VF-HORIZONT crosses the year boundary", () => {
  const r = run([item("a", "In development", { gaMonth: "2027-03" })], {
    now: new Date("2026-12-15T00:00:00Z"),
    newDays: null,
  });
  assert.equal(decision(r, "a").kept, true);
});

test("unknown status is kept and logged as a warning", () => {
  const r = run([item("a", "Planned")]);
  assert.equal(decision(r, "a").kept, true);
  assert.deepEqual(r.warnings, ['a: unknown status "Planned", treated like "In development"']);
});

test("items without m365 details pass the M365 rules", () => {
  const r = run([item("ics", "Event", null)]);
  assert.equal(decision(r, "ics").kept, true);
});

test("first dropping rule decides and drops are counted per rule", () => {
  const r = run([
    item("a", "Cancelled", { cloudInstances: ["GCC"] }),
    item("b", "Cancelled"),
    item("c", "Launched"),
  ]);
  assert.equal(decision(r, "a").ruleId, "VF-CLOUD");
  assert.deepEqual(r.droppedByRule, {
    "required-fields": 0,
    "VF-NEU": 0,
    "VF-CLOUD": 1,
    "VF-STATUS": 1,
    "VF-PRODUCT": 0,
    "VF-HORIZONT": 0,
  });
});

test("VF-PRODUCT drops items whose products are all out of scope", () => {
  const r = run([
    item("prefix", "Launched", { products: ["Power Automate", "Dynamics 365 Sales"] }),
    item("exact", "Launched", { products: ["Microsoft Dataverse", "Microsoft Copilot Studio"] }),
    item("mixed", "Launched", { products: ["Microsoft Copilot (Microsoft 365)", "Dynamics 365 Sales"] }),
    item("ppt", "Launched", { products: ["PowerPoint"] }),
    item("empty", "Launched", { products: [] }),
    item("case", "Launched", { products: ["power automate"] }),
  ]);
  assert.deepEqual(decision(r, "prefix"), {
    itemId: "prefix",
    kept: false,
    ruleId: "VF-PRODUCT",
    reason: "all products out of scope: Power Automate, Dynamics 365 Sales",
  });
  assert.equal(decision(r, "exact").ruleId, "VF-PRODUCT");
  assert.equal(decision(r, "mixed").kept, true);
  assert.equal(decision(r, "ppt").kept, true);
  assert.equal(decision(r, "empty").kept, true);
  assert.equal(decision(r, "case").kept, true, "matching is case-sensitive");
  assert.equal(r.droppedByRule["VF-PRODUCT"], 2);
});

test("VF-PRODUCT runs after VF-STATUS and before VF-HORIZONT", () => {
  const r = run([
    item("cancelled", "Cancelled", { products: ["Power Apps"] }),
    item("beyond", "In development", { products: ["Power Apps"], gaMonth: "2028-01" }),
  ]);
  assert.equal(decision(r, "cancelled").ruleId, "VF-STATUS");
  assert.equal(decision(r, "beyond").ruleId, "VF-PRODUCT");
});

test("RATE_ITEM_IDS: only listed items pass, still through all rules, no VF-LIMIT", () => {
  const items = [
    item("m365:1", "Launched"),
    item("m365:2", "Launched", { products: ["Power Apps"] }),
    item("m365:3", "Launched"),
    item("m365:4", "Launched"),
  ];
  const rules = [
    requiredFields,
    ...m365Rules({ now: NOW, newDays: 8, horizonMonths: 3, outOfScopeProducts: OUT_OF_SCOPE }),
  ];
  const r = prefilter(items, { rules, onlyIds: ["m365:4", "m365:2", "m365:1", "m365:999"], maxItems: 1 });

  assert.deepEqual(r.kept.map((i) => i.id), ["m365:1", "m365:4"], "VF-LIMIT 1 is not applied");
  assert.deepEqual(r.selected, [
    { itemId: "m365:4", kept: true, ruleId: "all", reason: "passed all rules" },
    { itemId: "m365:2", kept: false, ruleId: "VF-PRODUCT", reason: "all products out of scope: Power Apps" },
    { itemId: "m365:1", kept: true, ruleId: "all", reason: "passed all rules" },
    { itemId: "m365:999", kept: false, ruleId: "not-found", reason: "not in the source data" },
  ]);
  assert.deepEqual(r.decisions.find((d) => d.itemId === "m365:3"), {
    itemId: "m365:3",
    kept: false,
    ruleId: "RATE_ITEM_IDS",
    reason: "not listed",
  });
  assert.equal(r.droppedByRule["RATE_ITEM_IDS"], 1);
  assert.equal(r.droppedByRule["VF-PRODUCT"], 1);
  assert.ok(!("VF-LIMIT" in r.droppedByRule));
  assert.deepEqual(r.warnings, [
    "VF-LIMIT ignored because RATE_ITEM_IDS is set",
    "m365:999: listed in RATE_ITEM_IDS but not in the source data",
  ]);
});

test("without RATE_ITEM_IDS there is no selection in the result", () => {
  const r = run([item("a", "Launched")]);
  assert.equal(r.selected, undefined);
  assert.ok(!("RATE_ITEM_IDS" in r.droppedByRule));
});

test("VF-PRODUCT leaves items without m365 details alone", () => {
  assert.equal(decision(run([item("ics", "Event", null)]), "ics").kept, true);
});

test("VF-LIMIT keeps the most recently modified items and records the rest", () => {
  const at = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
  const r = run(
    [item("old", "Launched", { modifiedAt: at(5) }), item("new", "Launched", { modifiedAt: at(1) }), item("mid", "Launched", { modifiedAt: at(3) })],
    {},
    2,
  );
  assert.deepEqual(r.kept.map((i) => i.id), ["new", "mid"]);
  assert.deepEqual(decision(r, "old"), {
    itemId: "old",
    kept: false,
    ruleId: "VF-LIMIT",
    reason: "rank 3 of 3 by modified date (2026-10-18), limit 2",
  });
  assert.equal(r.droppedByRule["VF-LIMIT"], 1);
  assert.equal(r.decisions.length, 3);
});

test("VF-LIMIT is counted as 0 when nothing is cut and absent when unlimited", () => {
  assert.equal(run([item("a", "Launched")], {}, 5).droppedByRule["VF-LIMIT"], 0);
  assert.ok(!("VF-LIMIT" in run([item("a", "Launched")]).droppedByRule));
});

test("fixture rows: decisions on the real sample", async () => {
  const body = JSON.parse(await readFile(new URL("./fixtures/zetaris-m365-sample.json", import.meta.url), "utf8")) as unknown;
  const items = toNewsItems(body, NOW.toISOString());
  const r = run(items, { now: new Date("2026-10-23T08:42:46.706Z") });
  // 577827: Power Automate only. 576761: Dynamics 365 Customer Service only.
  // 560700: modified 2026-09-24, older than 8 days.
  assert.deepEqual(
    r.decisions.map((d) => [d.itemId, d.kept, d.ruleId]),
    [
      ["m365:577827", false, "VF-PRODUCT"],
      ["m365:576761", false, "VF-PRODUCT"],
      ["m365:560700", false, "VF-NEU"],
    ],
  );
  // Without VF-NEU, 560700 (Teams + Copilot, GA 2026-11) passes.
  const noWindow = run(items, { now: new Date("2026-10-23T08:42:46.706Z"), newDays: null });
  assert.equal(noWindow.decisions[2]!.kept, true);
});
