import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { Env } from "../config";
import { crawlSite } from "../crawl/site";
import { diffCrawls } from "../seo/crawl-diff";
import {
  storeCrawlSnapshot,
  listCrawlSnapshots,
  getCrawlSnapshotPages,
  twoMostRecentCrawls,
  deleteCrawlSnapshot,
} from "../db/crawl-store";
import {
  snapshotCrawlResultSchema,
  listCrawlSnapshotsResultSchema,
  compareCrawlsResultSchema,
  deleteCrawlSnapshotResultSchema,
} from "../schemas/crawl-snapshots";
import { jsonResult, errorResult, assertConfirmedDelete } from "./shared";

export function registerCrawlHistoryTools(server: McpServer, env: Env): void {
  server.registerTool(
    "snapshot_crawl",
    {
      description:
        "Crawl a site and store the result as a snapshot in D1 for later crawl-over-crawl comparison and issue-regression detection.",
      inputSchema: z.object({
        url: z.url(),
        limit: z.number().int().min(1).max(20).optional(),
        concurrency: z.number().int().min(1).max(4).optional(),
        label: z.string().min(1).optional(),
      }),
      outputSchema: snapshotCrawlResultSchema,
    },
    async ({ url, limit, concurrency, label }) => {
      if (!env.DB)
        return errorResult(new Error("D1 storage is not configured"));
      try {
        const site = await crawlSite(url, limit, concurrency);
        const capturedAt = new Date().toISOString();
        const { snapshotId, pageCount } = await storeCrawlSnapshot(env.DB, {
          url,
          capturedAt,
          label,
          site,
        });
        return jsonResult(snapshotCrawlResultSchema, {
          snapshotId,
          url,
          pageCount,
          capturedAt,
        });
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "list_crawl_snapshots",
    {
      description: "List stored crawl snapshots for a site, most recent first.",
      inputSchema: z.object({
        url: z.url(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      outputSchema: listCrawlSnapshotsResultSchema,
    },
    async ({ url, limit }) => {
      if (!env.DB)
        return errorResult(new Error("D1 storage is not configured"));
      try {
        const snapshots = await listCrawlSnapshots(env.DB, url, limit);
        return jsonResult(listCrawlSnapshotsResultSchema, {
          url,
          count: snapshots.length,
          snapshots,
        });
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "compare_crawls",
    {
      description:
        "Compare two stored crawl snapshots (defaulting to the two most recent) to surface new/removed pages and new/resolved on-page issues.",
      inputSchema: z.object({
        url: z.url(),
        baseSnapshotId: z.number().int().positive().optional(),
        currentSnapshotId: z.number().int().positive().optional(),
      }),
      outputSchema: compareCrawlsResultSchema,
    },
    async ({ url, baseSnapshotId, currentSnapshotId }) => {
      if (!env.DB)
        return errorResult(new Error("D1 storage is not configured"));
      try {
        let baseId: number;
        let currentId: number;
        if (baseSnapshotId != null && currentSnapshotId != null) {
          baseId = baseSnapshotId;
          currentId = currentSnapshotId;
        } else {
          const pair = await twoMostRecentCrawls(env.DB, url);
          if (!pair)
            return errorResult(
              new Error("Need at least two crawl snapshots to compare"),
            );
          baseId = pair.base.id;
          currentId = pair.current.id;
        }
        const [basePages, currentPages] = await Promise.all([
          getCrawlSnapshotPages(env.DB, baseId),
          getCrawlSnapshotPages(env.DB, currentId),
        ]);
        const diff = diffCrawls(basePages, currentPages);
        return jsonResult(compareCrawlsResultSchema, {
          url,
          baseSnapshotId: baseId,
          currentSnapshotId: currentId,
          diff,
        });
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "delete_crawl_snapshot",
    {
      description:
        "Delete a stored crawl snapshot from D1. Irreversible — requires confirm=true. Mirrors delete_search_console_snapshot for the crawl-snapshot family.",
      inputSchema: z.object({
        snapshotId: z.number().int().positive(),
        confirm: z.boolean(),
      }),
      outputSchema: deleteCrawlSnapshotResultSchema,
    },
    async ({ snapshotId, confirm }) => {
      if (!env.DB)
        return errorResult(new Error("D1 storage is not configured"));
      try {
        assertConfirmedDelete(confirm);
        const deleted = await deleteCrawlSnapshot(env.DB, snapshotId);
        return jsonResult(deleteCrawlSnapshotResultSchema, {
          snapshotId,
          deleted,
        });
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
