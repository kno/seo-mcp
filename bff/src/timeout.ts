/**
 * Per-tool timeout budgets and the `AbortSignal.timeout` race wrapper
 * `bff/src/mcp-client.ts` uses on every service-binding fetch.
 *
 * Values come from `design.md`'s timeout table: `health` 5s, `crawl_page`
 * 15s, `analyze_pagespeed` 30s, `crawl_site` 55s, `check_links` 55s (the
 * 55s ceiling for the last two is CPU-bound, not wall-clock-bound — see
 * design's rationale). Hardcoded here rather than sourced from a
 * `wrangler.jsonc` var: these are fixed design decisions, not a
 * per-deployment tuning knob, and a flat numeric record is simpler to keep
 * correct than a JSON-encoded Cloudflare `vars` entry.
 *
 * `search_console_query` (authenticated-source-contract, PR2) gets 27s —
 * above `src/config.ts`'s `gscTimeoutMs` (15s) + `googleTokenTimeoutMs`
 * (10s) with a margin, per design.md's timeout table.
 *
 * The five `gsc-insight-views` tools (PR6) split into two latency profiles:
 * - `find_striking_distance_keywords` / `find_low_ctr_opportunities` /
 *   `snapshot_search_console` each make ONE live Search Console call with
 *   the same `gscTimeoutMs` (15s) + `googleTokenTimeoutMs` (10s) budget as
 *   `search_console_query`, so they get the same 27s margin.
 *   `snapshot_search_console` additionally writes the result to D1
 *   (`storeGscSnapshot`) after the GSC call returns, so it gets a slightly
 *   larger 28s budget to leave room for that write.
 * - `list_search_console_snapshots` / `compare_search_console` make NO
 *   Google call at all — they only read (and, for `compare_search_console`,
 *   diff) rows already stored in D1 by an earlier `snapshot_search_console`
 *   call. A D1 read is far cheaper than a live Search Console round-trip, so
 *   10s is a generous budget rather than a margin over any Google timeout —
 *   there is no Google timeout in their path to add a margin to.
 * (Note: these entries are only reached by `bff/src/cache.ts`'s
 * `Record<ToolName, number>` exhaustiveness — `dispatchAuthenticated()`
 * (`router.ts`) reads `timeoutMs` from `authenticated/registry.ts`'s own
 * per-route field instead, the same pattern `search_console_query` already
 * established.)
 *
 * `keyword-research-view` (PR8) adds three tools:
 * - `get_keyword_metrics` / `discover_keywords`: authenticated, routed
 *   through `dispatchAuthenticated()`, so — like the six tools above them —
 *   `authenticated/registry.ts`'s own `timeoutMs` (32s) is what actually
 *   governs; these entries exist only for this `Record`'s exhaustiveness.
 * - `cluster_keywords`: NOT authenticated (no Google call, no credential),
 *   routed through the ordinary `dispatch()` path — this IS its real
 *   timeout budget. 10s is generous for pure in-memory text analysis over
 *   at most 500 keywords; there is no network call in its path to bound
 *   against.
 *
 * `seo-intelligence-view` (PR10) adds five more tools, all authenticated
 * and routed through `dispatchAuthenticated()` — like every other
 * authenticated tool, `authenticated/registry.ts`'s own per-route
 * `timeoutMs` is what actually governs; these entries exist only for this
 * `Record`'s exhaustiveness:
 * - `find_seo_opportunities` / `find_keyword_cannibalization` /
 *   `map_keywords_to_pages` / `find_content_gaps`: each makes ONE live
 *   Search Console call with the same `gscTimeoutMs` (15s) +
 *   `googleTokenTimeoutMs` (10s) budget as `search_console_query`, so they
 *   get the same 27s margin.
 * - `analyze_domain`: composes a FULL site crawl (`crawlSite`, up to
 *   `LIMITS.maxCrawlPages` 20 pages at `LIMITS.maxConcurrency` 4 —
 *   worst-case ~40s of page fetches at `fetchTimeoutMs` 8s each, plus
 *   sitemap/robots discovery) AND an optional GSC enrichment call (the
 *   same 15s + 10s budget as the other four). 90s leaves generous margin
 *   over that combined worst case (`src/seo/domain-report.ts#analyzeDomain`
 *   awaits `crawlSite` then, only if `gscProperty`+dates are given,
 *   `findSeoOpportunities` — never in parallel, so the two budgets add).
 *
 * `history-comparison-view` (PR11) adds three more tools, ALL routed
 * through the ordinary, NON-authenticated `dispatch()` path (see
 * `authenticated/registry.ts`'s doc comment) — unlike every PR10 entry
 * above, these ARE each tool's real timeout budget, not an exhaustiveness
 * placeholder:
 * - `snapshot_crawl`: composes a real `crawlSite` call internally
 *   (`src/server.ts`), the SAME worst-case ~40s of page fetches
 *   `crawl_site`'s own 55s budget already covers, plus a D1 write. 56s
 *   leaves the same kind of small write-margin `snapshot_search_console`
 *   (28s over `search_console_query`'s 27s) leaves over its own live-call
 *   sibling.
 * - `list_crawl_snapshots` / `compare_crawls`: D1-only reads (the latter
 *   also diffs), no crawl and no Google call in their own path — 10s is
 *   generous, mirroring `list_search_console_snapshots`/
 *   `compare_search_console`'s identical reasoning.
 *
 * Manual-snapshot-deletion follow-up adds two more tools, both routed
 * through the ordinary, NON-authenticated `dispatch()` path (no Google
 * credential, no Google quota — a pure D1 mutation, exactly like
 * `snapshot_crawl`'s own reasoning above) but reached via a dedicated POST
 * route in `router.ts` rather than the usual GET + query-string transport
 * (see that route's own doc comment for why): `delete_search_console_snapshot`
 * / `delete_crawl_snapshot`. 10s is generous for a single-row D1 DELETE,
 * mirroring `list_search_console_snapshots`/`list_crawl_snapshots`'s own
 * D1-only reasoning.
 */

