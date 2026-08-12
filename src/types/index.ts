/**
 * Published compile-time result types for all five MCP tools this change
 * scopes (`health`, `crawl_page`, `crawl_site`, `check_links`,
 * `analyze_pagespeed`). Type-only re-exports: under `verbatimModuleSyntax`
 * this module erases entirely, so importing it (e.g. from the BFF or the
 * dashboard) pulls in zero Worker runtime code from `src/http`,
 * `src/crawl`, `src/seo`, or `src/pagespeed`.
 *
 * For runtime validation, import the matching schemas from
 * `src/types/schemas.ts` instead.
 */
export type { HealthResult } from "../schemas/health";
export type { PageAnalysis } from "../seo/html";
export type {
  SiteCrawlResult,
  SitePageAnalysis,
  DomainSummary,
  CrawlPolicy,
  LinkGraphSummary,
  DomainCategory,
  DuplicateGroup,
} from "../crawl/site";
export type { LinkCheckResult, LinkProbe } from "../crawl/links";
export type { PageSpeedResult, Strategy } from "../pagespeed/types";
