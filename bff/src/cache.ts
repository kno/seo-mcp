/**
 * KV-backed result cache for `bff/src/router.ts`.
 *
 * Cache key: `v1:{tool}:{sha256(canonicalJson(inputs))}` — `canonicalJson`
 * key-sorts objects recursively so `{a:1,b:2}` and `{b:2,a:1}` hash
 * identically regardless of property insertion order at the call site.
 *
 * `analyze_pagespeed` requests carrying an explicit `apiKey` are never
 * cached (see `isCacheable`): that field is a secret input, not merely an
 * unusual one, and a secret MUST NOT derive or be present under a KV key.
 *
 * TTL is per-tool (`CACHE_TTL_SECONDS`) and always clamped to
 * `[MIN_TTL_SECONDS, MAX_TTL_SECONDS]` = `[60, 86400]` seconds (KV's own
 * minimum TTL is 60s). Design left concrete per-tool TTL values as an open
 * decision; the defaults below are a reasonable starting point balancing
 * upstream cost against result freshness — see the apply-progress note for
 * the rationale, adjust freely without touching the clamp invariant.
 *
 * Every KV operation is wrapped so a missing/throwing binding degrades to
 * a cache miss (`"unavailable"`) rather than failing the request — see
 * `getCached`/`putCached`.
 */

import type { ToolName } from "./timeout";

export const MIN_TTL_SECONDS = 60;
export const MAX_TTL_SECONDS = 86400;

