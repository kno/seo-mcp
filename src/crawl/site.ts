import type * as z from "zod/v4";
import { LIMITS } from "../config";
import { createFetchBudget, createResponseByteBudget } from "../http/fetch";
import { crawlPage } from "./page";
import { fetchRobots, isPathAllowed, ROBOTS_USER_AGENT } from "./robots";
import { discoverSitemapUrls } from "./sitemap";
import { normalizePublicUrl } from "../security/url-policy";
import type { PageAnalysis } from "../seo/html";
import {
  crawlPolicySchema,
  domainCategorySchema,
  domainSummarySchema,
  duplicateGroupSchema,
  linkGraphSummarySchema,
  siteCrawlResultSchema,
  sitePageAnalysisSchema,
} from "../schemas/site";

export type DomainCategory = z.infer<typeof domainCategorySchema>;
export type DuplicateGroup = z.infer<typeof duplicateGroupSchema>;
export type DomainSummary = z.infer<typeof domainSummarySchema>;
export type CrawlPolicy = z.infer<typeof crawlPolicySchema>;
export type LinkGraphSummary = z.infer<typeof linkGraphSummarySchema>;
export type SiteCrawlResult = z.infer<typeof siteCrawlResultSchema>;
export type SitePageAnalysis = z.infer<typeof sitePageAnalysisSchema>;

function compactPage(result: PageAnalysis): SitePageAnalysis {
  const { links, internalLinkTargets, ...signals } = result;
  void internalLinkTargets;
  return { ...signals, linkCount: links.length };
}

export function summarizeLinkGraph(
  pages: Array<{ url: string; internalLinkTargets?: string[] }>,
): LinkGraphSummary {
  const crawled: Array<{ url: string; normalized: string; targets: string[] }> =
    [];
  const crawledSet = new Set<string>();
  const normalize = (value: string): string | undefined => {
    try {
      return normalizePublicUrl(value).toString();
    } catch {
      return undefined;
    }
  };

  for (const page of pages) {
    if (!page.internalLinkTargets) continue;
    const normalized = normalize(page.url);
    if (normalized === undefined) continue;
    crawled.push({
      url: page.url,
      normalized,
      targets: page.internalLinkTargets,
    });
    crawledSet.add(normalized);
  }

  const inbound = new Map<string, number>();
  for (const page of crawled) {
    for (const target of page.targets) {
      const normalizedTarget = normalize(target);
      if (normalizedTarget === undefined) continue;
      if (!crawledSet.has(normalizedTarget)) continue;
      if (normalizedTarget === page.normalized) continue;
      inbound.set(normalizedTarget, (inbound.get(normalizedTarget) ?? 0) + 1);
    }
  }

  const orphanSample: string[] = [];
  let orphanCount = 0;
  const topEntries: Array<{ url: string; inbound: number }> = [];
  for (const page of crawled) {
    const count = inbound.get(page.normalized) ?? 0;
    if (count === 0) {
      orphanCount++;
      if (orphanSample.length < 25) orphanSample.push(page.url);
    } else {
      topEntries.push({ url: page.url, inbound: count });
    }
  }

  topEntries.sort((a, b) => {
    if (b.inbound !== a.inbound) return b.inbound - a.inbound;
    return a.url < b.url ? -1 : a.url > b.url ? 1 : 0;
  });

  return {
    crawledPages: crawled.length,
    orphanPages: { count: orphanCount, sample: orphanSample },
    topLinkedPages: topEntries.slice(0, 10),
  };
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

  const site = normalizePublicUrl(siteUrl);
  const robots = await fetchRobots(site, budget.fetcher, byteBudget);
  const allowedUrls: string[] = [];
  const disallowedUrls: string[] = [];
  for (const url of discovered.urls) {
    const parsed = new URL(url);
    const requestPath = `${parsed.pathname}${parsed.search}`;
    if (isPathAllowed(robots.rules, requestPath)) allowedUrls.push(url);
    else disallowedUrls.push(url);
  }
  const crawlPolicy: CrawlPolicy = {
    robotsUrl: robots.url,
    robotsFound: robots.found,
    userAgent: ROBOTS_USER_AGENT,
    sitemapsDeclared: robots.rules.sitemaps.slice(0, 20),
    disallowedSkipped: {
      count: disallowedUrls.length,
      sample: disallowedUrls.slice(0, 25),
    },
  };

  const pages = await mapConcurrent(allowedUrls, concurrency, async (url) => {
    try {
      const full = await crawlPage(url, budget.fetcher, byteBudget);
      return {
        url,
        result: compactPage(full),
        targets: full.internalLinkTargets,
      };
    } catch (error) {
      return {
        url,
        error: error instanceof Error ? error.message : "Unknown crawl error",
      };
    }
  });
  const linkGraph = summarizeLinkGraph(
    pages.map((page) => ({
      url: page.url,
      internalLinkTargets: "targets" in page ? page.targets : undefined,
    })),
  );
  const outputPages = pages.map((page) => {
    if ("targets" in page) {
      const { targets, ...rest } = page;
      void targets;
      return rest;
    }
    return page;
  });
  const result = {
    site: siteUrl,
    sitemap: discovered.sitemap,
    sitemapFound: discovered.sitemapFound,
    crawlPolicy,
    requested: limit,
    crawled: outputPages.filter((page) => page.result).length,
    failed: outputPages.filter((page) => page.error).length,
    documentsRead: discovered.documentsRead,
    subrequests: budget.used(),
    bytesRead: byteBudget.used(),
    issueCounts: aggregateIssueCounts(outputPages),
    summary: summarizeDomain(outputPages),
    linkGraph,
    pages: outputPages,
  };
  const outputBytes = measureBoundedOutput(result);
  return { ...result, outputBytes };
}
