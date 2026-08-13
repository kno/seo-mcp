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
 * - `search_console_query`: 21600s (6h), a TEMPORARY placeholder at the
 *   crawl-tool clamp's upper range. `authenticated-source-contract`'s real
 *   `authenticated-delayed` cache class (per-source TTL split by
 *   closed/open range-state, per design.md) lands in PR3
 *   (`bff/src/authenticated/quota-ledger.ts`); this value is superseded
 *   there, not a considered final answer.
 */
export const CACHE_TTL_SECONDS: Record<ToolName, number> = {
  health: 60,
  crawl_page: 3600,
  crawl_site: 3600,
  check_links: 1800,
  analyze_pagespeed: 21600,
  search_console_query: 21600,
};

export function clampTtlSeconds(seconds: number): number {
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, seconds));
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
