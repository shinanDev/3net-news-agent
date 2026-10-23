import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { isOutOfScopeProduct, loadProfile } from "../src/domain/profile.ts";

let dir: string;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "news-agent-profile-"));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("repository profile loads and has the out-of-scope list", async () => {
  const p = await loadProfile("config/profile.m365.json");
  assert.deepEqual(p.outOfScopeProducts.prefixes, ["Dynamics 365", "Power "]);
  assert.ok(isOutOfScopeProduct("Dynamics 365 Business Central", p.outOfScopeProducts));
  assert.ok(isOutOfScopeProduct("Microsoft Dataverse", p.outOfScopeProducts));
  assert.ok(!isOutOfScopeProduct("PowerPoint", p.outOfScopeProducts));
  assert.ok(!isOutOfScopeProduct("Microsoft Teams", p.outOfScopeProducts));
});

test("profile without or with a malformed out-of-scope list is rejected", async () => {
  const base = JSON.parse(await readFile("config/profile.m365.json", "utf8")) as Record<string, unknown>;
  const variants: [string, unknown][] = [
    ["missing", undefined],
    ["prefixes-not-array", { prefixes: "Power ", exact: [] }],
    ["exact-missing", { prefixes: [] }],
  ];
  for (const [name, value] of variants) {
    const path = join(dir, `${name}.json`);
    await writeFile(path, JSON.stringify({ ...base, outOfScopeProducts: value }), "utf8");
    await assert.rejects(loadProfile(path), /incomplete or has wrong types/, name);
  }
});
