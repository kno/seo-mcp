import { LIMITS, type Env } from "../config";
import { fetchBounded } from "../http/fetch";
import { normalizePublicUrl } from "../security/url-policy";
import type { PageSpeedResult, Strategy } from "./types";

type UnknownRecord = Record<string, unknown>;
const record = (value: unknown): UnknownRecord =>
  value && typeof value === "object" ? (value as UnknownRecord) : {};
const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const string = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

function categoryScore(category: unknown): number | undefined {
  const score = number(record(category).score);
  if (score === undefined) return;
  return Math.round(Math.max(0, Math.min(1, score)) * 100);
}

function auditValue(
  audits: UnknownRecord,
  id: string,
  key: string,
): number | undefined {
  return number(record(audits[id])[key]);
}

function metricPercentile(
  metrics: UnknownRecord,
  id: string,
): number | undefined {
  return number(record(metrics[id]).percentile);
}

export function normalizePageSpeed(
  payload: unknown,
  url: string,
  strategy: Strategy,
): PageSpeedResult {
  const root = record(payload);
  const lighthouse = record(root.lighthouseResult);
  if (!Object.keys(lighthouse).length) {
    const message =
      string(record(root.error).message) ??
      "PageSpeed response did not include Lighthouse results";
    throw new Error(message);
  }
  const audits = record(lighthouse.audits);
  const categories = record(lighthouse.categories);
  const loading = record(root.loadingExperience);
  const metrics = record(loading.metrics);

  const opportunities = Object.entries(audits)
    .map(([id, raw]) => {
      const audit = record(raw);
      const details = record(audit.details);
      return {
        id,
        title: string(audit.title) ?? id,
        savingsMs: number(details.overallSavingsMs),
        savingsBytes: number(details.overallSavingsBytes),
      };
    })
    .filter((item) => (item.savingsMs ?? 0) > 0 || (item.savingsBytes ?? 0) > 0)
    .sort((a, b) => (b.savingsMs ?? 0) - (a.savingsMs ?? 0))
    .slice(0, LIMITS.maxOpportunities);

  const fieldInp = metricPercentile(metrics, "INTERACTION_TO_NEXT_PAINT");
  const overallCategory = string(loading.overall_category);
  return {
    url,
    strategy,
    fetchedAt: string(lighthouse.fetchTime),
    performanceScore: categoryScore(categories.performance),
    accessibilityScore: categoryScore(categories.accessibility),
    bestPracticesScore: categoryScore(categories["best-practices"]),
    seoScore: categoryScore(categories.seo),
    labMetrics: {
      firstContentfulPaintMs: auditValue(
        audits,
        "first-contentful-paint",
        "numericValue",
      ),
      largestContentfulPaintMs: auditValue(
        audits,
        "largest-contentful-paint",
        "numericValue",
      ),
      totalBlockingTimeMs: auditValue(
        audits,
        "total-blocking-time",
        "numericValue",
      ),
      cumulativeLayoutShift: auditValue(
        audits,
        "cumulative-layout-shift",
        "numericValue",
      ),
      speedIndexMs: auditValue(audits, "speed-index", "numericValue"),
    },
    ...(fieldInp !== undefined || overallCategory
      ? {
          fieldMetrics: { overallCategory, interactionToNextPaintMs: fieldInp },
        }
      : {}),
    opportunities,
  };
}

export async function analyzePageSpeed(
  target: string,
  strategy: Strategy = "mobile",
  env: Env = {},
  fetcher?: typeof fetch,
  apiKey?: string,
): Promise<PageSpeedResult> {
  const targetUrl = normalizePublicUrl(target);
  const api = new URL(
    "https://www.googleapis.com/pagespeedonline/v5/runPagespeed",
  );
  api.searchParams.set("url", targetUrl.toString());
  api.searchParams.set("strategy", strategy);
  for (const category of [
    "performance",
    "accessibility",
    "best-practices",
    "seo",
  ]) {
    api.searchParams.append("category", category);
  }
  const effectiveKey = apiKey ?? env.PAGESPEED_API_KEY;
  if (effectiveKey) api.searchParams.set("key", effectiveKey);

  const response = await fetchBounded(api, {
    maxBytes: LIMITS.maxJsonBytes,
    accept: "application/json",
    timeoutMs: 20_000,
    fetcher,
  });
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(response.bytes));
  } catch {
    throw new Error("PageSpeed returned invalid JSON");
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      string(record(record(payload).error).message) ??
        `PageSpeed returned HTTP ${response.status}`,
    );
  }
  return normalizePageSpeed(payload, targetUrl.toString(), strategy);
}
