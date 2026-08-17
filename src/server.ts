import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { LIMITS, type Env } from "./config";
import { crawlPage } from "./crawl/page";
import { crawlSite } from "./crawl/site";
import { checkLinks } from "./crawl/links";
import { analyzePageSpeed } from "./pagespeed/client";
import { searchConsoleQuery } from "./google/search-console";
import {
  findStrikingDistanceKeywords,
  findLowCtrOpportunities,
} from "./google/opportunities";
import { getKeywordMetrics, discoverKeywords } from "./google/ads";
import {
  listBusinessLocations,
  getBusinessReviews,
  getBusinessPerformance,
  replyToReview,
  updateBusinessInfo,
  createLocalPost,
} from "./google/business";
import {
  findKeywordCannibalization,
  findSeoOpportunities,
} from "./seo/intelligence";
import {
  mapKeywordsToPagesForSite,
  findContentGapsForSite,
} from "./seo/keyword-pages";
import { analyzeDomain } from "./seo/domain-report";
import { clusterKeywords } from "./seo/keywords";
import { diffGscRows } from "./seo/gsc-diff";
import { diffCrawls } from "./seo/crawl-diff";
import {
  storeGscSnapshot,
  listSnapshots,
  getSnapshotRows,
  twoMostRecent,
  deleteGscSnapshot,
} from "./db/gsc-store";
import {
  storeCrawlSnapshot,
  listCrawlSnapshots,
  getCrawlSnapshotPages,
  twoMostRecentCrawls,
  deleteCrawlSnapshot,
} from "./db/crawl-store";
import { healthSchema } from "./schemas/health";
import { pageAnalysisSchema } from "./schemas/page";
import { siteCrawlResultSchema } from "./schemas/site";
import { linkCheckResultSchema } from "./schemas/links";
import { pageSpeedResultSchema } from "./schemas/pagespeed";
import { gscQueryResultSchema } from "./schemas/search-console";
import { opportunityResultSchema } from "./schemas/opportunities";
import {
  snapshotSearchConsoleResultSchema,
  listSearchConsoleSnapshotsResultSchema,
  compareSearchConsoleResultSchema,
  deleteSearchConsoleSnapshotResultSchema,
} from "./schemas/gsc-snapshots";
import {
  snapshotCrawlResultSchema,
  listCrawlSnapshotsResultSchema,
  compareCrawlsResultSchema,
  deleteCrawlSnapshotResultSchema,
} from "./schemas/crawl-snapshots";
import {
  keywordMetricsResultSchema,
  clusterResultSchema,
} from "./schemas/keywords";
import {
  findKeywordCannibalizationResultSchema,
  findSeoOpportunitiesResultSchema,
  mapKeywordsToPagesResultSchema,
  findContentGapsResultSchema,
} from "./schemas/intelligence";
import { domainReportSchema } from "./schemas/domain-report";

/**
 * Builds the `structuredContent` payload for a tool response.
 *
 * Two call shapes:
 * - `jsonResult(schema, value)` — every tool with a published `outputSchema`
 *   (the `mcp-result-contract` reconciliation gate). `schema.parse` validates
 *   `value` against the tool's own declared `outputSchema` before it is
 *   returned; a thrown `ZodError` is caught by the same try/catch each tool
 *   handler already uses for `errorResult`, so a result violating its own
 *   schema surfaces as a normal tool failure rather than invalid
 *   `structuredContent`.
 * - `jsonResult(value)` — legacy single-argument form kept for the
 *   remaining tools that do not yet declare an `outputSchema` (all six
 *   `business_*` tools); out of scope for this change. `snapshot_crawl`,
 *   `list_crawl_snapshots` and `compare_crawls` (`history-comparison-view`,
 *   PR11) now use the two-argument `jsonResult(schema, value)` form like
 *   every other reconciled tool.
 */
