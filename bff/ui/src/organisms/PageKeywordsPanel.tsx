import type { PageKeywords } from "../../../../src/schemas/intelligence";
import { DrillDownLink } from "../molecules/DrillDownLink";

/**
 * `seo-intelligence-view`'s (PR10) `map_keywords_to_pages` result. Each
 * page gets a `page-report-view` drill-down (task 10.11) — `PageKeywords.page`
 * is always a non-null string.
 */
export interface PageKeywordsPanelProps {
  readonly pages: readonly PageKeywords[];
}

export function PageKeywordsPanel({ pages }: PageKeywordsPanelProps) {
  return (
    <div className="view-stack">
      {pages.map((page, index) => (
        <div className="panel" key={`${page.page}-${index}`}>
          <div className="panel-head">
            <h3>
              <DrillDownLink
                view="page-report"
                url={page.page}
                label={page.page}
              />
            </h3>
            <p
              className="panel-subtitle"
              data-testid={`page-keywords-summary-${index}`}
            >
              {page.queryCount} query(ies) — {page.totalClicks} clicks,{" "}
              {page.totalImpressions} impressions
            </p>
          </div>
          <table aria-label={`Top queries for ${page.page}`}>
            <thead>
              <tr>
                <th scope="col">Query</th>
                <th scope="col">Clicks</th>
                <th scope="col">Impressions</th>
                <th scope="col">Position</th>
              </tr>
            </thead>
            <tbody>
              {page.topQueries.map((query) => (
                <tr key={query.query}>
                  <td>{query.query}</td>
                  <td>{query.clicks}</td>
                  <td>{query.impressions}</td>
                  <td>{query.position}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
