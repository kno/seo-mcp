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
  | "cluster_keywords";

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
