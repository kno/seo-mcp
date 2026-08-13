/**
 * Open Graph panel (`page-report-view`'s "Open Graph and JSON-LD Panels
 * Show Presence, Types, and Invalid Blocks" requirement, OG half). An empty
 * `openGraph` map renders an explicit "no Open Graph metadata" state,
 * distinct from a blank panel that could be mistaken for a loading state.
 */
export interface OpenGraphPanelProps {
  readonly openGraph: Readonly<Record<string, string>>;
}

export function OpenGraphPanel({ openGraph }: OpenGraphPanelProps) {
  const entries = Object.entries(openGraph);

  if (entries.length === 0) {
    return (
      <section className="panel" aria-label="Open Graph metadata">
        <h3>Open Graph</h3>
        <p className="empty-state">No Open Graph metadata present.</p>
      </section>
    );
  }

  return (
    <section className="panel" aria-label="Open Graph metadata">
      <h3>Open Graph</h3>
      <dl>
        {entries.map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
