/**
 * JSON-LD panel (`page-report-view`'s "Open Graph and JSON-LD Panels Show
 * Presence, Types, and Invalid Blocks" requirement, JSON-LD half). Zero
 * blocks renders an explicit "no JSON-LD present" state. `jsonLd.types` is
 * already the deduplicated set of types from VALID blocks only — the
 * analyzer (`src/seo/html.ts`'s `collectJsonLdTypes`) never lets an invalid
 * block contribute a type — so this panel renders `types` verbatim and
 * flags `invalid` as a separate, additional fact, never folding it into
 * (or subtracting it from) the type count.
 */
export interface JsonLdSummary {
  readonly blocks: number;
  readonly types: readonly string[];
  readonly invalid: number;
}

export interface JsonLdPanelProps {
  readonly jsonLd: JsonLdSummary;
}

export function JsonLdPanel({ jsonLd }: JsonLdPanelProps) {
  if (jsonLd.blocks === 0) {
    return (
      <section aria-label="JSON-LD">
        <p>No JSON-LD present.</p>
      </section>
    );
  }

  return (
    <section aria-label="JSON-LD">
      <p>{jsonLd.blocks} JSON-LD block(s) found.</p>
      {jsonLd.invalid > 0 && (
        <p data-testid="jsonld-invalid">
          {jsonLd.invalid} block(s) failed to parse and are excluded from the
          types below.
        </p>
      )}
      {jsonLd.types.length > 0 && (
        <ul aria-label="JSON-LD types">
          {jsonLd.types.map((type) => (
            <li key={type}>{type}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
