import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { decodeEntities, htmlToText } from "../src/adapters/zetaris/html-text.ts";
import { toNewsItems } from "../src/adapters/zetaris/m365-mapping.ts";
import { ZetarisClient } from "../src/adapters/zetaris/zetaris-client.ts";
import { M365_ROADMAP_SQL, ZetarisNewsSource } from "../src/adapters/zetaris/zetaris-news-source.ts";

// Three shortened rows from a real response (2026-10-23), no personal fields.
const fixture = JSON.parse(
  await readFile(new URL("./fixtures/zetaris-m365-sample.json", import.meta.url), "utf8"),
) as unknown;
const FETCHED_AT = "2026-10-23T12:00:00.000Z";

let snapshotDir: string;
before(async () => {
  snapshotDir = await mkdtemp(join(tmpdir(), "news-agent-snapshots-"));
});
after(async () => {
  await rm(snapshotDir, { recursive: true, force: true });
});

test("maps M365 roadmap rows to NewsItems", () => {
  const [a, b, c] = toNewsItems(fixture, FETCHED_AT);
  assert.deepEqual(
    { id: a!.id, source: a!.source, url: a!.url, status: a!.status, publishedAt: a!.publishedAt, fetchedAt: a!.fetchedAt },
    {
      id: "m365:577827",
      source: "m365-roadmap",
      url: "https://www.microsoft.com/microsoft-365/roadmap?id=577827",
      status: "Launched",
      publishedAt: "2026-10-22T23:45:51.2001553Z",
      fetchedAt: FETCHED_AT,
    },
  );
  assert.deepEqual(a!.tags, ["Web", "General Availability", "Preview"]);
  assert.deepEqual(a!.m365, {
    products: ["Power Automate"],
    cloudInstances: ["Worldwide (Standard Multi-Tenant)"],
    gaMonth: "2026-08",
    previewMonth: "2026-06",
    modifiedAt: "2026-10-22T23:45:51.2001553Z",
  });

  // HTML tags stripped and entities decoded.
  assert.equal(
    b!.summary,
    "center by going to Workforce management > Intraday management > Workforce alert",
  );

  // Line break in title, missing preview date, several products and clouds.
  assert.equal(c!.title, "Microsoft Teams: AI-powered notes for in-person meetings with Facilitator in Teams Rooms on Android");
  assert.equal(c!.m365!.previewMonth, null);
  assert.deepEqual(c!.m365!.products, ["Microsoft Teams", "Microsoft Copilot (Microsoft 365)"]);
  assert.deepEqual(c!.m365!.cloudInstances, ["Worldwide (Standard Multi-Tenant)", "GCC"]);
  assert.equal(c!.m365!.modifiedAt, "2026-09-24T22:58:55.6218549Z");
});

test("keeps parsed raw record without locale", () => {
  const [, , c] = toNewsItems(fixture, FETCHED_AT);
  const raw = c!.raw as Record<string, unknown>;
  assert.ok(!("locale" in raw));
  assert.deepEqual(raw["moreInfoUrls"], []);
  assert.deepEqual(raw["availabilities"], [{ month: "November", ring: "General Availability", year: 2026 }]);
});

test("rejects responses without headers or rows", () => {
  assert.throws(() => toNewsItems({ data: [] }, FETCHED_AT), /headers/);
  assert.throws(() => toNewsItems({ headers: ["id"], data: {} }, FETCHED_AT), /row array/);
});

test("decodes HTML entities", () => {
  assert.equal(decodeEntities("A &amp; B &gt; C &quot;D&quot; &#39;E&#x27; &unknown;"), "A & B > C \"D\" 'E' &unknown;");
  assert.equal(htmlToText("<p>One</p><p>Two&nbsp;&lt;b&gt;</p>"), "One Two <b>");
});

test("source sends the query, writes the snapshot before mapping and warns on a full page", async () => {
  const requests: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(url),
      headers: init!.headers as Record<string, string>,
      body: JSON.parse(String(init!.body)) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(fixture), { status: 200 });
  }) as typeof fetch;
  const client = new ZetarisClient({ restUrl: "http://zetaris.test/api/v1.0/", orgId: "1", apiKey: "test-key" }, fakeFetch);
  const warnings: string[] = [];
  const source = new ZetarisNewsSource(client, {
    rowLimit: 3,
    snapshotDir,
    now: () => new Date(FETCHED_AT),
    warn: (m) => warnings.push(m),
  });

  const items = await source.fetch();

  assert.equal(items.length, 3);
  const [req] = requests;
  assert.equal(req!.url, "http://zetaris.test/api/v1.0/sql-editor/sqls/run");
  assert.equal(req!.headers["Authorization"], "Bearer test-key");
  assert.equal(req!.headers["X-Org-ID"], "1");
  assert.match(req!.headers["X-Request-ID"]!, /^[0-9a-f-]{36}$/);
  assert.equal(req!.body["sql"], M365_ROADMAP_SQL);
  assert.equal(req!.body["source"], "SqlEditor");
  assert.equal(req!.body["limit"], 3);
  assert.match(String(req!.body["queryId"]), /^[0-9a-f-]{36}$/);
  assert.notEqual(req!.body["queryId"], req!.headers["X-Request-ID"]);

  assert.equal(source.lastSnapshotPath, join(snapshotDir, "2026-10-23T12-00-00-000Z.json"));
  assert.deepEqual(JSON.parse(await readFile(source.lastSnapshotPath!, "utf8")), fixture);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /may be truncated/);
});

test("client error message names the status but not the key", async () => {
  const fakeFetch = (async () => new Response("Unauthorized", { status: 401 })) as unknown as typeof fetch;
  const client = new ZetarisClient({ restUrl: "http://zetaris.test", orgId: "1", apiKey: "secret-key" }, fakeFetch);
  await assert.rejects(client.runSql("SELECT 1", 1), (err: Error) => {
    assert.match(err.message, /HTTP 401/);
    assert.ok(!err.message.includes("secret-key"));
    return true;
  });
});
