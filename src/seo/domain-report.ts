import type { Env } from "../config";
import { crawlSite } from "../crawl/site";
import type { SiteCrawlResult } from "../crawl/site";
import { findSeoOpportunities } from "./intelligence";
import type { Opportunity } from "./intelligence";

export interface DomainSearch {
  startDate: string;
  endDate: string;
  opportunities: Opportunity[];
}

export interface DomainReport {
  url: string;
  crawl: {
    sitemapFound: boolean;
    crawled: number;
    failed: number;
    issueCounts: Record<string, number>;
    summary: SiteCrawlResult["summary"];
    crawlPolicy: SiteCrawlResult["crawlPolicy"];
    linkGraph: SiteCrawlResult["linkGraph"];
  };
  search?: DomainSearch;
  gscError?: string;
}

export function buildDomainReport(
  url: string,
  site: SiteCrawlResult,
  search: DomainSearch | null,
  gscError: string | null,
): DomainReport {
  const report: DomainReport = {
    url,
    crawl: {
      sitemapFound: site.sitemapFound,
      crawled: site.crawled,
      failed: site.failed,
      issueCounts: site.issueCounts,
      summary: site.summary,
      crawlPolicy: site.crawlPolicy,
      linkGraph: site.linkGraph,
    },
  };
  if (search !== null) report.search = search;
  if (gscError !== null) report.gscError = gscError;
  return report;
}

export interface AnalyzeDomainParams {
  url: string;
  limit?: number;
  concurrency?: number;
  gscProperty?: string;
  startDate?: string;
  endDate?: string;
  opportunityLimit?: number;
}

export async function analyzeDomain(
  params: AnalyzeDomainParams,
  env: Env,
  fetcher?: typeof fetch,
  now?: () => number,
): Promise<DomainReport> {
  const site = await crawlSite(
    params.url,
    params.limit,
    params.concurrency,
    fetcher,
  );

  let search: DomainSearch | null = null;
  let gscError: string | null = null;

  if (params.gscProperty && params.startDate && params.endDate) {
    try {
      const result = await findSeoOpportunities(
        {
          siteUrl: params.gscProperty,
          startDate: params.startDate,
          endDate: params.endDate,
          limit: params.opportunityLimit,
        },
        env,
        fetcher,
        now,
      );
      search = {
        startDate: params.startDate,
        endDate: params.endDate,
        opportunities: result.opportunities,
      };
    } catch (e) {
      gscError =
        e instanceof Error ? e.message : "Search Console analysis failed";
    }
  }

  return buildDomainReport(params.url, site, search, gscError);
}
