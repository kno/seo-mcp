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
    return <p className="empty-state">No linked pages to show.</p>;
  }

  const maxInbound = Math.max(...items.map((item) => item.inbound), 1);

  return (
    <div className="table-scroll">
      <table className="bar-table" aria-label="Most-linked pages">
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
                  <span className="bar-cell">
                    <span className="cell-url">{item.url}</span>
                    <svg
                      className="bar-svg"
                      aria-hidden="true"
                      viewBox="0 0 100 6"
                      preserveAspectRatio="none"
                      width="100%"
                      height="0.375rem"
                    >
                      <defs>
                        <linearGradient
                          id={`bar-gradient-${encodeURIComponent(item.url)}`}
                          x1="0"
                          x2="1"
                          y1="0"
                          y2="0"
                        >
                          <stop
                            offset="0%"
                            stopColor="var(--color-brand-400)"
                          />
                          <stop
                            offset="100%"
                            stopColor="var(--color-brand-700)"
                          />
                        </linearGradient>
                      </defs>
                      <rect
                        x={0}
                        y={0}
                        width={100}
                        height={6}
                        fill="var(--color-line-soft)"
                      />
                      <rect
                        x={0}
                        y={0}
                        width={widthPercent}
                        height={6}
                        fill={`url(#bar-gradient-${encodeURIComponent(item.url)})`}
                      />
                    </svg>
                  </span>
                </td>
                <td className="cell-figure">{item.inbound}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
