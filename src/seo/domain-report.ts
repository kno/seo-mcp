import type * as z from "zod/v4";
import type { Env } from "../config";
import { crawlSite } from "../crawl/site";
import type { SiteCrawlResult } from "../crawl/site";
import { findSeoOpportunities } from "./intelligence";
import { resolveSiteCredentials } from "../google/credentials";
import {
  domainReportSchema,
  domainSearchSchema,
} from "../schemas/domain-report";

export type DomainSearch = z.infer<typeof domainSearchSchema>;

export type DomainReport = z.infer<typeof domainReportSchema>;

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
      const { credentials } = await resolveSiteCredentials(
        env,
        params.gscProperty,
      );
      const result = await findSeoOpportunities(
        {
          siteUrl: params.gscProperty,
          startDate: params.startDate,
          endDate: params.endDate,
          limit: params.opportunityLimit,
        },
        credentials,
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
