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
    <div data-testid={`headings-${level}`}>
      <h3>{level.toUpperCase()}</h3>
      {headings.length === 0 ? (
        <p>No {level.toUpperCase()} headings found.</p>
      ) : (
        <ul>
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
    <section aria-label="Headings and links">
      <HeadingLevelList level="h1" headings={h1} />
      <HeadingLevelList level="h2" headings={h2} />
      <HeadingLevelList level="h3" headings={h3} />
      <dl>
        <dt>Internal links</dt>
        <dd data-testid="headings-internal-links">{internalLinks}</dd>
        <dt>External links</dt>
        <dd data-testid="headings-external-links">{externalLinks}</dd>
      </dl>
    </section>
  );
}