function jsonResult<T extends Record<string, unknown>>(
  schema: z.ZodType<T>,
  value: T,
): { content: [{ type: "text"; text: string }]; structuredContent: T };
function jsonResult(value: unknown): {
  content: [{ type: "text"; text: string }];
  structuredContent: Record<string, unknown>;
};
function jsonResult(schemaOrValue: unknown, value?: unknown) {
  if (arguments.length < 2) {
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(schemaOrValue, null, 2) },
      ],
      structuredContent: schemaOrValue as Record<string, unknown>,
    };
  }
  const parsed = (schemaOrValue as z.ZodType).parse(value);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(parsed, null, 2) }],
    structuredContent: parsed,
  };
}

const errorResult = (error: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: error instanceof Error ? error.message : "Unexpected error",
    },
  ],
  isError: true,
});

// Deletion-specific confirm gate — mirrors `src/google/business.ts`'s
// `assertConfirmed`/`REFUSE_WRITE` shape exactly (same "throw unless
// confirm===true" contract), with a delete-specific message since deleting
// a snapshot is a distinct, irreversible action from a Business Profile
// write.
const REFUSE_DELETE =
  "Refusing to delete: pass confirm=true to execute this deletion";

function assertConfirmedDelete(confirm: boolean): void {
  if (confirm !== true) {
    throw new Error(REFUSE_DELETE);
  }
}

