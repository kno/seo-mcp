import type { ContentGap } from "../../../../src/schemas/intelligence";
import { DrillDownLink } from "../molecules/DrillDownLink";

/**
 * `seo-intelligence-view`'s (PR10) `find_content_gaps` result. Each gap
 * gets a `page-report-view` drill-down (task 10.11) — `ContentGap.page` is
 * always a non-null string.
 */
export interface ContentGapsPanelProps {
  readonly gaps: readonly ContentGap[];
}

export function ContentGapsPanel({ gaps }: ContentGapsPanelProps) {
  return (
    <div className="table-scroll">
      <table aria-label="Content gaps">
        <thead>
          <tr>
            <th scope="col">Query</th>
            <th scope="col">Page</th>
            <th scope="col">Impressions</th>
            <th scope="col">Clicks</th>
            <th scope="col">Position</th>
          </tr>
        </thead>
        <tbody>
          {gaps.map((gap, index) => (
            <tr key={`${gap.query}-${index}`}>
              <td>{gap.query}</td>
              <td>
                <DrillDownLink
                  view="page-report"
                  url={gap.page}
                  label={gap.page}
                />
              </td>
              <td>{gap.impressions}</td>
              <td>{gap.clicks}</td>
              <td>{gap.position}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
