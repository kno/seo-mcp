import type * as z from "zod/v4";
import { LIMITS } from "../config";
import { searchConsoleQuery, type GscRow } from "../google/search-console";
import type { GoogleOAuthCredentials } from "../google/credential-types";
import {
  strikingDistanceKeywords,
  lowCtrOpportunities,
} from "../google/opportunities";
import {
  cannibalGroupSchema,
  cannibalPageSchema,
  findKeywordCannibalizationResultSchema,
  findSeoOpportunitiesResultSchema,
  opportunitySchema,
  opportunityTypeSchema,
} from "../schemas/intelligence";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CannibalPage = z.infer<typeof cannibalPageSchema>;

export type CannibalGroup = z.infer<typeof cannibalGroupSchema>;

export type OpportunityType = z.infer<typeof opportunityTypeSchema>;

export type Opportunity = z.infer<typeof opportunitySchema>;

// ---------------------------------------------------------------------------
// Pure synthesis helpers
// ---------------------------------------------------------------------------

const MAX_PAGES_PER_GROUP = 10;

export function findCannibalization(
  rows: GscRow[],
  opts?: { minImpressions?: number; limit?: number },
): CannibalGroup[] {
  const minImpressions = opts?.minImpressions ?? 10;
  const limit = opts?.limit ?? LIMITS.maxCannibalizationGroups;

  // Group qualifying pages by query, de-duplicating pages by URL.
  const byQuery = new Map<string, Map<string, CannibalPage>>();
  for (const row of rows) {
    const query = row.keys[0];
    const page = row.keys[1];
    if (query == null || page == null) continue;
    if (row.impressions < minImpressions) continue;

    let pages = byQuery.get(query);
    if (!pages) {
      pages = new Map();
      byQuery.set(query, pages);
    }
    const existing = pages.get(page);
    if (existing) {
      existing.clicks += row.clicks;
      existing.impressions += row.impressions;
    } else {
      pages.set(page, {
        page,
        clicks: row.clicks,
        impressions: row.impressions,
        position: row.position,
      });
    }
  }

  const groups: CannibalGroup[] = [];
  for (const [query, pageMap] of byQuery) {
    if (pageMap.size < 2) continue;
    const pages = [...pageMap.values()].sort(
      (a, b) => b.impressions - a.impressions,
    );
    groups.push({
      query,
      pageCount: pages.length,
      totalImpressions: pages.reduce((sum, p) => sum + p.impressions, 0),
      totalClicks: pages.reduce((sum, p) => sum + p.clicks, 0),
      pages: pages.slice(0, MAX_PAGES_PER_GROUP),
    });
  }

  return groups
    .sort((a, b) => {
      if (b.totalImpressions !== a.totalImpressions)
        return b.totalImpressions - a.totalImpressions;
      return a.query.localeCompare(b.query);
    })
    .slice(0, limit);
}

export function buildSeoOpportunities(
  rows: GscRow[],
  opts?: { limit?: number },
): Opportunity[] {
  const limit = opts?.limit ?? LIMITS.maxOpportunities;

  const opportunities: Opportunity[] = [];

  for (const row of lowCtrOpportunities(rows)) {
    opportunities.push({
      type: "low_ctr",
      query: row.keys[0],
      page: row.keys[1] ?? null,
      impressions: row.impressions,
      currentPosition: row.position,
      impact: row.impressions,
      effort: 1,
      priorityScore: row.impressions / 1,
      recommendation:
        "Rewrite title/meta description to improve click-through (good rank, low CTR).",
    });
  }

  for (const row of strikingDistanceKeywords(rows)) {
    opportunities.push({
      type: "striking_distance",
      query: row.keys[0],
      page: row.keys[1] ?? null,
      impressions: row.impressions,
      currentPosition: row.position,
      impact: row.impressions,
      effort: 2,
      priorityScore: row.impressions / 2,
      recommendation:
        "Strengthen content and internal links to move from page 2 into page 1.",
    });
  }

  for (const group of findCannibalization(rows)) {
    opportunities.push({
      type: "cannibalization",
      query: group.query,
      page: null,
      impressions: group.totalImpressions,
      currentPosition: null,
      impact: group.totalImpressions,
      effort: 3,
      priorityScore: group.totalImpressions / 3,
      recommendation:
        "Consolidate or differentiate the competing pages targeting this query.",
    });
  }

  return opportunities
    .sort((a, b) => {
      if (b.priorityScore !== a.priorityScore)
        return b.priorityScore - a.priorityScore;
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      return a.query.localeCompare(b.query);
    })
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Fetch + synthesis wrappers
// ---------------------------------------------------------------------------

export interface CannibalizationParams {
  siteUrl: string;
  startDate: string;
  endDate: string;
  minImpressions?: number;
  limit?: number;
}

export async function findKeywordCannibalization(
  params: CannibalizationParams,
  credentials: GoogleOAuthCredentials,
  fetcher?: typeof fetch,
  now?: () => number,
): Promise<z.infer<typeof findKeywordCannibalizationResultSchema>> {
  const result = await searchConsoleQuery(
    {
      siteUrl: params.siteUrl,
      startDate: params.startDate,
      endDate: params.endDate,
      dimensions: ["query", "page"],
      rowLimit: LIMITS.maxGscRows,
    },
    credentials,
    fetcher,
    now,
  );

  const groups = findCannibalization(result.rows, {
    minImpressions: params.minImpressions,
    limit: params.limit,
  });

  return {
    siteUrl: params.siteUrl,
    startDate: params.startDate,
    endDate: params.endDate,
    count: groups.length,
    groups,
  };
}

export interface SeoOpportunitiesParams {
  siteUrl: string;
  startDate: string;
  endDate: string;
  limit?: number;
}

export async function findSeoOpportunities(
  params: SeoOpportunitiesParams,
  credentials: GoogleOAuthCredentials,
  fetcher?: typeof fetch,
  now?: () => number,
): Promise<z.infer<typeof findSeoOpportunitiesResultSchema>> {
  const result = await searchConsoleQuery(
    {
      siteUrl: params.siteUrl,
      startDate: params.startDate,
      endDate: params.endDate,
      dimensions: ["query", "page"],
      rowLimit: LIMITS.maxGscRows,
    },
    credentials,
    fetcher,
    now,
  );

  const opportunities = buildSeoOpportunities(result.rows, {
    limit: params.limit,
  });

  return {
    siteUrl: params.siteUrl,
    startDate: params.startDate,
    endDate: params.endDate,
    count: opportunities.length,
    opportunities,
  };
}
