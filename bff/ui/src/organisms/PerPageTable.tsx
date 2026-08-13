import type { SiteCrawlResult, SitePageAnalysis } from "../../../../src/types";

/**
 * `site-crawl-view`'s "Per-Page Table With Drill-Down" requirement.
 * `SiteCrawlResult.pages` entries are a discriminated `{ url; result?;
 * error? }` XOR (per `design.md`'s export section) — a row with `error` set
 * shows that error message and never a fabricated issue count, and only a
 * row with `result` set offers the drill-down action. `onDrillDown`
 * receives the row's OWN already-in-memory `result` (a `SitePageAnalysis`)
 * directly — this component never calls `requestTool` or imports
 * `data/client`, so drill-down cannot issue a new `crawl_page` request by
 * construction; the container decides what to do with that data (render
 * the same presentational organisms `page-report-view` uses, fed directly
 * from this value).
 */
export interface PerPageTableProps {
  readonly pages: SiteCrawlResult["pages"];
  readonly onDrillDown: (result: SitePageAnalysis) => void;
}

export function PerPageTable({ pages, onDrillDown }: PerPageTableProps) {
  if (pages.length === 0) {
    return <p className="empty-state">No pages were crawled.</p>;
  }

  return (
    <div className="table-scroll">
      <table aria-label="Per-page crawl results">
        <thead>
          <tr>
            <th scope="col">URL</th>
            <th scope="col">Status</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {pages.map((page) => (
            <tr key={page.url}>
              <td className="cell-url">{page.url}</td>
              <td>
                {page.result ? (
                  <span
                    className={
                      page.result.issues.length === 0
                        ? "pill pill-ok"
                        : "pill pill-warn"
                    }
                    data-testid={`issue-count-${page.url}`}
                  >
                    {page.result.issues.length} issue(s)
                  </span>
                ) : (
                  <span
                    className="pill pill-danger"
                    data-testid={`page-error-${page.url}`}
                  >
                    {page.error}
                  </span>
                )}
              </td>
              <td className="cell-actions">
                {page.result && (
                  <button
                    className="btn-sm"
                    type="button"
                    onClick={() => onDrillDown(page.result as SitePageAnalysis)}
                  >
                    View report
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
