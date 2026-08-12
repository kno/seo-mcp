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
  findKeywordCannibalization,
  findSeoOpportunities,
} from "./seo/intelligence";
import { analyzeDomain } from "./seo/domain-report";
import { clusterKeywords } from "./seo/keywords";
import { diffGscRows } from "./seo/gsc-diff";
import {
  storeGscSnapshot,
  listSnapshots,
  getSnapshotRows,
  twoMostRecent,
} from "./db/gsc-store";

const jsonResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  structuredContent: value as Record<string, unknown>,
});

const errorResult = (error: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: error instanceof Error ? error.message : "Unexpected error",
    },
  ],
  isError: true,
});

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
    },
    async () =>
      jsonResult({ status: "ok", service: "seo-mcp", version: "0.1.0" }),
  );

  server.registerTool(
    "crawl_page",
    {
      description:
        "Fetch one public HTML page and return bounded, deterministic on-page SEO signals and issues.",
      inputSchema: z.object({
        url: z.url().describe("Public HTTP or HTTPS page URL"),
      }),
    },
    async ({ url }) => {
      try {
        return jsonResult(await crawlPage(url));
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
    },
    async ({ url, limit, concurrency }) => {
      try {
        return jsonResult(await crawlSite(url, limit, concurrency));
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
    },
    async ({ url }) => {
      try {
        return jsonResult(await checkLinks(url));
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
    },
    async ({ url, strategy, apiKey }) => {
      try {
        return jsonResult(
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
    },
    async ({ siteUrl, startDate, endDate, dimensions, rowLimit }) => {
      try {
        return jsonResult(
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
    },
    async ({ siteUrl, startDate, endDate, minImpressions, limit }) => {
      try {
        return jsonResult(
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
    },
    async ({ siteUrl, startDate, endDate, limit }) => {
      try {
        return jsonResult(
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
    },
    async ({ keywords, geoTargetIds, languageId, customerId }) => {
      try {
        return jsonResult(
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
    },
    async ({ keywords }) => {
      try {
        return jsonResult(clusterKeywords(keywords));
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
        return jsonResult({
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
    },
    async ({ siteUrl, limit }) => {
      if (!env.DB)
        return errorResult(new Error("D1 storage is not configured"));
      try {
        const snapshots = await listSnapshots(env.DB, siteUrl, limit);
        return jsonResult({ siteUrl, count: snapshots.length, snapshots });
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
        return jsonResult({
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

  return server;
}
