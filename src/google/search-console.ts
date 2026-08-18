import type * as z from "zod/v4";
import { LIMITS } from "../config";
import { getGoogleAccessToken } from "./auth";
import type { GoogleOAuthCredentials } from "./credential-types";
import {
  gscDimensionSchema,
  gscQueryResultSchema,
  gscRowSchema,
} from "../schemas/search-console";

export type GscRow = z.infer<typeof gscRowSchema>;

export type GscQueryResult = z.infer<typeof gscQueryResultSchema>;

/**
 * Carries the upstream HTTP status so callers can distinguish a
 * credential-shaped rejection (401/403) from any other query failure — see
 * `health.ts#isCredentialRejectedError`.
 */
export class SearchConsoleHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type GscDimension = z.infer<typeof gscDimensionSchema>;

interface GscQueryParams {
  siteUrl: string;
  startDate: string;
  endDate: string;
  dimensions?: string[];
  rowLimit?: number;
}

export async function searchConsoleQuery(
  params: GscQueryParams,
  credentials: GoogleOAuthCredentials,
  fetcher: typeof fetch = fetch,
  now?: () => number,
): Promise<GscQueryResult> {
  const token = await getGoogleAccessToken(credentials, fetcher, now);
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
      throw new SearchConsoleHttpError(
        data.error?.message ??
          `Search Console query failed (HTTP ${response.status})`,
        response.status,
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
      // `dimensions` is always either the caller's enum-validated input
      // (`inputSchema` at the MCP boundary) or the server default above, so
      // this narrowing to `GscDimension[]` is safe.
      dimensions: dimensions as GscDimension[],
      rowCount: rows.length,
      rows,
    };
  } finally {
    clearTimeout(timeout);
  }
}
