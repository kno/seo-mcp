/**
 * Heading structure and link-count panel (`page-report-view`'s "Headings and
 * Link Counts Are Shown Separately by Level and Direction" requirement).
 * `h1`/`h2`/`h3` render as three separate lists; `internalLinks` and
 * `externalLinks` render as two distinct figures, never merged into a
 * single total.
 */
export interface HeadingsPanelProps {
  readonly h1: readonly string[];
  readonly h2: readonly string[];
  readonly h3: readonly string[];
  readonly internalLinks: number;
  readonly externalLinks: number;
}

function HeadingLevelList({
  level,
  headings,
}: {
  readonly level: "h1" | "h2" | "h3";
  readonly headings: readonly string[];
}) {
  return (
    // `h4`, not `h3`: the enclosing panel now carries a visible `h3` title,
    // so these level groups sit one step below it and the document keeps a
    // strictly descending heading order (axe's heading-order rule).
    <div className="heading-group" data-testid={`headings-${level}`}>
      <h4>{level.toUpperCase()}</h4>
      {headings.length === 0 ? (
        <p className="empty-state">No {level.toUpperCase()} headings found.</p>
      ) : (
        <ul className="bullet-list">
          {headings.map((heading, index) => (
            <li key={`${level}-${index}`}>{heading}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function HeadingsPanel({
  h1,
  h2,
  h3,
  internalLinks,
  externalLinks,
}: HeadingsPanelProps) {
  return (
    <section className="panel" aria-label="Headings and links">
      <h3>Headings and links</h3>
      <dl className="stat-grid">
        <div className="stat">
          <dt>Internal links</dt>
          <dd data-testid="headings-internal-links">{internalLinks}</dd>
        </div>
        <div className="stat">
          <dt>External links</dt>
          <dd data-testid="headings-external-links">{externalLinks}</dd>
        </div>
      </dl>
      <div className="section-grid">
        <HeadingLevelList level="h1" headings={h1} />
        <HeadingLevelList level="h2" headings={h2} />
        <HeadingLevelList level="h3" headings={h3} />
      </div>
    </section>
  );
}