/**
 * Per-tool default TTL, in seconds, before clamping. Chosen to balance
 * result freshness against upstream call cost:
 * - `health`: 60s (the clamp minimum) — a liveness signal should stay
 *   close to real-time.
 * - `crawl_page` / `crawl_site`: 3600s (1h) — page/site content changes
 *   infrequently enough that an hour-old crawl is still useful.
 * - `check_links`: 1800s (30m) — link rot is checked more eagerly than
 *   full content since it is comparatively cheap to notice.
 * - `analyze_pagespeed`: 21600s (6h) — PageSpeed Insights is an expensive
 *   external API call and its score does not meaningfully change within
 *   a few hours; requests carrying an explicit `apiKey` bypass caching
 *   entirely regardless of this value (see `isCacheable`).
 * - `search_console_query`, `find_striking_distance_keywords`,
 *   `find_low_ctr_opportunities`, `snapshot_search_console`,
 *   `list_search_console_snapshots`, `compare_search_console`,
 *   `get_keyword_metrics`, `discover_keywords`: 21600s (6h) here ONLY to
 *   satisfy this `Record<ToolName, number>`'s exhaustiveness — `ToolName`
 *   (`timeout.ts`) includes every authenticated tool too, but
 *   `dispatchAuthenticated()` (`router.ts`) never reads this value for any
 *   of them. Their real TTL comes from the `authenticated-delayed` cache
 *   class below (`authenticatedTtlSeconds`), selected per-source and
 *   per-range-state rather than per-tool.
 * - `cluster_keywords`: 3600s (1h) — this IS its real TTL. It is NOT
 *   authenticated (no Google call, no credential) and goes through the
 *   ordinary `dispatch()` path, which reads this table directly. Pure text
 *   analysis over a fixed keyword list is deterministic, so a refetch is
 *   always byte-identical — 1h balances that against not pinning a stale
 *   result indefinitely.
 * - `snapshot_crawl` / `list_crawl_snapshots` / `compare_crawls`
 *   (`history-comparison-view`, PR11): 3600s (1h) — these ARE their real
 *   TTLs, same reasoning as `crawl_page`/`crawl_site` above (not
 *   `cluster_keywords`'s determinism argument): none of the three is
 *   authenticated (see `authenticated/registry.ts`'s doc comment — no
 *   Google credential, no Google quota, and crawl data has no calendar
 *   reporting-lag concept to derive a `sourceFreshness` from), so all three
 *   go through the ordinary `dispatch()` path, which reads this table
 *   directly. `snapshot_crawl` caching an identical repeat request (same
 *   `url`/`limit`/`concurrency`/`label`) rather than re-crawling mirrors
 *   `snapshot_search_console`'s own established precedent of caching a
 *   write action, avoiding a duplicate real crawl on a double-submit.
 * - `delete_search_console_snapshot` / `delete_crawl_snapshot`: 60s (the
 *   clamp minimum) here ONLY to satisfy this `Record<ToolName, number>`'s
 *   exhaustiveness — `isCacheable` below always returns `false` for both,
 *   the SAME "never cache a mutation" treatment `analyze_pagespeed`'s
 *   secret-`apiKey` case gets, so `dispatch()` never reads this value for
 *   either tool. Unlike `snapshot_crawl`/`snapshot_search_console`
 *   (write actions that are still safe/idempotent-ish to cache — a
 *   double-submit just re-returns the same capture), caching a DELETE
 *   response would let a later identical-looking request (same
 *   `snapshotId`) silently replay a stale `{deleted: true}` for an id that
 *   has since been reused or was never re-checked against D1 — deletion is
 *   irreversible and must always hit the store fresh.
 *
 * ---
 *
 * ## The `authenticated-delayed` cache class (design.md, "Decision: a
 * caching class for upstream-delayed data, distinct from the crawl class")
 *
 * Authenticated/analytical sources (currently just `search-console`) get a
 * SEPARATE, source-keyed-and-range-state-keyed TTL mechanism, because a
 * refetch of a closed Google Search Console date range is usually
 * byte-identical — re-fetching it spends both the MCP bucket and Google's
 * own quota for an answer that cannot have changed. `AUTH_SOURCE_TTL_SECONDS`
 * lives in `bff/wrangler.jsonc`'s `vars` (a per-deployment tuning knob,
 * unlike the crawl tools' hardcoded `CACHE_TTL_SECONDS` above) with two
 * numbers per source:
 *
 * - `closed` — the requested `endDate` is older than the reporting-lag
 *   window (`GSC_REPORTING_LAG_DAYS`, `authenticated/freshness.ts`), i.e.
 *   the data has definitely landed. Long TTL, near this module's clamp
 *   ceiling.
 * - `open` — `endDate` is still inside the lag window, i.e. Google's data
 *   for that range may still be landing. Short TTL.
 *
 * A ZERO-ROW result is always cached at the `open` TTL regardless of its
 * actual range-state (`authenticatedTtlSeconds`'s `resultIsEmpty`
 * parameter): a zero-row result for a still-landing range usually means
 * "not reported yet", not "no data", so caching it at the long `closed`
 * TTL would risk pinning a wrong "empty" answer for hours.
 *
 * Refresh stays `?refresh=1`-only — `shouldBypassCacheRead` already covers
 * this route identically to every other one. There is no timer, interval,
 * or focus/visibility-triggered revalidation anywhere in this module or
 * its callers (`dashboard-shell`'s "no polling" rule, server-side half —
 * see `bff/test/cache.test.ts`'s structural scan).
 */
export const CACHE_TTL_SECONDS: Record<ToolName, number> = {
  health: 60,
  crawl_page: 3600,
  crawl_site: 3600,
  check_links: 1800,
  analyze_pagespeed: 21600,
  search_console_query: 21600,
  find_striking_distance_keywords: 21600,
  find_low_ctr_opportunities: 21600,
  snapshot_search_console: 21600,
  list_search_console_snapshots: 21600,
  compare_search_console: 21600,
  get_keyword_metrics: 21600,
  discover_keywords: 21600,
  cluster_keywords: 3600,
  // `seo-intelligence-view` (PR10): all five authenticated, routed through
  // `dispatchAuthenticated()`, which never reads this table for any of
  // them — present only for this `Record<ToolName, number>`'s
  // exhaustiveness, same as every other authenticated tool above.
  find_seo_opportunities: 21600,
  find_keyword_cannibalization: 21600,
  map_keywords_to_pages: 21600,
  find_content_gaps: 21600,
  analyze_domain: 21600,
  // `history-comparison-view` (PR11): all three NOT authenticated, routed
  // through the ordinary `dispatch()` path, which reads this table
  // directly — this IS their real TTL, same reasoning as `crawl_page`/
  // `crawl_site` above.
  snapshot_crawl: 3600,
  list_crawl_snapshots: 3600,
  compare_crawls: 3600,
  // Never actually read — see `isCacheable`, which always returns `false`
  // for both. Present only for this `Record<ToolName, number>`'s
  // exhaustiveness.
  delete_search_console_snapshot: MIN_TTL_SECONDS,
  delete_crawl_snapshot: MIN_TTL_SECONDS,
  // Domain-management follow-up: `isCacheable` always returns `false` for
  // all three, so `dispatch()` never reads these — present only for this
  // `Record<ToolName, number>`'s exhaustiveness, same as the delete-snapshot
  // tools above.
  list_sites: MIN_TTL_SECONDS,
  add_site: MIN_TTL_SECONDS,
  delete_site: MIN_TTL_SECONDS,
};

