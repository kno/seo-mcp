import type {
  Opportunity,
  OpportunityType,
} from "../../../../src/schemas/intelligence";
import { DrillDownLink } from "../molecules/DrillDownLink";

/**
 * `seo-intelligence-view`'s (PR10) `find_seo_opportunities` result table —
 * tasks 10.4/10.5/10.7/10.11.
 *
 * - Every row renders `type` AND `recommendation` together (task 10.4).
 *   `type` gets a distinct badge class per value (`opportunity-type-*`),
 *   the same "distinguish by more than raw text" convention `DecayBadge`
 *   (Phase 6's four decay buckets) already established for this app.
 * - `impact`/`effort`/`priorityScore` all render together, even sorted by
 *   `priorityScore` (task 10.5) — `effort` (`Opportunity.effort`, a fixed
 *   1/2/3 per-type constant confirmed in `src/seo/intelligence.ts`) is
 *   rendered as a Low/Medium/High label, never rescaled onto an invented
 *   0-100 range.
 * - `striking_distance`'s recommendation text is rendered AS-IS, verbatim
 *   from the tool — this component adds no link-graph-aware wording of its
 *   own (task 10.7): no tool touches `linkGraph`/`orphanPages`/
 *   `topLinkedPages` to produce this recommendation, so none is implied
 *   here either.
 * - A non-null `page` gets a drill-down to `page-report-view` (task 10.11).
 *   `cannibalization`-type opportunities always have `page: null`
 *   (confirmed in `src/seo/intelligence.ts`) — no link is rendered for
 *   them; the affordance is OMITTED, never shown disabled.
 */
export interface SeoOpportunitiesPanelProps {
  readonly opportunities: readonly Opportunity[];
}

const TYPE_LABEL: Record<OpportunityType, string> = {
  low_ctr: "Low CTR",
  striking_distance: "Striking distance",
  cannibalization: "Cannibalization",
};

/** `effort` is a fixed 1/2/3 per-type constant, not a fine-grained score —
 * rendered as a coarse label rather than fabricating decimal precision or
 * rescaling onto an invented 0-100 range (task 10.5). */
function effortLabel(effort: number): string {
  if (effort <= 1) return "Low";
  if (effort === 2) return "Medium";
  return "High";
}

export function SeoOpportunitiesPanel({
  opportunities,
}: SeoOpportunitiesPanelProps) {
  return (
    <div className="table-scroll">
      <table aria-label="SEO opportunities">
        <thead>
          <tr>
            <th scope="col">Type</th>
            <th scope="col">Query</th>
            <th scope="col">Page</th>
            <th scope="col">Impressions</th>
            <th scope="col">Current position</th>
            <th scope="col">Impact</th>
            <th scope="col">Effort</th>
            <th scope="col">Priority score</th>
            <th scope="col">Recommendation</th>
          </tr>
        </thead>
        <tbody>
          {opportunities.map((opportunity, index) => (
            <tr key={`${opportunity.type}-${opportunity.query}-${index}`}>
              <td>
                <span
                  className={`opportunity-type-badge opportunity-type-${opportunity.type}`}
                  data-testid={`opportunity-type-${index}`}
                >
                  {TYPE_LABEL[opportunity.type]}
                </span>
              </td>
              <td>{opportunity.query}</td>
              <td data-testid={`opportunity-page-${index}`}>
                {opportunity.page === null ? (
                  "—"
                ) : (
                  <DrillDownLink
                    view="page-report"
                    url={opportunity.page}
                    label={opportunity.page}
                  />
                )}
              </td>
              <td>{opportunity.impressions}</td>
              <td>
                {opportunity.currentPosition === null
                  ? "—"
                  : opportunity.currentPosition}
              </td>
              <td data-testid={`opportunity-impact-${index}`}>
                {opportunity.impact}
              </td>
              <td data-testid={`opportunity-effort-${index}`}>
                {effortLabel(opportunity.effort)}
              </td>
              <td data-testid={`opportunity-priority-${index}`}>
                {opportunity.priorityScore}
              </td>
              <td data-testid={`opportunity-recommendation-${index}`}>
                {opportunity.recommendation}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
