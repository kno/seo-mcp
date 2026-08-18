import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { Env } from "../config";
import { resolveSiteCredentials } from "../google/credentials";
import { withCallHealthTracking } from "../google/health";
import { getSiteByUrl } from "../db/site-store";
import type { ResolvedCredential } from "../google/credential-types";
import {
  findKeywordCannibalization,
  findSeoOpportunities,
} from "../seo/intelligence";
import {
  mapKeywordsToPagesForSite,
  findContentGapsForSite,
} from "../seo/keyword-pages";
import { analyzeDomain } from "../seo/domain-report";
import {
  findKeywordCannibalizationResultSchema,
  findSeoOpportunitiesResultSchema,
  mapKeywordsToPagesResultSchema,
  findContentGapsResultSchema,
} from "../schemas/intelligence";
import { domainReportSchema } from "../schemas/domain-report";
import { jsonResult, errorResult } from "./shared";

/** Mirrors `search-console.ts`'s `siteForHealth` — see its doc comment. */
async function siteForHealth(
  env: Env,
  siteUrl: string,
  resolved: ResolvedCredential,
) {
  if (!env.DB || resolved.source !== "site") return null;
  return getSiteByUrl(env.DB, siteUrl);
}

export function registerIntelligenceTools(server: McpServer, env: Env): void {
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
        const resolved = await resolveSiteCredentials(env, siteUrl);
        const site = await siteForHealth(env, siteUrl, resolved);
        return jsonResult(
          findKeywordCannibalizationResultSchema,
          await withCallHealthTracking(
            env.DB,
            site,
            "search-console",
            resolved,
            () =>
              findKeywordCannibalization(
                { siteUrl, startDate, endDate, minImpressions, limit },
                resolved.credentials,
              ),
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
        const resolved = await resolveSiteCredentials(env, siteUrl);
        const site = await siteForHealth(env, siteUrl, resolved);
        return jsonResult(
          findSeoOpportunitiesResultSchema,
          await withCallHealthTracking(
            env.DB,
            site,
            "search-console",
            resolved,
            () =>
              findSeoOpportunities(
                { siteUrl, startDate, endDate, limit },
                resolved.credentials,
              ),
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
        const resolved = await resolveSiteCredentials(env, siteUrl);
        const site = await siteForHealth(env, siteUrl, resolved);
        return jsonResult(
          mapKeywordsToPagesResultSchema,
          await withCallHealthTracking(
            env.DB,
            site,
            "search-console",
            resolved,
            () =>
              mapKeywordsToPagesForSite(
                { siteUrl, startDate, endDate, limit, topQueriesPerPage },
                resolved.credentials,
              ),
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
        const resolved = await resolveSiteCredentials(env, siteUrl);
        const site = await siteForHealth(env, siteUrl, resolved);
        return jsonResult(
          findContentGapsResultSchema,
          await withCallHealthTracking(
            env.DB,
            site,
            "search-console",
            resolved,
            () =>
              findContentGapsForSite(
                {
                  siteUrl,
                  startDate,
                  endDate,
                  minPosition,
                  minImpressions,
                  limit,
                },
                resolved.credentials,
              ),
          ),
        );
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
}
