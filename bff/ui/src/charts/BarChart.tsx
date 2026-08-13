/**
 * Hand-rolled horizontal bar chart for `linkGraph.topLinkedPages`
 * (`design.md`'s "Charting Primitives" — no charting library dependency).
 * Authored as a real `<table>` of URL and inbound count; the SVG bars are
 * `aria-hidden="true"` decoration layered visually alongside each row, so
 * the data is natively accessible and screen-reader-navigable through the
 * table regardless of whether the SVG renders at all. Order is always the
 * result's own order — never re-sorted client-side by inbound count.
 */
export interface BarChartItem {
  readonly url: string;
  readonly inbound: number;
}

export interface BarChartProps {
  readonly items: readonly BarChartItem[];
}

export function BarChart({ items }: BarChartProps) {
  if (items.length === 0) {
    return <p>No linked pages to show.</p>;
  }

  const maxInbound = Math.max(...items.map((item) => item.inbound), 1);

  return (
    <table aria-label="Most-linked pages">
      <thead>
        <tr>
          <th scope="col">URL</th>
          <th scope="col">Inbound links</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const widthPercent = (item.inbound / maxInbound) * 100;
          return (
            <tr key={item.url}>
              <td>
                {item.url}
                <svg
                  aria-hidden="true"
                  viewBox="0 0 100 10"
                  preserveAspectRatio="none"
                  width="100%"
                  height="0.6em"
                >
                  <rect x={0} y={0} width={widthPercent} height={10} />
                </svg>
              </td>
              <td>{item.inbound}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