export type ToolName =
  | "health"
  | "crawl_page"
  | "crawl_site"
  | "check_links"
  | "analyze_pagespeed"
  | "search_console_query"
  | "find_striking_distance_keywords"
  | "find_low_ctr_opportunities"
  | "snapshot_search_console"
  | "list_search_console_snapshots"
  | "compare_search_console"
  | "get_keyword_metrics"
  | "discover_keywords"
  | "cluster_keywords"
  | "find_seo_opportunities"
  | "find_keyword_cannibalization"
  | "map_keywords_to_pages"
  | "find_content_gaps"
  | "analyze_domain"
  | "snapshot_crawl"
  | "list_crawl_snapshots"
  | "compare_crawls"
  | "delete_search_console_snapshot"
  | "delete_crawl_snapshot"
  | "list_sites"
  | "add_site"
  | "delete_site";

export const TOOL_TIMEOUT_MS: Record<ToolName, number> = {
  health: 5000,
  crawl_page: 15000,
  analyze_pagespeed: 30000,
  crawl_site: 55000,
  check_links: 55000,
  search_console_query: 27_000,
  find_striking_distance_keywords: 27_000,
  find_low_ctr_opportunities: 27_000,
  snapshot_search_console: 28_000,
  list_search_console_snapshots: 10_000,
  compare_search_console: 10_000,
  get_keyword_metrics: 32_000,
  discover_keywords: 32_000,
  cluster_keywords: 10_000,
  find_seo_opportunities: 27_000,
  find_keyword_cannibalization: 27_000,
  map_keywords_to_pages: 27_000,
  find_content_gaps: 27_000,
  analyze_domain: 90_000,
  snapshot_crawl: 56_000,
  list_crawl_snapshots: 10_000,
  compare_crawls: 10_000,
  delete_search_console_snapshot: 10_000,
  delete_crawl_snapshot: 10_000,
  // Domain-management follow-up: pure D1 reads/writes over the tiny `sites`
  // table, no Google call and no crawl in their path — 10s is generous,
  // mirroring `list_crawl_snapshots`/`delete_crawl_snapshot`'s identical
  // reasoning.
  list_sites: 10_000,
  add_site: 10_000,
  delete_site: 10_000,
};

export type TimeoutResult<T> =
  { ok: true; data: T } | { ok: false; timedOut: true };

/**
 * `AbortSignal.timeout()` sets its abort reason to a `TimeoutError`
 * DOMException per the WHATWG spec; some fetch implementations instead
 * surface the rejection as a plain `AbortError`. Both names are treated as
 * a timeout here so this stays correct across runtimes.
 */
function isTimeoutSignal(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

/**
 * Runs `run` with an `AbortSignal.timeout(timeoutMs)` signal. `run` MUST
 * pass the signal through to whatever async operation it performs (e.g.
 * `fetch(request, { signal })`) so the timeout can actually abort it.
 * An abort from that signal maps to `{ ok: false, timedOut: true }`;
 * any other rejection propagates unchanged.
 */
export async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<TimeoutResult<T>> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const data = await run(signal);
    return { ok: true, data };
  } catch (error) {
    if (isTimeoutSignal(error)) return { ok: false, timedOut: true };
    throw error;
  }
}
