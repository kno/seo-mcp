import type { CannibalGroup } from "../../../../src/schemas/intelligence";
import { describeCannibalGroupPagesBound } from "../data/bounds";
import { SampleBadge } from "../molecules/SampleBadge";
import { DrillDownLink } from "../molecules/DrillDownLink";

/**
 * `seo-intelligence-view`'s (PR10) `find_keyword_cannibalization` result —
 * task 10.6. Every `CannibalGroup.pages` entry renders `page`/`clicks`/
 * `impressions`/`position`; when `pages.length < pageCount` the rendered
 * subset carries a `SampleBadge` bound label (`describeCannibalGroupPagesBound`),
 * the same bound-labeling discipline `DomainSummaryPanel`'s duplicate
 * groups already established for this app. Each page also gets a
 * `page-report-view` drill-down (task 10.11) — every `CannibalPage.page` is
 * non-null by construction.
 */
export interface CannibalizationPanelProps {
  readonly groups: readonly CannibalGroup[];
}

export function CannibalizationPanel({ groups }: CannibalizationPanelProps) {
  return (
    <div className="view-stack">
      {groups.map((group, index) => (
        <div className="panel" key={`${group.query}-${index}`}>
          <div className="panel-head">
            <h3>{group.query}</h3>
            <p
              className="panel-subtitle"
              data-testid={`cannibal-group-count-${index}`}
            >
              {group.pageCount} competing page(s) — {group.totalClicks} clicks,{" "}
              {group.totalImpressions} impressions
            </p>
          </div>
          <table aria-label={`Pages competing for "${group.query}"`}>
            <thead>
              <tr>
                <th scope="col">Page</th>
                <th scope="col">Clicks</th>
                <th scope="col">Impressions</th>
                <th scope="col">Position</th>
              </tr>
            </thead>
            <tbody>
              {group.pages.map((page) => (
                <tr key={page.page}>
                  <td>
                    <DrillDownLink
                      view="page-report"
                      url={page.page}
                      label={page.page}
                    />
                  </td>
                  <td>{page.clicks}</td>
                  <td>{page.impressions}</td>
                  <td>{page.position}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <SampleBadge
            cardinality={describeCannibalGroupPagesBound(
              group,
              `groups[${index}].pages`,
            )}
          />
        </div>
      ))}
    </div>
  );
}
