import type * as z from "zod/v4";
import { LIMITS, type Env } from "../config";
import { getGoogleAccessToken } from "./auth";
import {
  keywordMetricSchema,
  keywordMetricsResultSchema,
} from "../schemas/keywords";

const ADS_API_VERSION = "v23";
const ADS_BASE = "https://googleads.googleapis.com";
const DEFAULT_GEO_TARGET = "2724";
const DEFAULT_LANGUAGE = "1003";

export type KeywordMetric = z.infer<typeof keywordMetricSchema>;
export type KeywordMetricsResult = z.infer<typeof keywordMetricsResultSchema>;

interface AdsMetrics {
  competition?: string;
  competitionIndex?: unknown;
  avgMonthlySearches?: unknown;
  lowTopOfPageBidMicros?: unknown;
  highTopOfPageBidMicros?: unknown;
  monthlySearchVolumes?: Array<{ monthlySearches?: unknown }>;
}

export function normalizeMetric(
  text: string,
  metrics: AdsMetrics,
): KeywordMetric {
  const m = metrics ?? {};

  let avgMonthlySearches = Number(m.avgMonthlySearches) || 0;
  if (!avgMonthlySearches && Array.isArray(m.monthlySearchVolumes)) {
    const volumes = m.monthlySearchVolumes.map(
      (v) => Number(v?.monthlySearches) || 0,
    );
    if (volumes.length > 0) {
      avgMonthlySearches =
        volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
    }
  }

  return {
    keyword: text,
    avgMonthlySearches,
    competition: m.competition ?? "UNKNOWN",
    competitionIndex: Number(m.competitionIndex ?? 0) || 0,
    lowTopOfPageBid: (Number(m.lowTopOfPageBidMicros ?? 0) || 0) / 1_000_000,
    highTopOfPageBid: (Number(m.highTopOfPageBidMicros ?? 0) || 0) / 1_000_000,
  };
}

async function adsPost(
  env: Env,
  customerIdParam: string | undefined,
  method: string,
  body: Record<string, unknown>,
  fetcher: typeof fetch = fetch,
  now?: () => number,
): Promise<{ customerId: string; data: { results?: Array<unknown> } }> {
  if (!env.GOOGLE_ADS_DEVELOPER_TOKEN) {
    throw new Error("Google Ads developer token is not configured");
  }

  const rawCustomerId = customerIdParam ?? env.GOOGLE_ADS_CUSTOMER_ID;
  if (!rawCustomerId) {
    throw new Error("Google Ads customer ID is not configured");
  }
  const customerId = rawCustomerId.replace(/\D/g, "");

  const token = await getGoogleAccessToken(env, fetcher, now);

  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "developer-token": env.GOOGLE_ADS_DEVELOPER_TOKEN,
    "content-type": "application/json",
  };
  if (env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
    headers["login-customer-id"] = env.GOOGLE_ADS_LOGIN_CUSTOMER_ID.replace(
      /\D/g,
      "",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LIMITS.adsTimeoutMs);
  try {
    const response = await fetcher(
      `${ADS_BASE}/${ADS_API_VERSION}/customers/${customerId}:${method}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );
    const data = (await response.json()) as {
      results?: Array<unknown>;
      error?: {
        message?: string;
        details?: Array<{ errors?: Array<{ message?: string }> }>;
      };
    };
    if (!response.ok) {
      throw new Error(
        data.error?.details?.[0]?.errors?.[0]?.message ??
          data.error?.message ??
          `Google Ads request failed (HTTP ${response.status})`,
      );
    }
    return { customerId, data };
  } finally {
    clearTimeout(timeout);
  }
}

interface HistoricalResult {
  text?: string;
  keywordMetrics?: AdsMetrics;
}

interface IdeaResult {
  text?: string;
  keywordIdeaMetrics?: AdsMetrics;
}

export interface KeywordMetricsParams {
  keywords: string[];
  geoTargetIds?: string[];
  languageId?: string;
  customerId?: string;
}

export async function getKeywordMetrics(
  params: KeywordMetricsParams,
  env: Env,
  fetcher: typeof fetch = fetch,
  now?: () => number,
): Promise<KeywordMetricsResult> {
  const geoTargetConstants = (params.geoTargetIds ?? [DEFAULT_GEO_TARGET]).map(
    (id) => `geoTargetConstants/${id}`,
  );

  const body = {
    keywords: params.keywords.slice(0, LIMITS.maxKeywords),
    geoTargetConstants,
    language: `languageConstants/${params.languageId ?? DEFAULT_LANGUAGE}`,
    keywordPlanNetwork: "GOOGLE_SEARCH",
  };

  const { customerId, data } = await adsPost(
    env,
    params.customerId,
    "generateKeywordHistoricalMetrics",
    body,
    fetcher,
    now,
  );

  const keywords = ((data.results ?? []) as HistoricalResult[]).map((r) =>
    normalizeMetric(r.text ?? "", r.keywordMetrics ?? {}),
  );

  return { customerId, count: keywords.length, keywords };
}

export interface DiscoverKeywordsParams {
  seedKeywords?: string[];
  seedUrl?: string;
  geoTargetIds?: string[];
  languageId?: string;
  limit?: number;
  customerId?: string;
}

export async function discoverKeywords(
  params: DiscoverKeywordsParams,
  env: Env,
  fetcher: typeof fetch = fetch,
  now?: () => number,
): Promise<KeywordMetricsResult> {
  const hasKeywords = !!params.seedKeywords && params.seedKeywords.length > 0;
  const hasUrl = !!params.seedUrl;
  if (!hasKeywords && !hasUrl) {
    throw new Error("Provide seedKeywords or seedUrl");
  }

  const geoTargetConstants = (params.geoTargetIds ?? [DEFAULT_GEO_TARGET]).map(
    (id) => `geoTargetConstants/${id}`,
  );

  const body: Record<string, unknown> = {
    geoTargetConstants,
    language: `languageConstants/${params.languageId ?? DEFAULT_LANGUAGE}`,
    keywordPlanNetwork: "GOOGLE_SEARCH",
  };

  if (hasKeywords && hasUrl) {
    body.keywordAndUrlSeed = {
      url: params.seedUrl,
      keywords: params.seedKeywords,
    };
  } else if (hasKeywords) {
    body.keywordSeed = { keywords: params.seedKeywords };
  } else {
    body.urlSeed = { url: params.seedUrl };
  }

  const { customerId, data } = await adsPost(
    env,
    params.customerId,
    "generateKeywordIdeas",
    body,
    fetcher,
    now,
  );

  const keywords = ((data.results ?? []) as IdeaResult[])
    .map((r) => normalizeMetric(r.text ?? "", r.keywordIdeaMetrics ?? {}))
    .sort((a, b) => b.avgMonthlySearches - a.avgMonthlySearches)
    .slice(0, Math.min(params.limit ?? 50, LIMITS.maxKeywordIdeas));

  return { customerId, count: keywords.length, keywords };
}
