import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { Env } from "../config";
import { getKeywordMetrics, discoverKeywords } from "../google/ads";
import { clusterKeywords } from "../seo/keywords";
import {
  keywordMetricsResultSchema,
  clusterResultSchema,
} from "../schemas/keywords";
import { jsonResult, errorResult } from "./shared";

export function registerKeywordsTools(server: McpServer, env: Env): void {
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
}
