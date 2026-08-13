/**
 * `authenticated-source-contract`'s SECOND staleness axis, separated by
 * type from `FreshnessBadge`'s `resultAge` (`design.md`, "Decision: two
 * staleness axes are separated by type, not by discipline"). `FreshnessBadge`
 * answers "how long ago did the BFF fetch this"; this component answers
 * "how far behind is Google's own reporting", a calendar fact independent
 * of when the BFF happened to call upstream. Rendered as a distinct
 * element with its own `data-testid`, never merged into the same string as
 * `FreshnessBadge`'s figure, so the two axes cannot be conflated by a
 * screen-reader user or a test asserting on either in isolation.
 *
 * `describeSourceFreshness` is exported separately so `export/csv.ts` can
 * reuse the exact same wording for its as-of provenance comment line
 * instead of re-deriving it — the same "one derivation, no drift"
 * discipline `data/bounds.ts` already establishes for bound badges.
 */
import type { SourceFreshness } from "../../../src/authenticated/freshness";

export interface SourceFreshnessBadgeProps {
  readonly freshness: SourceFreshness;
}

function basisLabel(basis: SourceFreshness["basis"]): "reported" | "estimated" {
  return basis === "reported" ? "reported" : "estimated";
}

export function describeSourceFreshness(freshness: SourceFreshness): string {
  const dayWord = freshness.lagDays === 1 ? "day" : "days";
  return `Google's data is as of ${freshness.asOf} (${freshness.lagDays} ${dayWord} behind, ${basisLabel(freshness.basis)})`;
}

export function SourceFreshnessBadge({ freshness }: SourceFreshnessBadgeProps) {
  return (
    <span
      className="source-freshness-badge"
      data-testid="source-freshness-badge"
    >
      {describeSourceFreshness(freshness)}
    </span>
  );
}
