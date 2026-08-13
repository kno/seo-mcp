import type {
  DomainReportCrawl,
  DomainSearch,
} from "../../../../src/schemas/domain-report";
import type { BffErrorCode } from "../../../src/errors";
import { SeoOpportunitiesPanel } from "./SeoOpportunitiesPanel";
import { DrillDownLink } from "../molecules/DrillDownLink";

/**
 * `seo-intelligence-view`'s (PR10) `analyze_domain` result. The BFF-envelope
 * shape here is NOT `DomainReport` verbatim: `gscError` (a raw upstream
 * string) never reaches this component at all — `authenticated/domain-
 * report.ts#classifyDomainReportGscError` replaces it with `enrichmentError`
 * before the response ever leaves the BFF (task 10.9/10.10).
 *
 * Renders the crawl portion's own `site-crawl-view` drill-down (task 10.11,
 * via `DrillDownLink`) plus the THREE enrichment states distinctly (task
 * 10.8):
 * - not requested — neither `search` nor `enrichmentError` present.
 * - `search` present — enrichment succeeded; renders the same
 *   `SeoOpportunitiesPanel` `find_seo_opportunities` uses (the underlying
 *   tool call is literally `findSeoOpportunities`,
 *   `src/seo/domain-report.ts#analyzeDomain`).
 * - `enrichmentError` present — classified failure. Rendered with its own
 *   distinct `alert` styling so it can NEVER collapse into the
 *   not-requested state's plain absence of a search panel.
 */
export interface DomainReportPanelProps {
  readonly url: string;
  readonly crawl: DomainReportCrawl;
  readonly search?: DomainSearch;
  readonly enrichmentError?: { readonly code: BffErrorCode };
}

export function DomainReportPanel({
  url,
  crawl,
  search,
  enrichmentError,
}: DomainReportPanelProps) {
  return (
    <div className="view-stack">
      <div className="panel">
        <div className="panel-head">
          <h3>Crawl</h3>
          <p
            className="panel-subtitle"
            data-testid="domain-report-crawl-summary"
          >
            {crawl.crawled} crawled, {crawl.failed} failed
            {crawl.sitemapFound ? "" : " (no sitemap found)"}
          </p>
        </div>
        <DrillDownLink
          view="site-crawl"
          url={url}
          label="View full site crawl"
        />
      </div>

      <div
        className="panel"
        data-testid="domain-report-enrichment-state"
        data-enrichment-state={
          enrichmentError ? "failed" : search ? "succeeded" : "not-requested"
        }
      >
        <h3>Search Console enrichment</h3>
        {enrichmentError ? (
          <div
            className="alert"
            role="alert"
            data-testid="domain-report-enrichment-error"
          >
            <p className="alert-title">Enrichment failed</p>
            <p className="alert-description">{enrichmentError.code}</p>
          </div>
        ) : search ? (
          <>
            <p className="field-hint" data-testid="domain-report-search-range">
              {search.startDate} – {search.endDate}
            </p>
            <SeoOpportunitiesPanel opportunities={search.opportunities} />
          </>
        ) : (
          <p
            className="empty-state"
            data-testid="domain-report-enrichment-not-requested"
          >
            Not requested — provide a Search Console property and date range to
            include prioritized opportunities.
          </p>
        )}
      </div>
    </div>
  );
}
