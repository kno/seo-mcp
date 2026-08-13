import type { GscQueryResult } from "../../../../src/types";

/**
 * `search-console-view`'s "Result Table Renders the Real Row Shape"
 * requirement: exactly the `search_console_query` result's own fields —
 * one column per element of `result.dimensions` (rendering the matching
 * `keys` entry positionally, since `keys[i]` corresponds to
 * `dimensions[i]` per the tool's own contract), plus `clicks`,
 * `impressions`, `ctr`, and `position`. No additional metric, unit, or
 * derived score is invented. `ctr` is rendered as returned (formatted as a
 * percentage for readability) rather than recomputed from `clicks` and
 * `impressions`.
 */
export interface SearchConsoleTableProps {
  readonly result: GscQueryResult;
}

function formatCtr(ctr: number): string {
  return `${(ctr * 100).toFixed(2)}%`;
}

export function SearchConsoleTable({ result }: SearchConsoleTableProps) {
  if (result.rows.length === 0) {
    return (
      <p className="empty-state">
        No rows for this property, date range, and dimensions.
      </p>
    );
  }

  return (
    <div className="table-scroll">
      <table aria-label="Search Console query results">
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
              <td>{formatCtr(row.ctr)}</td>
              <td>{row.position}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
