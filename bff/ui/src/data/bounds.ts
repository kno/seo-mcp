/**
 * Shared cardinality/bound vocabulary. One type, reused across every view's
 * "how much of the result am I looking at" question, plus `result-export`'s
 * provenance block. Phase 2 (dashboard-views) only establishes the types
 * and the `isBounded` guard the shell's `StateRegion` needs to render the
 * three loading/empty/bound-reached states distinctly; the per-tool
 * derivations (`describeCategory`, `describeDuplicateGroups`,
 * `collectBounds`, etc.) land with the views that have data to derive from
 * (Phase 3 onward), per `design.md`'s "Bound-Versus-Empty Mechanism".
 */

export type BoundKind =
  "output_bytes" | "sample_cap" | "group_cap" | "probe_cap";

export interface Bound {
  readonly kind: BoundKind;
  /** e.g. "summary.duplicateTitles[0].sample" — where in the result this bound applies. */
  readonly scope: string;
  /** e.g. "DomainCategory.sample" — names the limit, not just its number. */
  readonly limitName: string;
  readonly limitValue: number;
  readonly shown: number;
  /** Omitted (not `undefined`-as-zero) when the server does not report a total. */
  readonly total?: number;
}

export type Cardinality =
  | { readonly state: "none" }
  | { readonly state: "complete"; readonly total: number }
  | { readonly state: "bounded"; readonly bound: Bound }
  | { readonly state: "unknown" };

/**
 * Type guard narrowing `Cardinality` to its `"bounded"` branch. This is the
 * one place `StateRegion` (and every future panel) asks "was this result
 * truncated by a server-side limit", so "bound reached" can never be
 * inferred from a raw count comparison at a call site.
 */
export function isBounded(
  cardinality: Cardinality,
): cardinality is { readonly state: "bounded"; readonly bound: Bound } {
  return cardinality.state === "bounded";
}

/**
 * `broken-links-view`'s "probe-cap-at-50" derivation — the first real
 * per-tool bound derivation to land, per `design.md`'s "Bound-Versus-Empty
 * Mechanism" (`LinkCheckResult.checked` capped at `maxLinkChecks`, 50,
 * `src/config.ts:24`). `checked === limit` yields `"bounded"` naming the
 * limit explicitly, so the probe set can never present as exhaustive by
 * omission; `checked === 0` yields `"none"`; anything below the limit is
 * `"complete"`, so "no bound indicator below the bound" holds by
 * construction rather than by a call-site comparison.
 */
export function describeProbeSet(checked: number, limit: number): Cardinality {
  if (checked === 0) return { state: "none" };
  if (checked === limit) {
    return {
      state: "bounded",
      bound: {
        kind: "probe_cap",
        scope: "checked",
        limitName: "maxLinkChecks",
        limitValue: limit,
        shown: checked,
      },
    };
  }
  return { state: "complete", total: checked };
}
