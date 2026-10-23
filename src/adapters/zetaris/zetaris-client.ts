// Minimal client for the Zetaris SQL editor REST endpoint. One statement per request.

import { randomUUID } from "node:crypto";
import { USER_AGENT } from "../../config.ts";

export interface ZetarisConfig {
  restUrl: string;
  orgId: string;
  apiKey: string;
  /** Default 60 s: the REST table refetches the full source response on every query. */
  timeoutMs?: number;
}

export class ZetarisError extends Error {
  override name = "ZetarisError";
}

export class ZetarisClient {
  constructor(
    private readonly config: ZetarisConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  /** Runs one SQL statement and returns the parsed JSON response body unchanged. */
  async runSql(sql: string, limit: number): Promise<unknown> {
    const url = `${this.config.restUrl.replace(/\/+$/, "")}/sql-editor/sqls/run`;
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "X-Org-ID": this.config.orgId,
          "X-Request-ID": randomUUID(),
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        body: JSON.stringify({ queryId: randomUUID(), sql, source: "SqlEditor", limit }),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 60_000),
      });
    } catch (err) {
      const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      throw new ZetarisError(`request to ${url} failed (${reason})`);
    }
    const text = await res.text();
    if (!res.ok) {
      throw new ZetarisError(`HTTP ${res.status} from ${url}: ${text.slice(0, 300)}`);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new ZetarisError(`response from ${url} is not JSON: ${text.slice(0, 300)}`);
    }
  }
}
