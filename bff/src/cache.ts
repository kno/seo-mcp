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
 *   `list_search_console_snapshots`, `compare_search_console`: 21600s (6h)
 *   here ONLY to satisfy this `Record<ToolName, number>`'s exhaustiveness —
 *   `ToolName` (`timeout.ts`) includes every authenticated tool too, but
 *   `dispatchAuthenticated()` (`router.ts`) never reads this value for any
 *   of them. Their real TTL comes from the `authenticated-delayed` cache
 *   class below (`authenticatedTtlSeconds`), selected per-source and
 *   per-range-state rather than per-tool.
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
 * `analyze_pagespeed` with an explicit `apiKey` is never cached. Every
 * other route's inputs are cache-key-safe per design.
 */
export function isCacheable(
  tool: ToolName,
  inputs: Record<string, unknown>,
): boolean {
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
