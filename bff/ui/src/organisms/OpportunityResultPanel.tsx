import type { OpportunityResult } from "../../../../src/types";
import { describeOpportunityBound, isBounded } from "../data/bounds";

/**
 * Renders an `OpportunityResult` (`find_striking_distance_keywords` /
 * `find_low_ctr_opportunities`, `gsc-insight-views`):
 *
 * - The echoed `criteria` object (including server-applied defaults) is
 *   always shown alongside the rows — task 6.2, "Applied Criteria Are Shown
 *   Alongside Results". `criteria` is a `Record<string, number>`, so every
 *   key it happens to carry renders, without this component hardcoding the
 *   field list per tool.
 * - The bound label appears exactly when `rowCount === criteria.limit`
 *   (task 6.3), read from the echoed `criteria`, never a hardcoded number.
 *   A zero-row result renders `NoOpportunities` — a visually and
 *   semantically distinct empty state, never the same markup as "not yet
 *   submitted" (that pre-submission state is the container's job, before
 *   this component ever mounts).
 * - An unconditional caveat states the raw 250-row Search Console pull
 *   happens BEFORE filtering, so this view MUST NEVER claim exhaustiveness
 *   — not even when `rowCount < criteria.limit`.
 */
export interface OpportunityResultPanelProps {
  readonly result: OpportunityResult;
}

function formatCriteriaValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

export function OpportunityResultPanel({
  result,
}: OpportunityResultPanelProps) {
  const cardinality = describeOpportunityBound(result);
  const criteriaEntries = Object.entries(result.criteria);

  return (
    <div className="panel panel-wide span-full">
      <h3>Applied criteria</h3>
      <dl aria-label="Applied criteria" data-testid="opportunity-criteria">
        {criteriaEntries.map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{formatCriteriaValue(value)}</dd>
          </div>
        ))}
      </dl>

      <p className="field-hint" data-testid="opportunity-exhaustiveness-caveat">
        Derived from at most 250 Search Console rows pulled before filtering —
        this is never a complete enumeration of every matching opportunity,
        regardless of how many rows are shown below.
      </p>

      {isBounded(cardinality) && (
        <p
          className="bound-indicator"
          data-testid="opportunity-bound-indicator"
        >
          Showing {cardinality.bound.shown} of a maximum{" "}
          {cardinality.bound.limitValue} ({cardinality.bound.limitName}). More
          matching opportunities may exist beyond this limit.
        </p>
      )}

      {result.rowCount === 0 ? (
        <p className="empty-state" data-testid="opportunity-empty-state">
          No opportunities found for this property, date range, and criteria.
        </p>
      ) : (
        <div className="table-scroll">
          <table aria-label="Opportunity results">
            <thead>
              <tr>
                {result.dimensions.map((dimension) => (
                  <th key={dimension} scope="col">
                    {dimension}
                  </th>
                ))}
                <th scope="col">clicks</th>
                <th scope="col">impressions</th>
                <th scope="col">ctr</th>
                <th scope="col">position</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, index) => (
                <tr key={row.keys.join("|") || index}>
                  {row.keys.map((keyValue, keyIndex) => (
                    <td
                      key={`${result.dimensions[keyIndex] ?? keyIndex}-${keyValue}`}
                    >
                      {keyValue}
                    </td>
                  ))}
                  <td>{row.clicks}</td>
                  <td>{row.impressions}</td>
                  <td>{(row.ctr * 100).toFixed(2)}%</td>
                  <td>{row.position}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