export function clampTtlSeconds(seconds: number): number {
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, seconds));
}

export type AuthRangeState = "closed" | "open";

/**
 * `closed` when `endDate` predates the reporting-lag boundary (the data has
 * definitely landed); `open` when `endDate` falls on or inside it (Google's
 * data for that range may still be arriving). String comparison is safe and
 * exact here because both operands are `YYYY-MM-DD` (fixed-width,
 * zero-padded ISO date-only strings) — lexicographic order matches calendar
 * order. This intentionally mirrors `authenticated/freshness.ts#deriveSourceFreshness`'s
 * own `endDate < lagBoundary` boundary check (same `<`, same meaning) so a
 * response's `sourceFreshness` and its cache range-state never disagree
 * about which side of the lag window `endDate` falls on. Kept self-contained
 * (no import from `authenticated/freshness.ts`) rather than coupled to it —
 * `cache.ts` has no dependency on the `authenticated/` module tree elsewhere.
 */
export function authRangeState(
  endDate: string,
  lagDays: number,
  today: Date = new Date(),
): AuthRangeState {
  const boundary = new Date(today.getTime());
  boundary.setUTCDate(boundary.getUTCDate() - lagDays);
  const lagBoundary = boundary.toISOString().slice(0, 10);
  return endDate < lagBoundary ? "closed" : "open";
}

export type AuthSourceTtlTable = Record<string, AuthSourceTtl>;
export interface AuthSourceTtl {
  closed: number;
  open: number;
}

/**
 * Resolves the `authenticated-delayed` TTL for `source`, given its
 * `rangeState` and whether the fetched result was zero-row
 * (`resultIsEmpty`) — a zero-row result is always treated as `open`
 * regardless of the requested range's own state (see this module's doc
 * comment). Always passes through `clampTtlSeconds` so a misconfigured
 * `AUTH_SOURCE_TTL_SECONDS` value can never escape the same `[60, 86400]`
 * clamp every other cached entry in this module respects.
 */
export function authenticatedTtlSeconds(
  ttlTable: AuthSourceTtlTable,
  source: string,
  rangeState: AuthRangeState,
  resultIsEmpty: boolean,
): number {
  const effectiveState: AuthRangeState = resultIsEmpty ? "open" : rangeState;
  const entry = ttlTable[source];
  return clampTtlSeconds(entry[effectiveState]);
}

