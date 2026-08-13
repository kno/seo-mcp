import { Absent } from "../atoms/Absent";

/**
 * `pagespeed-view`'s "Optional Field Data (INP) Presentation" requirement.
 * `fieldMetrics` is absent entirely when the URL has insufficient real-user
 * traffic for the Chrome UX Report to report field data at all — that case
 * MUST render an explicit "no field data available" state, distinct from a
 * present-but-partial object (e.g. `overallCategory` reported without an INP
 * value yet, which renders through `Absent` for just that one field).
 */
export interface FieldMetrics {
  readonly overallCategory?: string;
  readonly interactionToNextPaintMs?: number;
}

export interface FieldDataPanelProps {
  readonly fieldMetrics?: FieldMetrics;
}

export function FieldDataPanel({ fieldMetrics }: FieldDataPanelProps) {
  if (!fieldMetrics) {
    return (
      <section className="panel" aria-label="Field data">
        <h3>Field data</h3>
        <p className="empty-state" data-testid="field-data-unavailable">
          No field data available for this URL.
        </p>
      </section>
    );
  }

  return (
    <section className="panel" aria-label="Field data">
      <h3>Field data</h3>
      <dl>
        <dt>Overall category</dt>
        <dd>
          {fieldMetrics.overallCategory ?? <Absent label="overall category" />}
        </dd>
        <dt>Interaction to Next Paint</dt>
        <dd>
          {fieldMetrics.interactionToNextPaintMs === undefined ? (
            <Absent label="interaction to next paint" />
          ) : (
            `${fieldMetrics.interactionToNextPaintMs} ms`
          )}
        </dd>
      </dl>
    </section>
  );
}