export function buildServer(env: Env): McpServer {
  const server = new McpServer(
    { name: "seo-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "health",
    {
      description: "Check whether the SEO MCP Worker is ready.",
      inputSchema: z.object({}),
      outputSchema: healthSchema,
    },
    async () =>
      jsonResult(healthSchema, {
        status: "ok",
        service: "seo-mcp",
        version: "0.1.0",
      }),
  );

  server.registerTool(
    "crawl_page",
    {
      description:
        "Fetch one public HTML page and return bounded, deterministic on-page SEO signals and issues.",
      inputSchema: z.object({
        url: z.url().describe("Public HTTP or HTTPS page URL"),
      }),
      outputSchema: pageAnalysisSchema,
    },
    async ({ url }) => {
      try {
        return jsonResult(pageAnalysisSchema, await crawlPage(url));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "crawl_site",
    {
      description:
        "Read a site's bounded sitemap and analyze up to 20 same-origin HTML pages without recursive link crawling.",
      inputSchema: z.object({
        url: z.url().describe("Public HTTP or HTTPS site URL"),
        limit: z.number().int().min(1).max(20).default(10),
        concurrency: z.number().int().min(1).max(4).default(4),
      }),
      outputSchema: siteCrawlResultSchema,
    },
    async ({ url, limit, concurrency }) => {
      try {
        return jsonResult(
          siteCrawlResultSchema,
          await crawlSite(url, limit, concurrency),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "check_links",
    {
      description:
        "Fetch one public page and probe its links, reporting broken (4xx/5xx) and unreachable links within a bounded subrequest budget.",
      inputSchema: z.object({
        url: z.url().describe("Public HTTP or HTTPS page URL"),
      }),
      outputSchema: linkCheckResultSchema,
    },
    async ({ url }) => {
      try {
        return jsonResult(linkCheckResultSchema, await checkLinks(url));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "analyze_pagespeed",
    {
      description:
        "Run Google PageSpeed Insights v5 and return normalized performance, lab metrics, optional field INP, and top opportunities.",
      inputSchema: z.object({
        url: z.url().describe("Public HTTP or HTTPS page URL"),
        strategy: z.enum(["mobile", "desktop"]).default("mobile"),
        apiKey: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Google PageSpeed API key. Overrides the PAGESPEED_API_KEY environment variable when provided.",
          ),
      }),
      outputSchema: pageSpeedResultSchema,
    },
    async ({ url, strategy, apiKey }) => {
      try {
        return jsonResult(
          pageSpeedResultSchema,
          await analyzePageSpeed(url, strategy, env, undefined, apiKey),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

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
    "find_keyword_cannibalization",
    {
      description:
        "Find queries where multiple pages of the same site compete (keyword cannibalization), from Search Console.",
      inputSchema: z.object({
        siteUrl: z.string().min(1),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        minImpressions: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      outputSchema: findKeywordCannibalizationResultSchema,
    },
    async ({ siteUrl, startDate, endDate, minImpressions, limit }) => {
      try {
        return jsonResult(
          findKeywordCannibalizationResultSchema,
          await findKeywordCannibalization(
            { siteUrl, startDate, endDate, minImpressions, limit },
            env,
          ),
        );
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "find_seo_opportunities",
    {
      description:
        "Synthesize Search Console data into a prioritized SEO action list (low-CTR, striking-distance, cannibalization) ranked by impact/effort.",
      inputSchema: z.object({
        siteUrl: z.string().min(1),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      outputSchema: findSeoOpportunitiesResultSchema,
    },
    async ({ siteUrl, startDate, endDate, limit }) => {
      try {
        return jsonResult(
          findSeoOpportunitiesResultSchema,
          await findSeoOpportunities(
            { siteUrl, startDate, endDate, limit },
            env,
          ),
        );
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "map_keywords_to_pages",
    {
      description:
        "Map which Search Console queries each page ranks for (page → top queries), from Search Console.",
      inputSchema: z.object({
        siteUrl: z.string().min(1),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        limit: z.number().int().min(1).max(100).optional(),
        topQueriesPerPage: z.number().int().min(1).max(50).optional(),
      }),
      outputSchema: mapKeywordsToPagesResultSchema,
    },
    async ({ siteUrl, startDate, endDate, limit, topQueriesPerPage }) => {
      try {
        return jsonResult(
          mapKeywordsToPagesResultSchema,
          await mapKeywordsToPagesForSite(
            { siteUrl, startDate, endDate, limit, topQueriesPerPage },
            env,
          ),
        );
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "find_content_gaps",
    {
      description:
        "Find queries with demand (impressions) where the site ranks poorly (page 3+), i.e. content opportunities, from Search Console.",
      inputSchema: z.object({
        siteUrl: z.string().min(1),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        minPosition: z.number().min(1).max(100).optional(),
        minImpressions: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      outputSchema: findContentGapsResultSchema,
    },
    async ({
      siteUrl,
      startDate,
      endDate,
      minPosition,
      minImpressions,
      limit,
    }) => {
      try {
        return jsonResult(
          findContentGapsResultSchema,
          await findContentGapsForSite(
            { siteUrl, startDate, endDate, minPosition, minImpressions, limit },
            env,
          ),
        );
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "get_keyword_metrics",
    {
      description:
        "Google Ads Keyword Planner: search volume, competition, and top-of-page bids for the given keywords (single-tenant).",
      inputSchema: z.object({
        keywords: z.array(z.string().min(1)).min(1).max(100),
        geoTargetIds: z.array(z.string()).optional(),
        languageId: z.string().optional(),
        customerId: z.string().optional(),
      }),
      outputSchema: keywordMetricsResultSchema,
    },
    async ({ keywords, geoTargetIds, languageId, customerId }) => {
      try {
        return jsonResult(
          keywordMetricsResultSchema,
          await getKeywordMetrics(
            { keywords, geoTargetIds, languageId, customerId },
            env,
          ),
        );
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "discover_keywords",
    {
      description:
        "Google Ads Keyword Planner: discover related keyword ideas (with metrics) from seed keywords and/or a URL.",
      inputSchema: z.object({
        seedKeywords: z.array(z.string().min(1)).optional(),
        seedUrl: z.string().optional(),
        geoTargetIds: z.array(z.string()).optional(),
        languageId: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        customerId: z.string().optional(),
      }),
      outputSchema: keywordMetricsResultSchema,
    },
    async ({
      seedKeywords,
      seedUrl,
      geoTargetIds,
      languageId,
      limit,
      customerId,
    }) => {
      try {
        return jsonResult(
          keywordMetricsResultSchema,
          await discoverKeywords(
            {
              seedKeywords,
              seedUrl,
              geoTargetIds,
              languageId,
              limit,
              customerId,
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
    "cluster_keywords",
    {
      description:
        "Group keywords into clusters by shared term and label each with a heuristic search intent (transactional/commercial/informational/local). Pure text analysis; pairs with discover_keywords.",
      inputSchema: z.object({
        keywords: z.array(z.string().min(1)).min(1).max(500),
      }),
      outputSchema: clusterResultSchema,
    },
    async ({ keywords }) => {
      try {
        return jsonResult(clusterResultSchema, clusterKeywords(keywords));
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

  server.registerTool(
    "analyze_domain",
    {
      description:
        "Crawl a site and merge on-page issues, crawl policy, internal link graph, and (optionally) Search Console opportunities into one domain report.",
      inputSchema: z.object({
        url: z.url(),
        limit: z.number().int().min(1).max(20).optional(),
        concurrency: z.number().int().min(1).max(4).optional(),
        gscProperty: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Search Console property (e.g. sc-domain:example.com) to include prioritized opportunities",
          ),
        startDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        endDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        opportunityLimit: z.number().int().min(1).max(100).optional(),
      }),
      outputSchema: domainReportSchema,
    },
    async ({
      url,
      limit,
      concurrency,
      gscProperty,
      startDate,
      endDate,
      opportunityLimit,
    }) => {
      try {
        return jsonResult(
          domainReportSchema,
          await analyzeDomain(
            {
              url,
              limit,
              concurrency,
              gscProperty,
              startDate,
              endDate,
              opportunityLimit,
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
    "business_list_locations",
    {
      description:
        "Google Business Profile: list accessible accounts and the locations for the configured (or first) account.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        return jsonResult(await listBusinessLocations(env));
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "business_get_reviews",
    {
      description:
        "Google Business Profile: list recent reviews (with replies) for a location.",
      inputSchema: z.object({
        location: z
          .string()
          .optional()
          .describe(
            "Full 'accounts/{a}/locations/{l}' path; defaults to GOOGLE_BUSINESS_LOCATION",
          ),
        pageSize: z.number().int().min(1).max(50).optional(),
      }),
    },
    async ({ location, pageSize }) => {
      try {
        return jsonResult(
          await getBusinessReviews({ location, pageSize }, env),
        );
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "business_get_performance",
    {
      description:
        "Google Business Profile: daily performance time series (impressions, calls, website clicks) for a location over a date range.",
      inputSchema: z.object({
        location: z.string().optional(),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
        metrics: z.array(z.string()).optional(),
      }),
    },
    async ({ location, startDate, endDate, metrics }) => {
      try {
        return jsonResult(
          await getBusinessPerformance(
            { location, startDate, endDate, metrics },
            env,
          ),
        );
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "business_reply_review",
    {
      description:
        "Google Business Profile WRITE: post or update the owner reply to a review. Modifies your live public Business Profile — requires confirm: true.",
      inputSchema: z.object({
        review: z
          .string()
          .min(1)
          .describe("Full 'accounts/{a}/locations/{l}/reviews/{r}' path"),
        comment: z.string().min(1),
        confirm: z
          .boolean()
          .describe(
            "Must be true to execute this live write to your public Business Profile",
          ),
      }),
    },
    async ({ review, comment, confirm }) => {
      try {
        return jsonResult(
          await replyToReview({ review, comment, confirm }, env),
        );
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "business_update_info",
    {
      description:
        "Google Business Profile WRITE: patch location fields (title, website, hours, etc.). Modifies your live public Business Profile — requires confirm: true.",
      inputSchema: z.object({
        location: z.string().optional(),
        updateMask: z.string().min(1),
        fields: z.record(z.string(), z.unknown()),
        confirm: z
          .boolean()
          .describe(
            "Must be true to execute this live write to your public Business Profile",
          ),
      }),
    },
    async ({ location, updateMask, fields, confirm }) => {
      try {
        return jsonResult(
          await updateBusinessInfo(
            { location, updateMask, fields, confirm },
            env,
          ),
        );
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "business_create_post",
    {
      description:
        "Google Business Profile WRITE: publish a local post to a location. Modifies your live public Business Profile — requires confirm: true.",
      inputSchema: z.object({
        location: z.string().optional(),
        post: z.record(z.string(), z.unknown()),
        confirm: z
          .boolean()
          .describe(
            "Must be true to execute this live write to your public Business Profile",
          ),
      }),
    },
    async ({ location, post, confirm }) => {
      try {
        return jsonResult(
          await createLocalPost({ location, post, confirm }, env),
        );
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  return server;
}
