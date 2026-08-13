/**
 * `quota-visibility`'s "Result age is surfaced for every cached result"
 * requirement. Receives `{ cacheStatus, resultAge, receivedAtMs }` per
 * `design.md`'s "Quota and Freshness" decision and computes the displayed
 * age ON RENDER ONLY — no ticking timer, so it never registers a repeating
 * interval (the `no-polling.test.ts` structural invariant this component
 * must never violate). A fresh (`"miss"`/`"bypass"`) result
 * always shows a low/zero age; a `"hit"` result's age grows across
 * unrelated re-renders because it is recomputed from `receivedAtMs` each
 * time, never frozen at the moment it first rendered.
 */
import type { BffOk } from "../../../src/errors";

export interface FreshnessBadgeProps {
  readonly cacheStatus: BffOk<unknown>["cacheStatus"];
  /** Seconds, as reported by the BFF at the time the result was received. */
  readonly resultAge: number;
  /** `Date.now()` at the moment this envelope was received by the container. */
  readonly receivedAtMs: number;
  /** Injectable clock for deterministic tests; defaults to `Date.now`. */
  readonly now?: () => number;
}

export function FreshnessBadge({
  cacheStatus,
  resultAge,
  receivedAtMs,
  now = Date.now,
}: FreshnessBadgeProps) {
  const elapsedSinceReceipt = Math.max(
    0,
    Math.floor((now() - receivedAtMs) / 1000),
  );
  const ageSeconds = resultAge + elapsedSinceReceipt;

  if (cacheStatus === "hit") {
    return (
      <span className="freshness-badge" data-testid="freshness-badge">
        Cached result — {ageSeconds}s old
      </span>
    );
  }

  return (
    <span className="freshness-badge" data-testid="freshness-badge">
      Fresh result{ageSeconds > 0 ? ` — ${ageSeconds}s old` : ""}
    </span>
  );
}
