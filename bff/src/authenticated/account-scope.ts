/**
 * Resolves the credential-scope `accountKey` an authenticated route's
 * `siteUrl` argument belongs to, so `cache.ts#cacheKey()` and
 * `quota-ledger.ts` can partition per Google account rather than per
 * deployment (design.md, "Decision: the BFF cache key and quota ledger are
 * credential-scoped via a KV site→account map" — the second cross-account
 * leak the design identified: `get_keyword_metrics` for `["seo tools"]`
 * under account A and the identical call under account B were previously
 * ONE cache entry).
 *
 * `ak1:{siteUrl}` in `RESULT_CACHE` (TTL 300s) maps a site to the exact
 * `credential` object `list_sites` already computes per site
 * (`credentialStatusForSite`, `src/google/health.ts`) — reusing that value
 * rather than re-deriving anything. On a miss, one inline `list_sites` call
 * (a cheap local D1 read, no Google quota — `cache.ts#isCacheable`) refreshes
 * the map for every listed site at once. The SAME refresh is reused to
 * INVALIDATE a just-connected/disconnected site's entry: `disconnect_google_
 * account`'s own result carries no `siteUrl` to key a single delete on
 * (`disconnectGoogleAccountResultSchema`), so `router.ts`'s disconnect route
 * calls `refreshSiteAccountMap` again after a successful disconnect, which
 * overwrites every site's entry — including the just-disconnected one — with
 * the current truth, rather than requiring an echoed `siteUrl`. `connect_
 * google_account`'s result DOES carry `siteUrl` (`connectGoogleAccountResultSchema`),
 * so `oauth/callback.ts` uses a direct, cheaper `deleteSiteAccountEntry` for
 * that path instead, matching design.md's mermaid diagram exactly.
 *
 * Every KV operation here is wrapped exactly like `cache.ts#getCached`/
 * `putCached`: a missing or throwing `RESULT_CACHE` binding, or a `list_sites`
 * call that itself fails, degrades to `resolveAccountForRoute`'s fixed
 * `"global"` fallback rather than failing the caller's request (threat
 * matrix row k) — the caller already has (or is about to fetch) a live
 * result and MUST still receive it.
 */
import { callTool } from "../mcp-client";
import type { BffErrorCode } from "../errors";
import { listSitesResultSchema } from "../../../src/schemas/sites";
import type { ToolName } from "../timeout";

export interface SiteAccountEntry {
  tier: "site" | "global" | "none";
  accountKey: string;
  accountLabel: string | null;
  searchConsoleHealth:
    "not_connected" | "unchecked" | "stale" | "healthy" | "unhealthy";
}

export interface AccountResolution {
  accountKey: string;
  source: "site" | "global";
  accountLabel: string | null;
  searchConsoleHealth: SiteAccountEntry["searchConsoleHealth"];
}

/** Fallback used whenever the account-key map cannot be resolved (KV
 * absent/throwing, or the refreshing `list_sites` call itself fails) — the
 * SAME "fail open, never closed" degradation `cache.ts#getCached` and
 * `quota-ledger.ts#getQuotaEstimate` already apply to their own KV reads.
 * `searchConsoleHealth: "unchecked"` never trips the 5.6 gate below, so an
 * unresolvable map never itself blocks a request that would otherwise
 * succeed. */
const FALLBACK_RESOLUTION: AccountResolution = {
  accountKey: "global",
  source: "global",
  accountLabel: null,
  searchConsoleHealth: "unchecked",
};

function accountMapKey(siteUrl: string): string {
  return `ak1:${siteUrl}`;
}

async function getSiteAccountEntry(
  kv: KVNamespace | undefined,
  siteUrl: string,
): Promise<SiteAccountEntry | undefined> {
  if (!kv) return undefined;
  try {
    const raw = await kv.get(accountMapKey(siteUrl));
    if (raw === null) return undefined;
    return JSON.parse(raw) as SiteAccountEntry;
  } catch {
    return undefined;
  }
}

async function putSiteAccountEntry(
  kv: KVNamespace | undefined,
  siteUrl: string,
  entry: SiteAccountEntry,
): Promise<void> {
  if (!kv) return;
  try {
    await kv.put(accountMapKey(siteUrl), JSON.stringify(entry), {
      expirationTtl: 300,
    });
  } catch {
    // KV write failures must never fail the request — swallow, mirrors
    // cache.ts#putCached.
  }
}

/** Deletes `siteUrl`'s entry — used by the connect round-trip, which has a
 * real `siteUrl` to key on (see this module's doc comment). */
