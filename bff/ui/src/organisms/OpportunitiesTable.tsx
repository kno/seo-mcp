import { Absent } from "../atoms/Absent";

/**
 * `pagespeed-view`'s "Opportunities Table With Estimated Savings"
 * requirement. An opportunity with neither `savingsMs` nor `savingsBytes`
 * MUST still be listed — a savings figure of zero or absent does not mean
 * the opportunity is unimportant enough to drop — so this component never
 * filters `opportunities`; each missing savings column renders `Absent`
 * rather than `0`.
 */
export interface Opportunity {
  readonly id: string;
  readonly title: string;
  readonly savingsMs?: number;
  readonly savingsBytes?: number;
}

export interface OpportunitiesTableProps {
  readonly opportunities: readonly Opportunity[];
}

export function OpportunitiesTable({ opportunities }: OpportunitiesTableProps) {
  if (opportunities.length === 0) {
    return (
      <p className="empty-state empty-state-ok">No opportunities reported.</p>
    );
  }

  return (
    <div className="table-scroll">
      <table aria-label="Optimization opportunities">
        <thead>
          <tr>
            <th scope="col">Opportunity</th>
            <th scope="col">Time savings</th>
            <th scope="col">Size savings</th>
          </tr>
        </thead>
        <tbody>
          {opportunities.map((opportunity) => (
            <tr key={opportunity.id}>
              <td>{opportunity.title}</td>
              <td data-testid={`savings-ms-${opportunity.id}`}>
                {opportunity.savingsMs === undefined ? (
                  <Absent label="time savings" />
                ) : (
                  `${opportunity.savingsMs} ms`
                )}
              </td>
              <td data-testid={`savings-bytes-${opportunity.id}`}>
                {opportunity.savingsBytes === undefined ? (
                  <Absent label="size savings" />
                ) : (
                  `${opportunity.savingsBytes} bytes`
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
