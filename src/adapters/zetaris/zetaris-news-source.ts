// NewsSource for the Microsoft 365 Roadmap, registered in Zetaris as a Lightning REST table.
// Writes the raw response to data/snapshots/<timestamp>.json before mapping.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { NewsItem } from "../../domain/types.ts";
import type { NewsSource } from "../../ports/news-source.ts";
import { parseZetarisResult, toNewsItems } from "./m365-mapping.ts";
import type { ZetarisClient } from "./zetaris-client.ts";

export const M365_ROADMAP_SQL =
  "SELECT item.* FROM m365_roadmap_rest.roadmap_raw2 LATERAL VIEW explode(value) AS item";

export interface ZetarisNewsSourceOptions {
  /** Maximum rows to return. The REST table fetches the full source response regardless. */
  rowLimit: number;
  /** Directory for raw snapshots. Default: data/snapshots */
  snapshotDir?: string;
  now?: () => Date;
  warn?: (message: string) => void;
}

export class ZetarisNewsSource implements NewsSource {
  readonly name = "zetaris-m365-roadmap";
  /** Path of the snapshot written by the last fetch. */
  lastSnapshotPath: string | undefined;

  constructor(
    private readonly client: ZetarisClient,
    private readonly options: ZetarisNewsSourceOptions,
  ) {}

  async fetch(): Promise<NewsItem[]> {
    const now = this.options.now ?? (() => new Date());
    const warn = this.options.warn ?? ((m: string) => console.warn(`warning: ${m}`));
    const body = await this.client.runSql(M365_ROADMAP_SQL, this.options.rowLimit);
    const fetchedAt = now().toISOString();

    const dir = this.options.snapshotDir ?? join("data", "snapshots");
    await mkdir(dir, { recursive: true });
    this.lastSnapshotPath = join(dir, `${fetchedAt.replace(/[:.]/g, "-")}.json`);
    await writeFile(this.lastSnapshotPath, JSON.stringify(body, null, 2) + "\n", "utf8");

    const rowCount = parseZetarisResult(body).rows.length;
    if (rowCount >= this.options.rowLimit) {
      warn(`Zetaris returned ${rowCount} rows, equal to the row limit ${this.options.rowLimit}; result may be truncated`);
    }
    return toNewsItems(body, fetchedAt);
  }
}
