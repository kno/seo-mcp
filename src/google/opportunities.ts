import type * as z from "zod/v4";
import { LIMITS, type Env } from "../config";
import { searchConsoleQuery, type GscRow } from "./search-console";
import { opportunityResultSchema } from "../schemas/opportunities";

// ---------------------------------------------------------------------------
// Pure filter/rank helpers
// ---------------------------------------------------------------------------

export interface StrikingDistanceOptions {
  minPosition?: number;
  maxPosition?: number;
  minImpressions?: number;
  limit?: number;
}

export function strikingDistanceKeywords(
  rows: GscRow[],
  opts?: StrikingDistanceOptions,
): GscRow[] {
  const minPosition = opts?.minPosition ?? 11;
  const maxPosition = opts?.maxPosition ?? 20;
  const minImpressions = opts?.minImpressions ?? 1;
  const limit = opts?.limit ?? 25;

  return rows
    .filter(
      (r) =>
        r.position >= minPosition &&
        r.position <= maxPosition &&
        r.impressions >= minImpressions,
    )
    .sort((a, b) => {
      if (b.impressions !== a.impressions) return b.impressions - a.impressions;
      if (a.position !== b.position) return a.position - b.position;
      return a.keys.join(" ").localeCompare(b.keys.join(" "));
    })
    .slice(0, limit);
}

export interface LowCtrOptions {
  maxPosition?: number;
  minImpressions?: number;
  maxCtr?: number;
  limit?: number;
}

export function lowCtrOpportunities(
  rows: GscRow[],
  opts?: LowCtrOptions,
): GscRow[] {
  const maxPosition = opts?.maxPosition ?? 10;
  const minImpressions = opts?.minImpressions ?? 10;
  const maxCtr = opts?.maxCtr ?? 0.02;
  const limit = opts?.limit ?? 25;

  return rows
    .filter(
      (r) =>
        r.position <= maxPosition &&
        r.impressions >= minImpressions &&
        r.ctr <= maxCtr,
    )
    .sort((a, b) => {
      if (b.impressions !== a.impressions) return b.impressions - a.impressions;
      if (a.position !== b.position) return a.position - b.position;
      return a.keys.join(" ").localeCompare(b.keys.join(" "));
    })
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type OpportunityResult = z.infer<typeof opportunityResultSchema>;

// ---------------------------------------------------------------------------
// Fetch + filter wrappers
// ---------------------------------------------------------------------------

export interface StrikingDistanceParams {
  siteUrl: string;
  startDate: string;
  endDate: string;
  dimensions?: string[];
  minPosition?: number;
  maxPosition?: number;
  minImpressions?: number;
  limit?: number;
}

export async function findStrikingDistanceKeywords(
  params: StrikingDistanceParams,
  env: Env,
  fetcher?: typeof fetch,
  now?: () => number,
): Promise<OpportunityResult> {
  const dimensions = params.dimensions ?? ["query", "page"];
  const minPosition = params.minPosition ?? 11;
  const maxPosition = params.maxPosition ?? 20;
  const minImpressions = params.minImpressions ?? 1;
  const limit = params.limit ?? 25;

  const result = await searchConsoleQuery(
    {
      siteUrl: params.siteUrl,
      startDate: params.startDate,
      endDate: params.endDate,
      dimensions,
      rowLimit: LIMITS.maxGscRows,
    },
    env,
    fetcher,
    now,
  );

  const rows = strikingDistanceKeywords(result.rows, {
    minPosition,
    maxPosition,
    minImpressions,
    limit,
  });

  return {
    siteUrl: params.siteUrl,
    startDate: params.startDate,
    endDate: params.endDate,
    dimensions,
    criteria: { minPosition, maxPosition, minImpressions, limit },
    rowCount: rows.length,
    rows,
  };
}

export interface LowCtrParams {
  siteUrl: string;
  startDate: string;
  endDate: string;
  dimensions?: string[];
  maxPosition?: number;
  minImpressions?: number;
  maxCtr?: number;
  limit?: number;
}

export async function findLowCtrOpportunities(
  params: LowCtrParams,
  env: Env,
  fetcher?: typeof fetch,
  now?: () => number,
): Promise<OpportunityResult> {
  const dimensions = params.dimensions ?? ["query", "page"];
  const maxPosition = params.maxPosition ?? 10;
  const minImpressions = params.minImpressions ?? 10;
  const maxCtr = params.maxCtr ?? 0.02;
  const limit = params.limit ?? 25;

  const result = await searchConsoleQuery(
    {
      siteUrl: params.siteUrl,
      startDate: params.startDate,
      endDate: params.endDate,
      dimensions,
      rowLimit: LIMITS.maxGscRows,
    },
    env,
    fetcher,
    now,
  );

  const rows = lowCtrOpportunities(result.rows, {
    maxPosition,
    minImpressions,
    maxCtr,
    limit,
  });

  return {
    siteUrl: params.siteUrl,
    startDate: params.startDate,
    endDate: params.endDate,
    dimensions,
    criteria: { maxPosition, minImpressions, maxCtr, limit },
    rowCount: rows.length,
    rows,
  };
}
