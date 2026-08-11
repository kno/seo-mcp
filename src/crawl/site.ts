import { LIMITS } from "../config";
import { createFetchBudget, createResponseByteBudget } from "../http/fetch";
import { crawlPage } from "./page";
import { discoverSitemapUrls } from "./sitemap";
import type { PageAnalysis } from "../seo/html";

export interface SiteCrawlResult {
  site: string;
  sitemap: string;
  sitemapFound: boolean;
  requested: number;
  crawled: number;
  failed: number;
  documentsRead: number;
  subrequests: number;
  bytesRead: number;
  outputBytes: number;
  pages: Array<{ url: string; result?: SitePageAnalysis; error?: string }>;
  issueCounts: Record<string, number>;
}

export type SitePageAnalysis = Omit<PageAnalysis, "links"> & {
  linkCount: number;
};

function compactPage(result: PageAnalysis): SitePageAnalysis {
  const { links, ...signals } = result;
  return { ...signals, linkCount: links.length };
}

export async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, run),
  );
  return results;
}

export function aggregateIssueCounts(
  pages: SiteCrawlResult["pages"],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const page of pages) {
    for (const issue of page.result?.issues ?? [])
      counts[issue.code] = (counts[issue.code] ?? 0) + 1;
  }
  return counts;
}

export function measureBoundedOutput(
  value: unknown,
  maximum: number = LIMITS.maxSiteOutputBytes,
): number {
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (bytes > maximum)
    throw new Error(`Site crawl output exceeds ${maximum} byte limit`);
  return bytes;
}

export async function crawlSite(
  siteUrl: string,
  requestedLimit: number = LIMITS.defaultCrawlPages,
  requestedConcurrency: number = LIMITS.maxConcurrency,
  fetcher?: typeof fetch,
): Promise<SiteCrawlResult> {
  const limit = Math.max(
    1,
    Math.min(Math.floor(requestedLimit), LIMITS.maxCrawlPages),
  );
  const concurrency = Math.max(
    1,
    Math.min(Math.floor(requestedConcurrency), LIMITS.maxConcurrency),
  );
  const budget = createFetchBudget(fetcher, 48);
  const byteBudget = createResponseByteBudget(LIMITS.maxSiteResponseBytes);
  const discovered = await discoverSitemapUrls(
    siteUrl,
    limit,
    budget.fetcher,
    byteBudget,
  );
  const pages = await mapConcurrent(
    discovered.urls,
    concurrency,
    async (url) => {
      try {
        const result = await crawlPage(url, budget.fetcher, byteBudget);
        return { url, result: compactPage(result) };
      } catch (error) {
        return {
          url,
          error: error instanceof Error ? error.message : "Unknown crawl error",
        };
      }
    },
  );
  const result = {
    site: siteUrl,
    sitemap: discovered.sitemap,
    sitemapFound: discovered.sitemapFound,
    requested: limit,
    crawled: pages.filter((page) => page.result).length,
    failed: pages.filter((page) => page.error).length,
    documentsRead: discovered.documentsRead,
    subrequests: budget.used(),
    bytesRead: byteBudget.used(),
    issueCounts: aggregateIssueCounts(pages),
    pages,
  };
  const outputBytes = measureBoundedOutput(result);
  return { ...result, outputBytes };
}
