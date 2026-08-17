import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { LIMITS, type Env } from "../config";
import { searchConsoleQuery } from "../google/search-console";
import {
  findStrikingDistanceKeywords,
  findLowCtrOpportunities,
} from "../google/opportunities";
import { diffGscRows } from "../seo/gsc-diff";
import {
  storeGscSnapshot,
  listSnapshots,
  getSnapshotRows,
  twoMostRecent,
  deleteGscSnapshot,
} from "../db/gsc-store";
import { gscQueryResultSchema } from "../schemas/search-console";
import { opportunityResultSchema } from "../schemas/opportunities";
import {
  snapshotSearchConsoleResultSchema,
  listSearchConsoleSnapshotsResultSchema,
  compareSearchConsoleResultSchema,
  deleteSearchConsoleSnapshotResultSchema,
} from "../schemas/gsc-snapshots";
import { jsonResult, errorResult, assertConfirmedDelete } from "./shared";

export function registerSearchConsoleTools(server: McpServer, env: Env): void {
  server.registerTool(
    "search_console_query",
    {
      description:
        "Query Google Search Console Search Analytics (single-tenant) for rows by dimension over a date range.",
      inputSchema: z.object({
        siteUrl: z
          .string()
          .min(1)
          .describe(
            "Search Console property, e.g. 'sc-domain:example.com' or 'https://example.com/'",
          ),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
        dimensions: z
          .array(
            z.enum([
              "query",
              "page",
              "country",
              "device",
              "date",
              "searchAppearance",
            ]),
          )
          .optional(),
        rowLimit: z.number().int().min(1).max(250).optional(),
      }),
      outputSchema: gscQueryResultSchema,
    },
    async ({ siteUrl, startDate, endDate, dimensions, rowLimit }) => {
      try {
        return jsonResult(
          gscQueryResultSchema,
          await searchConsoleQuery(
            { siteUrl, startDate, endDate, dimensions, rowLimit },
            env,
          ),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "find_striking_distance_keywords",
    {
      description:
        "Find Search Console keywords ranking just off page 1 (positions 11-20 by default) — near-term ranking wins.",
      inputSchema: z.object({
        siteUrl: z.string().min(1),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        minPosition: z.number().min(1).max(100).optional(),
        maxPosition: z.number().min(1).max(100).optional(),
        minImpressions: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(250).optional(),
      }),
      outputSchema: opportunityResultSchema,
    },
    async ({
      siteUrl,
      startDate,
      endDate,
      minPosition,
      maxPosition,
      minImpressions,
      limit,
    }) => {
      try {
        return jsonResult(
          opportunityResultSchema,
          await findStrikingDistanceKeywords(
            {
              siteUrl,
              startDate,
              endDate,
              minPosition,
              maxPosition,
              minImpressions,
              limit,
            },
            env,
          ),
        );
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "find_low_ctr_opportunities",
    {
      description:
        "Find Search Console queries with good position and impressions but low CTR — title/meta optimization targets.",
      inputSchema: z.object({
        siteUrl: z.string().min(1),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        maxPosition: z.number().min(1).max(100).optional(),
        minImpressions: z.number().int().min(0).optional(),
        maxCtr: z.number().min(0).max(1).optional(),
        limit: z.number().int().min(1).max(250).optional(),
      }),
      outputSchema: opportunityResultSchema,
    },
    async ({
      siteUrl,
      startDate,
      endDate,
      maxPosition,
      minImpressions,
      maxCtr,
      limit,
    }) => {
      try {
        return jsonResult(
          opportunityResultSchema,
          await findLowCtrOpportunities(
            {
              siteUrl,
              startDate,
              endDate,
              maxPosition,
              minImpressions,
              maxCtr,
              limit,
            },
            env,
          ),
        );
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "snapshot_search_console",
    {
      description:
        "Capture a Search Console query as a stored snapshot in D1 for later period-over-period comparison and content-decay detection.",
      inputSchema: z.object({
        siteUrl: z.string().min(1),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
        dimensions: z
          .array(
            z.enum([
              "query",
              "page",
              "country",
              "device",
              "date",
              "searchAppearance",
            ]),
          )
          .optional(),
        label: z.string().min(1).optional(),
      }),
      outputSchema: snapshotSearchConsoleResultSchema,
    },
    async ({ siteUrl, startDate, endDate, dimensions, label }) => {
      if (!env.DB)
        return errorResult(new Error("D1 storage is not configured"));
      try {
        const result = await searchConsoleQuery(
          {
            siteUrl,
            startDate,
            endDate,
            dimensions,
            rowLimit: LIMITS.maxSnapshotRows,
          },
          env,
        );
        const capturedAt = new Date().toISOString();
        const { snapshotId, rowCount } = await storeGscSnapshot(env.DB, {
          siteUrl: result.siteUrl,
          startDate: result.startDate,
          endDate: result.endDate,
          label,
          capturedAt,
          rows: result.rows,
        });
        return jsonResult(snapshotSearchConsoleResultSchema, {
          snapshotId,
          siteUrl: result.siteUrl,
          rowCount,
          capturedAt,
        });
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "list_search_console_snapshots",
    {
      description:
        "List stored Search Console snapshots for a site, most recent first.",
      inputSchema: z.object({
        siteUrl: z.string().min(1),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      outputSchema: listSearchConsoleSnapshotsResultSchema,
    },
    async ({ siteUrl, limit }) => {
      if (!env.DB)
        return errorResult(new Error("D1 storage is not configured"));
      try {
        const snapshots = await listSnapshots(env.DB, siteUrl, limit);
        return jsonResult(listSearchConsoleSnapshotsResultSchema, {
          siteUrl,
          count: snapshots.length,
          snapshots,
        });
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "compare_search_console",
    {
      description:
        "Compare two stored Search Console snapshots (defaulting to the two most recent) to surface decayed, improved, lost, and gained queries.",
      inputSchema: z.object({
        siteUrl: z.string().min(1),
        baseSnapshotId: z.number().int().positive().optional(),
        currentSnapshotId: z.number().int().positive().optional(),
      }),
      outputSchema: compareSearchConsoleResultSchema,
    },
    async ({ siteUrl, baseSnapshotId, currentSnapshotId }) => {
      if (!env.DB)
        return errorResult(new Error("D1 storage is not configured"));
      try {
        let baseId: number;
        let currentId: number;
        if (baseSnapshotId != null && currentSnapshotId != null) {
          baseId = baseSnapshotId;
          currentId = currentSnapshotId;
        } else {
          const pair = await twoMostRecent(env.DB, siteUrl);
          if (!pair)
            return errorResult(
              new Error("Need at least two snapshots to compare"),
            );
          baseId = pair.base.id;
          currentId = pair.current.id;
        }
        const [baseRows, currentRows] = await Promise.all([
          getSnapshotRows(env.DB, baseId),
          getSnapshotRows(env.DB, currentId),
        ]);
        const diff = diffGscRows(baseRows, currentRows);
        return jsonResult(compareSearchConsoleResultSchema, {
          siteUrl,
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
    "delete_search_console_snapshot",
    {
      description:
        "Delete a stored Search Console snapshot from D1. Irreversible — requires confirm=true. Closes a known gap: snapshots otherwise accumulate indefinitely with no cleanup mechanism.",
      inputSchema: z.object({
        snapshotId: z.number().int().positive(),
        confirm: z.boolean(),
      }),
      outputSchema: deleteSearchConsoleSnapshotResultSchema,
    },
    async ({ snapshotId, confirm }) => {
      if (!env.DB)
        return errorResult(new Error("D1 storage is not configured"));
      try {
        assertConfirmedDelete(confirm);
        const deleted = await deleteGscSnapshot(env.DB, snapshotId);
        return jsonResult(deleteSearchConsoleSnapshotResultSchema, {
          snapshotId,
          deleted,
        });
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
