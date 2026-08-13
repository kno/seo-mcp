import type * as z from "zod/v4";
import { LIMITS, type Env } from "../config";
import { searchConsoleQuery, type GscRow } from "../google/search-console";
import {
  contentGapSchema,
  findContentGapsResultSchema,
  mapKeywordsToPagesResultSchema,
  pageKeywordsSchema,
  pageQuerySchema,
} from "../schemas/intelligence";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PageQuery = z.infer<typeof pageQuerySchema>;

export type PageKeywords = z.infer<typeof pageKeywordsSchema>;

export type ContentGap = z.infer<typeof contentGapSchema>;

// ---------------------------------------------------------------------------
// Pure synthesis helpers
// ---------------------------------------------------------------------------

export function mapKeywordsToPages(
  rows: GscRow[],
  opts?: { limit?: number; topQueriesPerPage?: number },
): PageKeywords[] {
  const limit = opts?.limit ?? LIMITS.maxKeywordPages;
  const topQueriesPerPage = opts?.topQueriesPerPage ?? 10;

  const byPage = new Map<string, PageQuery[]>();
  for (const row of rows) {
    const query = row.keys[0];
    const page = row.keys[1];
    if (query == null || page == null) continue;

    let queries = byPage.get(page);
    if (!queries) {
      queries = [];
      byPage.set(page, queries);
    }
    queries.push({
      query,
      clicks: row.clicks,
      impressions: row.impressions,
      position: row.position,
    });
  }

  const pages: PageKeywords[] = [];
  for (const [page, queries] of byPage) {
    const sortedQueries = [...queries].sort((a, b) => {
      if (b.clicks !== a.clicks) return b.clicks - a.clicks;
      return b.impressions - a.impressions;
    });
    pages.push({
      page,
      queryCount: queries.length,
      totalClicks: queries.reduce((sum, q) => sum + q.clicks, 0),
      totalImpressions: queries.reduce((sum, q) => sum + q.impressions, 0),
      topQueries: sortedQueries.slice(0, topQueriesPerPage),
    });
  }

  return pages
    .sort((a, b) => {
      if (b.totalClicks !== a.totalClicks) return b.totalClicks - a.totalClicks;
      if (b.totalImpressions !== a.totalImpressions)
        return b.totalImpressions - a.totalImpressions;
      return a.page.localeCompare(b.page);
    })
    .slice(0, limit);
}

export function findContentGaps(
  rows: GscRow[],
  opts?: { minPosition?: number; minImpressions?: number; limit?: number },
): ContentGap[] {
  const minPosition = opts?.minPosition ?? 21;
  const minImpressions = opts?.minImpressions ?? 10;
  const limit = opts?.limit ?? LIMITS.maxContentGaps;

  const gaps: ContentGap[] = [];
  for (const row of rows) {
    const query = row.keys[0];
    const page = row.keys[1];
    if (query == null || page == null) continue;
    if (row.position < minPosition) continue;
    if (row.impressions < minImpressions) continue;

    gaps.push({
      query,
      page,
      impressions: row.impressions,
      clicks: row.clicks,
      position: row.position,
    });
  }

  return gaps
    .sort((a, b) => {
      if (b.impressions !== a.impressions) return b.impressions - a.impressions;
      if (a.position !== b.position) return a.position - b.position;
      return a.query.localeCompare(b.query);
    })
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Fetch + synthesis wrappers
// ---------------------------------------------------------------------------

export interface MapKeywordsToPagesParams {
  siteUrl: string;
  startDate: string;
  endDate: string;
  limit?: number;
  topQueriesPerPage?: number;
}

export async function mapKeywordsToPagesForSite(
  params: MapKeywordsToPagesParams,
  env: Env,
  fetcher?: typeof fetch,
  now?: () => number,
): Promise<z.infer<typeof mapKeywordsToPagesResultSchema>> {
  const result = await searchConsoleQuery(
    {
      siteUrl: params.siteUrl,
      startDate: params.startDate,
      endDate: params.endDate,
      dimensions: ["query", "page"],
      rowLimit: LIMITS.maxGscRows,
    },
    env,
    fetcher,
    now,
  );

  const pages = mapKeywordsToPages(result.rows, {
    limit: params.limit,
    topQueriesPerPage: params.topQueriesPerPage,
  });

  return {
    siteUrl: params.siteUrl,
    startDate: params.startDate,
    endDate: params.endDate,
    count: pages.length,
    pages,
  };
}

export interface FindContentGapsParams {
  siteUrl: string;
  startDate: string;
  endDate: string;
  minPosition?: number;
  minImpressions?: number;
  limit?: number;
}

export async function findContentGapsForSite(
  params: FindContentGapsParams,
  env: Env,
  fetcher?: typeof fetch,
  now?: () => number,
): Promise<z.infer<typeof findContentGapsResultSchema>> {
  const result = await searchConsoleQuery(
    {
      siteUrl: params.siteUrl,
      startDate: params.startDate,
      endDate: params.endDate,
      dimensions: ["query", "page"],
      rowLimit: LIMITS.maxGscRows,
    },
    env,
    fetcher,
    now,
  );

  const gaps = findContentGaps(result.rows, {
    minPosition: params.minPosition,
    minImpressions: params.minImpressions,
    limit: params.limit,
  });

  return {
    siteUrl: params.siteUrl,
    startDate: params.startDate,
    endDate: params.endDate,
    count: gaps.length,
    gaps,
  };
}
