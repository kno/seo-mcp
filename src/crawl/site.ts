import { LIMITS } from "../config";
import { createFetchBudget, createResponseByteBudget } from "../http/fetch";
import { crawlPage } from "./page";
import { discoverSitemapUrls } from "./sitemap";
import type { PageAnalysis } from "../seo/html";

export interface DomainCategory {
  count: number;
  sample: string[];
}

export interface DuplicateGroup {
  value: string;
  count: number;
  sample: string[];
}

export interface DomainSummary {
  pagesAnalyzed: number;
  duplicateTitles: DuplicateGroup[];
  duplicateDescriptions: DuplicateGroup[];
  missingH1: DomainCategory;
  multipleH1: DomainCategory;
  thinContent: DomainCategory;
  nonIndexable: DomainCategory;
  imagesMissingAlt: { pages: number; images: number };
}

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
  summary: DomainSummary;
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

function normalizeMeta(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function buildDuplicateGroups(
  pages: SiteCrawlResult["pages"],
  getValue: (r: SitePageAnalysis) => string,
): DuplicateGroup[] {
  const map = new Map<string, string[]>();
  for (const page of pages) {
    if (!page.result) continue;
    const raw = getValue(page.result);
    const normalized = normalizeMeta(raw);
    if (!normalized) continue;
    const existing = map.get(normalized);
    if (existing) existing.push(page.url);
    else map.set(normalized, [page.url]);
  }
  const groups: DuplicateGroup[] = [];
  for (const [value, urls] of map) {
    if (urls.length <= 1) continue;
    groups.push({
      value: value.slice(0, 200),
      count: urls.length,
      sample: urls.slice(0, 10),
    });
  }
  groups.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
  });
  return groups.slice(0, 20);
}

function buildCategory(urls: string[]): DomainCategory {
  return { count: urls.length, sample: urls.slice(0, 25) };
}

export function summarizeDomain(
  pages: SiteCrawlResult["pages"],
): DomainSummary {
  const missingH1Urls: string[] = [];
  const multipleH1Urls: string[] = [];
  const thinContentUrls: string[] = [];
  const nonIndexableUrls: string[] = [];
  let imagesMissingAltPages = 0;
  let imagesMissingAltTotal = 0;
  let pagesAnalyzed = 0;

  for (const page of pages) {
    if (!page.result) continue;
    pagesAnalyzed++;
    const r = page.result;

    if (r.h1.length === 0) missingH1Urls.push(page.url);
    if (r.h1.length > 1) multipleH1Urls.push(page.url);
    if (r.wordCount > 0 && r.wordCount < 250) thinContentUrls.push(page.url);
    if (!r.indexable) nonIndexableUrls.push(page.url);
    if (r.imagesMissingAlt > 0) {
      imagesMissingAltPages++;
      imagesMissingAltTotal += r.imagesMissingAlt;
    }
  }

  return {
    pagesAnalyzed,
    duplicateTitles: buildDuplicateGroups(pages, (r) => r.title ?? ""),
    duplicateDescriptions: buildDuplicateGroups(
      pages,
      (r) => r.description ?? "",
    ),
    missingH1: buildCategory(missingH1Urls),
    multipleH1: buildCategory(multipleH1Urls),
    thinContent: buildCategory(thinContentUrls),
    nonIndexable: buildCategory(nonIndexableUrls),
    imagesMissingAlt: {
      pages: imagesMissingAltPages,
      images: imagesMissingAltTotal,
    },
  };
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
    summary: summarizeDomain(pages),
    pages,
  };
  const outputBytes = measureBoundedOutput(result);
  return { ...result, outputBytes };
}