export async function deleteSiteAccountEntry(
  kv: KVNamespace | undefined,
  siteUrl: string,
): Promise<void> {
  if (!kv) return;
  try {
    await kv.delete(accountMapKey(siteUrl));
  } catch {
    // Mirrors putSiteAccountEntry — never fails the caller.
  }
}

export interface AccountScopeDependencies {
  seoMcp: Fetcher;
  mcpOrigin: string;
  token: string;
  validateUpstreamResults?: boolean;
}

/**
 * Calls `list_sites` and writes a fresh `ak1:{url}` entry for every
 * returned site, unconditionally overwriting any stale entry. This is both
 * how the map self-populates on a cold lookup and how a connect/disconnect
 * mutation invalidates its own site's entry when the mutation's own result
 * carries no `siteUrl` to key a single delete on (see this module's doc
 * comment). Returns `undefined` — never throws — when the `list_sites` call
 * itself fails, so a caller resolving a single site's entry can fall back
 * to `FALLBACK_RESOLUTION` exactly like a KV failure.
 */
export async function refreshSiteAccountMap(
  kv: KVNamespace | undefined,
  deps: AccountScopeDependencies,
): Promise<Map<string, SiteAccountEntry> | undefined> {
  const result = await callTool(
    "list_sites" as ToolName,
    {},
    listSitesResultSchema,
    {
      seoMcp: deps.seoMcp,
      mcpOrigin: deps.mcpOrigin,
      token: deps.token,
      timeoutMs: 10_000,
      validateUpstreamResults: deps.validateUpstreamResults,
    },
  );
  if (!result.ok) return undefined;

  const map = new Map<string, SiteAccountEntry>();
  for (const site of result.data.sites) {
    const entry: SiteAccountEntry = {
      tier: site.credential.tier,
      accountKey: site.credential.accountKey ?? "global",
      accountLabel: site.credential.accountLabel,
      searchConsoleHealth: site.credential.health.searchConsole.state,
    };
    map.set(site.url, entry);
    await putSiteAccountEntry(kv, site.url, entry);
  }
  return map;
}

/**
 * Resolves `siteUrl`'s `AccountResolution` for cache-key/ledger scoping and
 * the envelope's `credential` field: a KV hit on `ak1:{siteUrl}` first, then
 * one inline `refreshSiteAccountMap` refresh on a miss. `kv` absent short-
 * circuits to `FALLBACK_RESOLUTION` with no network call at all — there is
 * nothing to cache into and no accountKey to distinguish, so the "fail
 * open" default is used directly (threat matrix row k).
 */
export async function resolveAccountForRoute(
  kv: KVNamespace | undefined,
  siteUrl: string | undefined,
  deps: AccountScopeDependencies,
): Promise<AccountResolution> {
  if (siteUrl === undefined) return FALLBACK_RESOLUTION;
  if (!kv) return FALLBACK_RESOLUTION;

  const cached = await getSiteAccountEntry(kv, siteUrl);
  const entry = cached ?? (await refreshSiteAccountMap(kv, deps))?.get(siteUrl);
  if (!entry) {
    // `siteUrl` was not among `list_sites`' returned rows (or the refresh
    // itself failed) — cache the fallback shape too, under this exact
    // `siteUrl`, so a repeated call for the same unresolvable site does not
    // re-issue a `list_sites` call on every single request for the
    // remainder of the map's 300s TTL.
    await putSiteAccountEntry(kv, siteUrl, {
      tier: "global",
      accountKey: "global",
      accountLabel: null,
      searchConsoleHealth: "unchecked",
    });
    return FALLBACK_RESOLUTION;
  }

  return {
    accountKey: entry.accountKey,
    source: entry.tier === "none" ? "global" : entry.tier,
    accountLabel: entry.accountLabel,
    searchConsoleHealth: entry.searchConsoleHealth,
  };
}

/**
 * Task 5.6's pre-call gate: a site-scoped call whose resolved tier has no
 * usable credential at all (`tier: "none"`, presented as `searchConsole:
 * "not_connected"`) is rejected with `site_credential_not_connected`; a
 * site-scoped call targeting a site whose Search Console health is
 * `"unhealthy"` is rejected with `site_credential_unhealthy` — Ads health
 * does NOT gate, only Search Console does (Phase 3's `ensureSelectableHealth`
 * gating decision, `src/google/health.ts`). Returns `undefined` — never
 * blocks — for a global-fallback or FALLBACK_RESOLUTION resolution, since
 * neither represents a definitively unusable site credential.
 */
export function gateSiteCredential(
  resolution: AccountResolution,
): BffErrorCode | undefined {
  if (resolution.searchConsoleHealth === "not_connected") {
    return "site_credential_not_connected";
  }
  if (resolution.searchConsoleHealth === "unhealthy") {
    return "site_credential_unhealthy";
  }
  return undefined;
}
