/**
 * `quota-visibility`'s "Shared bucket headroom is surfaced as an estimate"
 * requirement. Renders the REAL `GET /api/usage` response shape
 * (`bff/src/usage.ts`'s `UsageSnapshot`: `{ callCount, windowSeconds,
 * windowElapsedSeconds, estimate: true, note }`), not the placeholder shape
 * `design.md` sketched before this route existed — matching the backend's
 * own type-level guarantee (`estimate: true` is a literal type, not a
 * boolean) means this component structurally cannot render the figure as
 * an authoritative remaining count: there is no "remaining" field to
 * render in the first place, only an observed `callCount`. The visible
 * label always includes the word "estimate", and the BFF's own `note`
 * (never a UI-authored explanation, so upstream changes to the estimate's
 * scope/caveats automatically propagate) is rendered as the discoverable
 * explanation the spec requires.
 */
import type { UsageSnapshot } from "../../../src/usage";

export interface HeadroomIndicatorProps {
  readonly snapshot: UsageSnapshot;
}

export function HeadroomIndicator({ snapshot }: HeadroomIndicatorProps) {
  return (
    <div data-testid="headroom-indicator">
      <p>
        <strong>{snapshot.callCount} calls</strong> observed in the last{" "}
        {snapshot.windowElapsedSeconds}s of a {snapshot.windowSeconds}s window
        (estimate)
      </p>
      <details>
        <summary>Why is this only an estimate?</summary>
        <p>{snapshot.note}</p>
      </details>
    </div>
  );
}
