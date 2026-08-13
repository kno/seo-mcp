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

/**
 * `site-crawl-view`'s generic `{ count, sample }` category derivation —
 * shared by `DomainSummary`'s `missingH1`/`multipleH1`/`thinContent`/
 * `nonIndexable`, each `DuplicateGroup`'s own `sample` (`count` there is the
 * number of affected pages, `sample` a capped subset), `CrawlPolicy`'s
 * `disallowedSkipped`, and `LinkGraphSummary`'s `orphanPages`. Every one of
 * these shapes reports an explicit `count` even when `sample` is capped
 * below it, so — unlike `describeCappedList` below — the total is always
 * known here: `sample.length < count` means the server truncated the
 * sample, `sample.length === count` means the sample IS the complete list.
 */
export function describeCategory(
  category: { readonly count: number; readonly sample: readonly string[] },
  limitName: string,
  limitValue: number,
  scope: string,
): Cardinality {
  if (category.count === 0) return { state: "none" };
  if (category.sample.length < category.count) {
    return {
      state: "bounded",
      bound: {
        kind: "sample_cap",
        scope,
        limitName,
        limitValue,
        shown: category.sample.length,
        total: category.count,
      },
    };
  }
  return { state: "complete", total: category.count };
}

/**
 * `site-crawl-view`'s derivation for a capped LIST with no explicit total —
 * `crawlPolicy.sitemapsDeclared` (cap 20), the `duplicateTitles`/
 * `duplicateDescriptions` group lists (cap 20 groups), and
 * `linkGraph.topLinkedPages` (cap 10) are all returned as a bare array with
 * no sibling `count` field (`design.md`'s bounds table: "no total is
 * returned" for `topLinkedPages`). The only observable signal is whether
 * the returned length equals the known server-side cap: at the cap, more
 * items may exist beyond what was returned (`"bounded"`, `total` omitted
 * per the `Bound` type's own contract for this exact case); below the cap,
 * the list is provably complete.
 */
export function describeCappedList(
  items: readonly unknown[],
  limitName: string,
  limitValue: number,
  scope: string,
): Cardinality {
  if (items.length === 0) return { state: "none" };
  if (items.length === limitValue) {
    return {
      state: "bounded",
      bound: {
        kind: "group_cap",
        scope,
        limitName,
        limitValue,
        shown: items.length,
      },
    };
  }
  return { state: "complete", total: items.length };
}

/**
 * `site-crawl-view`'s "Output-byte truncation is surfaced independently of
 * any single panel's sample labels" scenario. Returns a `Bound` (not a
 * `Cardinality` — this is a crawl-result-level fact, not one field's
 * cardinality) only when BOTH conditions from the scenario hold: the result
 * is at or near `maxSiteOutputBytes` (defined here as >= 95% of the cap —
 * documented choice, since the spec says "at or near" without a number) AND
 * fewer pages were actually processed than requested. Either condition
 * alone is not evidence of truncation: a small site can legitimately finish
 * with room to spare, and a site can fail some pages for reasons unrelated
 * to the output-size cap.
 */
export function describeOutputBytes(
  result: {
    readonly outputBytes: number;
    readonly requested: number;
    readonly crawled: number;
    readonly failed: number;
  },
  maxSiteOutputBytes: number,
): Bound | null {
  const nearCap = result.outputBytes >= maxSiteOutputBytes * 0.95;
  const processed = result.crawled + result.failed;
  const wasTruncated = processed < result.requested;
  if (!nearCap || !wasTruncated) return null;

  return {
    kind: "output_bytes",
    scope: "outputBytes",
    limitName: "maxSiteOutputBytes",
    limitValue: maxSiteOutputBytes,
    shown: processed,
    total: result.requested,
  };
}
