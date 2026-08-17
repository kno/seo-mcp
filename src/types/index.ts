/**
 * Published compile-time result types for the MCP tools with a published
 * output schema (`health`, `crawl_page`, `crawl_site`, `check_links`,
 * `analyze_pagespeed`, `search_console_query`, `find_striking_distance_keywords`,
 * `find_low_ctr_opportunities`, `snapshot_search_console`,
 * `list_search_console_snapshots`, `compare_search_console`,
 * `get_keyword_metrics`, `discover_keywords`, `cluster_keywords`,
 * `find_keyword_cannibalization`, `find_seo_opportunities`,
 * `map_keywords_to_pages`, `find_content_gaps`, `analyze_domain`,
 * `snapshot_crawl`, `list_crawl_snapshots`, `compare_crawls`). Type-only
 * re-exports: under `verbatimModuleSyntax`
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
export type { GscQueryResult, GscRow } from "../google/search-console";
export type { OpportunityResult } from "../google/opportunities";
export type { GscMetrics, GscDiffRow, GscDiff } from "../seo/gsc-diff";
// `StoredSnapshot` is published from the schema module rather than
// `src/db/gsc-store.ts`: that module calls D1-specific APIs
// (`D1Database.prepare/.bind/.all`) whose types come only from
// `@cloudflare/workers-types`, which `bff/ui`'s DOM-only tsconfig does not
// include. `StoredSnapshot` there is already `z.infer<typeof
// storedSnapshotSchema>` — the exact same type — so this re-export is
// identical, not a duplicate, while keeping this module importable from a
// DOM-only consumer.
export type {
  StoredSnapshot,
  SnapshotSearchConsoleResult,
  ListSearchConsoleSnapshotsResult,
  CompareSearchConsoleResult,
  DeleteSearchConsoleSnapshotResult,
} from "../schemas/gsc-snapshots";
export type { CrawlPageIssueChange, CrawlDiff } from "../seo/crawl-diff";
// `StoredCrawlSnapshot` is published from the schema module rather than
// `src/db/crawl-store.ts`, for the identical reason `StoredSnapshot` is
// above: that module calls D1-specific APIs
// (`D1Database.prepare/.bind/.all`) whose types come only from
// `@cloudflare/workers-types`, absent from `bff/ui`'s DOM-only tsconfig.
export type {
  StoredCrawlSnapshot,
  SnapshotCrawlResult,
  ListCrawlSnapshotsResult,
  CompareCrawlsResult,
  DeleteCrawlSnapshotResult,
} from "../schemas/crawl-snapshots";
export type { KeywordMetric, KeywordMetricsResult } from "../google/ads";
export type {
  KeywordIntent,
  ClassifiedKeyword,
  KeywordCluster,
  ClusterResult,
} from "../seo/keywords";
export type {
  OpportunityType,
  Opportunity,
  CannibalPage,
  CannibalGroup,
} from "../seo/intelligence";
export type { PageQuery, PageKeywords, ContentGap } from "../seo/keyword-pages";
// `DomainReport`/`DomainSearch` are published from the schema module rather
// than `src/seo/domain-report.ts`: that module's `analyzeDomain` transitively
// imports `src/crawl/site.ts` (robots/sitemap fetch, response-byte budget),
// which is heavier Worker runtime surface than a DOM-only consumer needs to
// pull in just for the type. `DomainReport` there is already
// `z.infer<typeof domainReportSchema>` — the exact same type — so this
// re-export is identical, not a duplicate.
export type { DomainSearch, DomainReport } from "../schemas/domain-report";
