import type { Cardinality } from "../data/bounds";

/**
 * The one shared rendering for "this field is a sample, not the complete
 * list" (`design.md`'s shared-primitives list: `SampleBadge` + `SampleList`,
 * consumed by every field the "Bound-Versus-Empty Distinction Across All
 * Panels" requirement names). Renders nothing for `"none"`/`"complete"`/
 * `"unknown"` — only the `"bounded"` branch is ever a sample label, so a
 * complete result can never be mislabeled as bounded by this component.
 * When `bound.total` is present (a `sample_cap`, e.g. a `DuplicateGroup`'s
 * own truncated sample) it names `shown` of `total`; when absent (a
 * `group_cap` list with no reported total, e.g. `topLinkedPages`) it names
 * only `shown` and the limit, never a fabricated total.
 */
export interface SampleBadgeProps {
  readonly cardinality: Cardinality;
}

export function SampleBadge({ cardinality }: SampleBadgeProps) {
  if (cardinality.state !== "bounded") return null;

  const { bound } = cardinality;

  return (
    <span data-testid="sample-badge">
      Sample of {bound.shown}
      {bound.total !== undefined ? ` of ${bound.total}` : ""} (max{" "}
      {bound.limitValue} — {bound.limitName})
    </span>
  );
}
