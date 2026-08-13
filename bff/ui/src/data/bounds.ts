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

import { LIMITS } from "../../../../src/config";

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
 * `check_links`' truncation signal, derived directly from
 * `LinkCheckResult.truncated`/`linksFound` rather than the `checked === limit`
 * inference `describeProbeSet` above uses. Fixes `broken-links-view`'s
 * amended "Bounded Probe Set Is Named, Not Implied Exhaustive" requirement's
 * latent defect: a page with exactly `maxLinkChecks` links and zero
 * truncation is indistinguishable from a truncated page by `checked` count
 * alone, so this derivation reads the server's own `truncated` boolean
 * instead — the same "derive from the actual result flags" pattern
 * `SiteCrawlContainer`'s `describeOutputBytes` bound already establishes for
 * its own per-page cap.
 */
export function describeLinkCheckProbeSet(result: {
  readonly checked: number;
  readonly linksFound: number;
  readonly truncated: boolean;
}): Cardinality {
  if (result.checked === 0) return { state: "none" };
  if (result.truncated) {
    return {
      state: "bounded",
      bound: {
        kind: "probe_cap",
        scope: "checked",
        limitName: "maxLinkChecks",
        limitValue: result.checked,
        shown: result.checked,
        total: result.linksFound,
      },
    };
  }
  return { state: "complete", total: result.checked };
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

function pushIfBounded(bounds: Bound[], cardinality: Cardinality): void {
  if (isBounded(cardinality)) bounds.push(cardinality.bound);
}

interface SiteCrawlBoundsInput {
  readonly outputBytes: number;
  readonly requested: number;
  readonly crawled: number;
  readonly failed: number;
  readonly crawlPolicy: {
    readonly sitemapsDeclared: readonly unknown[];
    readonly disallowedSkipped: {
      readonly count: number;
      readonly sample: readonly string[];
    };
  };
  readonly summary: {
    readonly missingH1: {
      readonly count: number;
      readonly sample: readonly string[];
    };
    readonly multipleH1: {
      readonly count: number;
      readonly sample: readonly string[];
    };
    readonly thinContent: {
      readonly count: number;
      readonly sample: readonly string[];
    };
    readonly nonIndexable: {
      readonly count: number;
      readonly sample: readonly string[];
    };
    readonly duplicateTitles: ReadonlyArray<{
      readonly count: number;
      readonly sample: readonly string[];
    }>;
    readonly duplicateDescriptions: ReadonlyArray<{
      readonly count: number;
      readonly sample: readonly string[];
    }>;
  };
  readonly linkGraph: {
    readonly orphanPages: {
      readonly count: number;
      readonly sample: readonly string[];
    };
    readonly topLinkedPages: readonly unknown[];
  };
}

/**
 * `result-export`'s "bounded/truncated results carry provenance" requirement
 * calls for exactly the same derivations the panels already render — see
 * `design.md`'s "Bound-Versus-Empty Mechanism": "export calls the SAME
 * `collectBounds` for provenance. There is no second badge implementation to
 * drift." One `Bound[]` per tool result, empty when nothing was capped.
 */
export function collectSiteCrawlBounds(result: SiteCrawlBoundsInput): Bound[] {
  const bounds: Bound[] = [];

  const outputBytesBound = describeOutputBytes(
    result,
    LIMITS.maxSiteOutputBytes,
  );
  if (outputBytesBound) bounds.push(outputBytesBound);

  pushIfBounded(
    bounds,
    describeCategory(
      result.summary.missingH1,
      "DomainCategory.sample",
      25,
      "summary.missingH1.sample",
    ),
  );
  pushIfBounded(
    bounds,
    describeCategory(
      result.summary.multipleH1,
      "DomainCategory.sample",
      25,
      "summary.multipleH1.sample",
    ),
  );
  pushIfBounded(
    bounds,
    describeCategory(
      result.summary.thinContent,
      "DomainCategory.sample",
      25,
      "summary.thinContent.sample",
    ),
  );
  pushIfBounded(
    bounds,
    describeCategory(
      result.summary.nonIndexable,
      "DomainCategory.sample",
      25,
      "summary.nonIndexable.sample",
    ),
  );
  pushIfBounded(
    bounds,
    describeCategory(
      result.crawlPolicy.disallowedSkipped,
      "CrawlPolicy.disallowedSkipped.sample",
      25,
      "crawlPolicy.disallowedSkipped.sample",
    ),
  );
  pushIfBounded(
    bounds,
    describeCategory(
      result.linkGraph.orphanPages,
      "LinkGraphSummary.orphanPages.sample",
      25,
      "linkGraph.orphanPages.sample",
    ),
  );

  result.summary.duplicateTitles.forEach((group, index) => {
    pushIfBounded(
      bounds,
      describeCategory(
        group,
        "DuplicateGroup.sample",
        10,
        `summary.duplicateTitles[${index}].sample`,
      ),
    );
  });
  result.summary.duplicateDescriptions.forEach((group, index) => {
    pushIfBounded(
      bounds,
      describeCategory(
        group,
        "DuplicateGroup.sample",
        10,
        `summary.duplicateDescriptions[${index}].sample`,
      ),
    );
  });

  pushIfBounded(
    bounds,
    describeCappedList(
      result.crawlPolicy.sitemapsDeclared,
      "sitemapsDeclared",
      20,
      "crawlPolicy.sitemapsDeclared",
    ),
  );
  pushIfBounded(
    bounds,
    describeCappedList(
      result.summary.duplicateTitles,
      "duplicateTitles",
      20,
      "summary.duplicateTitles",
    ),
  );
  pushIfBounded(
    bounds,
    describeCappedList(
      result.summary.duplicateDescriptions,
      "duplicateDescriptions",
      20,
      "summary.duplicateDescriptions",
    ),
  );
  pushIfBounded(
    bounds,
    describeCappedList(
      result.linkGraph.topLinkedPages,
      "topLinkedPages",
      10,
      "linkGraph.topLinkedPages",
    ),
  );

  return bounds;
}

/** `check_links`' single probe-cap bound, wrapped for `collectBounds`. */
export function collectLinkCheckBounds(result: {
  readonly checked: number;
}): Bound[] {
  const cardinality = describeProbeSet(result.checked, LIMITS.maxLinkChecks);
  return isBounded(cardinality) ? [cardinality.bound] : [];
}

/**
 * `search_console_query`'s row-count bound — the only available signal for
 * this tool, per `search-console-view`'s design: `rowCount` is the length
 * of the already-truncated `rows` array, with no separate `truncated`/
 * `linksFound` pair the way `check_links` has. Mirrors `describeProbeSet`'s
 * exact `checked === limit` pattern, naming `maxGscRows` (250) instead of
 * `maxLinkChecks`.
 */
export function describeGscRows(rowCount: number, limit: number): Cardinality {
  if (rowCount === 0) return { state: "none" };
  if (rowCount === limit) {
    return {
      state: "bounded",
      bound: {
        kind: "probe_cap",
        scope: "rowCount",
        limitName: "maxGscRows",
        limitValue: limit,
        shown: rowCount,
      },
    };
  }
  return { state: "complete", total: rowCount };
}

/** `search_console_query`'s single row-count bound, wrapped for `collectBounds`. */
export function collectGscBounds(result: {
  readonly rowCount: number;
}): Bound[] {
  const cardinality = describeGscRows(result.rowCount, LIMITS.maxGscRows);
  return isBounded(cardinality) ? [cardinality.bound] : [];
}

/**
 * `gsc-insight-views`' opportunity-tools bound (`find_striking_distance_keywords`,
 * `find_low_ctr_opportunities`) — task 6.3. Unlike `describeGscRows`, the
 * limit is NOT a fixed config constant: it is read from the tool's own
 * echoed `criteria.limit` (`OpportunityResult.criteria: Record<string,
 * number>`), since the effective limit may be the server's own default
 * when the caller omitted it (`gsc-insight-views` spec, "Applied Criteria
 * Are Shown Alongside Results"). `rowCount === criteria.limit` is the ONLY
 * available bound signal — there is no separate total-matching-count field,
 * and a second, undetectable truncation layer (the raw GSC pull capped at
 * `LIMITS.maxGscRows` before filtering) means this view MUST NEVER claim
 * exhaustiveness even when the row-count bound is not reached. `limitName`
 * intentionally reads "criteria.limit" rather than a config constant name —
 * the limit named here IS the value the view displays alongside it (see
 * `OpportunityCriteriaPanel`), so the two can never drift apart.
 */
export function describeOpportunityBound(result: {
  readonly rowCount: number;
  readonly criteria: Readonly<Record<string, number>>;
}): Cardinality {
  const limit = result.criteria.limit;
  if (result.rowCount === 0) return { state: "none" };
  if (typeof limit === "number" && result.rowCount === limit) {
    return {
      state: "bounded",
      bound: {
        kind: "sample_cap",
        scope: "rowCount",
        limitName: "criteria.limit",
        limitValue: limit,
        shown: result.rowCount,
      },
    };
  }
  // Never "complete" — see this function's doc comment: the raw
  // pre-filter GSC pull is capped independently of `criteria.limit` and
  // that truncation is undetectable from the response, so "below the
  // row-count bound" still MUST NOT be presented as exhaustive. Callers
  // pair this cardinality with an unconditional caveat rather than reading
  // `"complete"` as "no more opportunities exist".
  return { state: "unknown" };
}

/** `gsc-insight-views`' opportunity-tools bound, wrapped for `collectBounds`. */
export function collectOpportunityBounds(result: {
  readonly rowCount: number;
  readonly criteria: Readonly<Record<string, number>>;
}): Bound[] {
  const cardinality = describeOpportunityBound(result);
  return isBounded(cardinality) ? [cardinality.bound] : [];
}

export type DiffBucketName = "decayed" | "improved" | "lost" | "gained";

/**
 * `gsc-insight-views`' per-bucket comparison bound (task 6.6). Each of the
 * four `GscDiff` buckets is truncated to `LIMITS.maxDiffRows`
 * INDEPENDENTLY (`src/seo/gsc-diff.ts`), so a bucket reaching that cap is a
 * bound signal specific to THAT bucket alone — one bucket at the cap MUST
 * NOT imply any other bucket is also at (or near) its own cap. Callers
 * derive this once per bucket, never once for the whole `diff`.
 */
export function describeDiffBucket(
  bucket: readonly unknown[],
  limit: number,
  limitName: string = "maxDiffRows",
): Cardinality {
  if (bucket.length === 0) return { state: "none" };
  if (bucket.length === limit) {
    return {
      state: "bounded",
      bound: {
        kind: "sample_cap",
        scope: "diff",
        limitName,
        limitValue: limit,
        shown: bucket.length,
      },
    };
  }
  return { state: "complete", total: bucket.length };
}

/** All four `GscDiff` bucket bounds, wrapped for `collectBounds`, keyed by
 * bucket name so a caller never has to re-derive which bucket a `Bound`
 * belongs to. */
export function collectDiffBounds(diff: {
  readonly decayed: readonly unknown[];
  readonly improved: readonly unknown[];
  readonly lost: readonly unknown[];
  readonly gained: readonly unknown[];
}): Readonly<Record<DiffBucketName, Cardinality>> {
  return {
    decayed: describeDiffBucket(diff.decayed, LIMITS.maxDiffRows),
    improved: describeDiffBucket(diff.improved, LIMITS.maxDiffRows),
    lost: describeDiffBucket(diff.lost, LIMITS.maxDiffRows),
    gained: describeDiffBucket(diff.gained, LIMITS.maxDiffRows),
  };
}

export type CrawlDiffBucketName =
  "newPages" | "removedPages" | "newIssues" | "resolvedIssues";

/**
 * `history-comparison-view`'s (PR11) per-bucket `CrawlDiff` bound (task
 * 11.5) — the crawl family's four array buckets (`newPages`/`removedPages`/
 * `newIssues`/`resolvedIssues`) are truncated INDEPENDENTLY to
 * `LIMITS.maxCrawlDiffRows` (`src/seo/crawl-diff.ts#diffCrawls`), the exact
 * same "one bucket at the cap says nothing about any other bucket"
 * discipline `collectDiffBounds` already establishes for `GscDiff` — reuses
 * `describeDiffBucket` with `limitName: "maxCrawlDiffRows"` rather than a
 * parallel implementation, since the underlying cardinality rule (bucket
 * length vs. a fixed limit) is identical for both families; only the limit
 * NAME differs. `issueCountDeltas` (a `Record<string, number>`, not an
 * array) carries no bound of its own — the delta map's size is never
 * server-truncated.
 */
export function collectCrawlDiffBounds(diff: {
  readonly newPages: readonly unknown[];
  readonly removedPages: readonly unknown[];
  readonly newIssues: readonly unknown[];
  readonly resolvedIssues: readonly unknown[];
}): Readonly<Record<CrawlDiffBucketName, Cardinality>> {
  const limit = LIMITS.maxCrawlDiffRows;
  return {
    newPages: describeDiffBucket(diff.newPages, limit, "maxCrawlDiffRows"),
    removedPages: describeDiffBucket(
      diff.removedPages,
      limit,
      "maxCrawlDiffRows",
    ),
    newIssues: describeDiffBucket(diff.newIssues, limit, "maxCrawlDiffRows"),
    resolvedIssues: describeDiffBucket(
      diff.resolvedIssues,
      limit,
      "maxCrawlDiffRows",
    ),
  };
}

/**
 * Single entry point `export/json.ts` and `export/csv.ts` both call for
 * provenance — `crawl_page` and `analyze_pagespeed` results carry no known
 * bound (single-page/single-analysis results, no sample-capped fields), so
 * they always return `[]`.
 */
/**
 * `seo-intelligence-view`'s (PR10) generic count-bound derivation, task
 * 10.2. Unlike `describeGscRows` (a fixed config constant) and unlike
 * `describeOpportunityBound` (the TOOL's own echoed `criteria.limit`), the
 * limit here is the BFF's own resolved `effectiveCriteria` — critically,
 * this makes a correct bound label possible even for a request that
 * OMITTED the limit entirely and relied on the tool's default (threat row
 * h): the tool itself reports no limit at all, so only the BFF (which
 * resolved the effective value) can know it. Never "complete" below the
 * limit, for the same reason `describeOpportunityBound` never is: every one
 * of these five tools synthesizes over a hardcoded, unrecorded 250-row raw
 * GSC pull (`GSC_PULL_CAVEAT`, `authenticated/criteria.ts`) that this
 * count-bound cannot see through.
 */
export function describeSeoIntelligenceBound(
  count: number,
  effectiveLimit: number,
  limitName: string,
): Cardinality {
  if (count === 0) return { state: "none" };
  if (count === effectiveLimit) {
    return {
      state: "bounded",
      bound: {
        kind: "sample_cap",
        scope: "count",
        limitName,
        limitValue: effectiveLimit,
        shown: count,
      },
    };
  }
  return { state: "unknown" };
}

/**
 * `seo-intelligence-view`'s `CannibalGroup.pages` bound (task 10.6): each
 * group's own `pageCount` is the TRUE count of cannibalizing pages, while
 * `pages` is independently capped (`MAX_PAGES_PER_GROUP`, 10,
 * `src/seo/intelligence.ts`) — `pages.length < pageCount` means the
 * rendered subset is NOT the complete list for that group, the same
 * "explicit count vs. capped sample" shape `describeCategory` already
 * establishes for `site-crawl-view`'s duplicate groups.
 */
export function describeCannibalGroupPagesBound(
  group: { readonly pageCount: number; readonly pages: readonly unknown[] },
  scope: string,
): Cardinality {
  if (group.pages.length === 0) return { state: "none" };
  if (group.pages.length < group.pageCount) {
    return {
      state: "bounded",
      bound: {
        kind: "sample_cap",
        scope,
        limitName: "CannibalGroup.pages",
        limitValue: group.pages.length,
        shown: group.pages.length,
        total: group.pageCount,
      },
    };
  }
  return { state: "complete", total: group.pageCount };
}

export function collectBounds(
  tool:
    | "crawl_page"
    | "crawl_site"
    | "check_links"
    | "analyze_pagespeed"
    | "search_console_query",
  result: unknown,
): Bound[] {
  if (tool === "crawl_site") {
    return collectSiteCrawlBounds(result as SiteCrawlBoundsInput);
  }
  if (tool === "check_links") {
    return collectLinkCheckBounds(result as { readonly checked: number });
  }
  if (tool === "search_console_query") {
    return collectGscBounds(result as { readonly rowCount: number });
  }
  return [];
}
