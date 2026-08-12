import { LIMITS, type Env } from "../config";
import { getGoogleAccessToken } from "./auth";

export interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface GscQueryResult {
  siteUrl: string;
  startDate: string;
  endDate: string;
  dimensions: string[];
  rowCount: number;
  rows: GscRow[];
}

interface GscQueryParams {
  siteUrl: string;
  startDate: string;
  endDate: string;
  dimensions?: string[];
  rowLimit?: number;
}

export async function searchConsoleQuery(
  params: GscQueryParams,
  env: Env,
  fetcher: typeof fetch = fetch,
  now?: () => number,
): Promise<GscQueryResult> {
  const token = await getGoogleAccessToken(env, fetcher, now);
  const dimensions = params.dimensions?.length
    ? params.dimensions
    : ["query", "page"];
  const rowLimit = Math.max(
    1,
    Math.min(params.rowLimit ?? 100, LIMITS.maxGscRows),
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LIMITS.gscTimeoutMs);
  try {
    const response = await fetcher(
      `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
        params.siteUrl,
      )}/searchAnalytics/query`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          startDate: params.startDate,
          endDate: params.endDate,
          dimensions,
          rowLimit,
        }),
        signal: controller.signal,
      },
    );
    const data = (await response.json()) as {
      rows?: Array<{
        keys?: unknown;
        clicks?: unknown;
        impressions?: unknown;
        ctr?: unknown;
        position?: unknown;
      }>;
      error?: { message?: string };
    };
    if (!response.ok) {
      throw new Error(
        data.error?.message ??
          `Search Console query failed (HTTP ${response.status})`,
      );
    }
    const rows: GscRow[] = (data.rows ?? [])
      .slice(0, LIMITS.maxGscRows)
      .map((raw) => ({
        keys: Array.isArray(raw.keys) ? raw.keys.map((k) => String(k)) : [],
        clicks: Number(raw.clicks) || 0,
        impressions: Number(raw.impressions) || 0,
        ctr: Number(raw.ctr) || 0,
        position: Number(raw.position) || 0,
      }));

    return {
      siteUrl: params.siteUrl,
      startDate: params.startDate,
      endDate: params.endDate,
      dimensions,
      rowCount: rows.length,
      rows,
    };
  } finally {
    clearTimeout(timeout);
  }
}