/**
 * Stable, key-sorted JSON serialization. Plain `JSON.stringify` preserves
 * insertion order, which is NOT guaranteed to match across different call
 * sites producing logically-equal objects — this function guarantees the
 * same hash for the same logical value regardless of key order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function cacheKey(
  tool: ToolName,
  inputs: unknown,
): Promise<string> {
  return `v1:${tool}:${await sha256Hex(canonicalJson(inputs))}`;
}

/**
 * `analyze_pagespeed` with an explicit `apiKey` is never cached. Neither is
 * `delete_search_console_snapshot`/`delete_crawl_snapshot` — EVER,
 * regardless of input — deletion is irreversible, so a stale cached
 * `{deleted: ...}` response for a since-changed `snapshotId` must never be
 * served (see `CACHE_TTL_SECONDS`'s doc comment for the full reasoning).
 *
 * `list_search_console_snapshots`/`list_crawl_snapshots` are ALSO never
 * cached, for a related reason found during manual verification of the
 * delete tools: a delete mutates D1 directly, but the corresponding list
 * route's cache key is derived from `{siteUrl/url, limit}` — a delete has
 * no way to know every `limit` value a caller may have cached a list
 * under, so precise invalidation isn't reliably achievable, and a stale
 * list would keep showing an already-deleted snapshot until its TTL
 * (6h for GSC, 1h for crawl) elapsed. These are cheap, local D1 reads with
 * no external API cost or rate-limit pressure to protect, so removing the
 * cache entirely (rather than building a fragile per-limit invalidation
 * mechanism) is the simpler and more correct fix. Every other route's
 * inputs are cache-key-safe per design.
 *
 * `list_sites`/`add_site`/`delete_site` (domain-management follow-up) get
 * the same treatment: `list_sites` is a cheap D1 read with no external
 * cost, and caching it would let a stale list mask an `add_site`/
 * `delete_site` mutation exactly like `list_crawl_snapshots` above; both
 * mutations are excluded for the same "never cache a mutation" reason
 * `delete_search_console_snapshot`/`delete_crawl_snapshot` already get.
 */
export function isCacheable(
  tool: ToolName,
  inputs: Record<string, unknown>,
): boolean {
  if (
    tool === "delete_search_console_snapshot" ||
    tool === "delete_crawl_snapshot" ||
    tool === "list_search_console_snapshots" ||
    tool === "list_crawl_snapshots" ||
    tool === "list_sites" ||
    tool === "add_site" ||
    tool === "delete_site"
  ) {
    return false;
  }
  if (tool !== "analyze_pagespeed") return true;
  const apiKey = inputs.apiKey;
  return !(typeof apiKey === "string" && apiKey.length > 0);
}

/**
 * `?refresh=1` or a `Cache-Control: no-cache` request header forces a
 * fresh upstream call — the cache read is skipped, but a fresh write
 * still happens afterward so subsequent requests benefit.
 */
export function shouldBypassCacheRead(request: Request, url: URL): boolean {
  if (url.searchParams.get("refresh") === "1") return true;
  const cacheControl = request.headers.get("cache-control");
  return (
    cacheControl !== null && cacheControl.toLowerCase().includes("no-cache")
  );
}

interface CacheEntry<T> {
  storedAt: number;
  expiresAt: number;
  tool: string;
  result: T;
}

export type CacheGetOutcome<T> =
  | { status: "hit"; data: T; resultAge: number }
  | { status: "miss" }
  | { status: "unavailable" };

/**
 * Reads `key` from `kv`. Any of the following is treated as a cache miss
 * and MUST NOT fail the caller's request: no binding, a throwing `get`, a
 * malformed stored value, or an entry whose own `expiresAt` has elapsed
 * (belt-and-braces alongside KV's own `expirationTtl`, and what makes
 * expiry deterministically testable against a fake KV that does not
 * enforce TTL itself).
 */
export async function getCached<T>(
  kv: KVNamespace | undefined,
  key: string,
): Promise<CacheGetOutcome<T>> {
  if (!kv) return { status: "unavailable" };
  try {
    const raw = await kv.get(key);
    if (raw === null) return { status: "miss" };
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (Date.now() >= entry.expiresAt) return { status: "miss" };
    const resultAge = Math.max(
      0,
      Math.floor((Date.now() - entry.storedAt) / 1000),
    );
    return { status: "hit", data: entry.result, resultAge };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * Writes `data` to `kv` under `key` with a clamped TTL. Any throw from the
 * binding is swallowed: a cache write failure MUST NOT fail the request
 * that already has its (fresh) result in hand.
 */
export async function putCached<T>(
  kv: KVNamespace | undefined,
  key: string,
  tool: string,
  data: T,
  ttlSeconds: number,
): Promise<void> {
  if (!kv) return;
  const clamped = clampTtlSeconds(ttlSeconds);
  const now = Date.now();
  const entry: CacheEntry<T> = {
    storedAt: now,
    expiresAt: now + clamped * 1000,
    tool,
    result: data,
  };
  try {
    await kv.put(key, JSON.stringify(entry), { expirationTtl: clamped });
  } catch {
    // KV write failures must never fail the request — swallow.
  }
}
