/**
 * Credential health: probes, the lazy-cached state machine, and the
 * read-only summary consumed by `list_sites`. Persisted `state` is exactly
 * `healthy | unhealthy` (`site-credential-store.ts`'s `CredentialHealthState`);
 * every other presented state (`not_connected`/`unchecked`/`stale`) is
 * derived at read time and never written to D1 — see design.md's "two
 * persisted health states, five presented states, `checking` never
 * persisted".
 *
 * A probe runs at exactly three points: connect (`runConnectHealthCheck`),
 * a selection attempt against a stale/absent/tier-mismatched cached result
 * (`ensureSelectableHealth`), and manual recheck (`checkSearchConsoleHealth`/
 * `checkGoogleAdsHealth` with `forceRecheck: true`). These are deliberately
 * separate functions callers must invoke explicitly — `resolveSiteCredentials`
 * itself never probes, because every real Search Console/Ads/Business call
 * goes through it and a probe on every real call would violate "the health
 * check runs at exactly three points, and nowhere else". A real call's own
 * outcome is recorded instead via `recordAuthenticatedCallSuccess`/
 * `recordAuthenticatedCallFailure`, which is stronger evidence than a probe
 * and never triggers one.
 */
import { LIMITS } from "../config";
import type { Env } from "../config";
import { getGoogleAccessToken, GoogleAuthError } from "./auth";
import { resolveSiteCredentials } from "./credentials";
import { SearchConsoleHttpError } from "./search-console";
import type {
  GoogleOAuthCredentials,
  ResolvedCredential,
} from "./credential-types";
import {
  getSiteCredentialHealth,
  upsertSiteCredentialHealth,
  type CredentialHealthSource,
  type SiteCredentialHealthInput,
  type SiteCredentialHealthRecord,
} from "../db/site-credential-store";

export const CREDENTIAL_HEALTH_TTL_SECONDS = 21_600;
export const CREDENTIAL_HEALTH_PROBE_FAILED_TTL_SECONDS = 60;

export type HealthReason =
  | "credential_rejected"
  | "property_not_accessible"
  | "property_unverified"
  | "probe_failed"
  | "ads_no_accessible_customer"
  | "ads_customer_ambiguous";

export interface ProbeOutcome {
  state: "healthy" | "unhealthy";
  reason?: HealthReason;
  detail?: string | null;
  ttlSeconds: number;
}

function healthyOutcome(): ProbeOutcome {
  return { state: "healthy", ttlSeconds: CREDENTIAL_HEALTH_TTL_SECONDS };
}

function unhealthyOutcome(
  reason: HealthReason,
  detail?: string | null,
  ttlSeconds: number = CREDENTIAL_HEALTH_TTL_SECONDS,
): ProbeOutcome {
  return { state: "unhealthy", reason, detail: detail ?? null, ttlSeconds };
}

function probeFailedOutcome(): ProbeOutcome {
  return unhealthyOutcome(
    "probe_failed",
    null,
    CREDENTIAL_HEALTH_PROBE_FAILED_TTL_SECONDS,
  );
}

/**
 * Cheapest property-scoped call that proves real Search Console access.
 * `permissionLevel: "siteUnverifiedUser"` means "listed but no data" — a
 * fact a bare `sites.list` cannot distinguish and `searchAnalytics.query`
 * only reveals as an (indistinguishable) empty result.
 */
export async function probeSearchConsole(
  credentials: GoogleOAuthCredentials,
  siteUrl: string,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<ProbeOutcome> {
  let token: string;
  try {
    token = await getGoogleAccessToken(credentials, fetcher, now);
  } catch {
    return unhealthyOutcome("credential_rejected");
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    LIMITS.credentialHealthProbeTimeoutMs,
  );
  try {
    const response = await fetcher(
      `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
        siteUrl,
      )}`,
      {
        headers: { authorization: `Bearer ${token}` },
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return unhealthyOutcome(
          "credential_rejected",
          `HTTP ${response.status}`,
        );
      }
      return unhealthyOutcome(
        "property_not_accessible",
        `HTTP ${response.status}`,
      );
    }
    const data = (await response.json()) as { permissionLevel?: string };
    if (data.permissionLevel === "siteUnverifiedUser") {
      return unhealthyOutcome("property_unverified", data.permissionLevel);
    }
    return healthyOutcome();
  } catch {
    return probeFailedOutcome();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Needs no customer ID (so it works before one is known), proves the
 * developer token + refresh token combination works, and resolves
 * `ads_customer_id` as a side effect.
 */
export async function probeGoogleAds(
  credentials: GoogleOAuthCredentials,
  developerToken: string,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<ProbeOutcome & { adsCustomerId?: string | null }> {
  let token: string;
  try {
    token = await getGoogleAccessToken(credentials, fetcher, now);
  } catch {
    return unhealthyOutcome("credential_rejected");
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    LIMITS.credentialHealthProbeTimeoutMs,
  );
  try {
    const response = await fetcher(
      "https://googleads.googleapis.com/v23/customers:listAccessibleCustomers",
      {
        headers: {
          authorization: `Bearer ${token}`,
          "developer-token": developerToken,
        },
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      return unhealthyOutcome("credential_rejected", `HTTP ${response.status}`);
    }
    const data = (await response.json()) as { resourceNames?: string[] };
    const names = data.resourceNames ?? [];
    if (names.length === 0) {
      return unhealthyOutcome("ads_no_accessible_customer");
    }
    if (names.length > 1) {
      return {
        ...unhealthyOutcome(
          "ads_customer_ambiguous",
          `${names.length} accessible customers`,
        ),
        adsCustomerId: null,
      };
    }
    return {
      ...healthyOutcome(),
      adsCustomerId: names[0].replace(/^customers\//, ""),
    };
  } catch {
    return probeFailedOutcome();
  } finally {
    clearTimeout(timeout);
  }
}

export interface CheckOptions {
  forceRecheck?: boolean;
}

function isFresh(
  record: SiteCredentialHealthRecord | null,
  accountKey: string,
  nowMs: number,
): boolean {
  if (!record) return false;
  if (record.accountKey !== accountKey) return false;
  return new Date(record.expiresAt).getTime() > nowMs;
}

async function persistOutcome(
  db: D1Database,
  siteId: number,
  source: CredentialHealthSource,
  resolved: ResolvedCredential,
  outcome: ProbeOutcome,
  now: () => number,
): Promise<SiteCredentialHealthRecord> {
  const nowMs = now();
  const checkedAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + outcome.ttlSeconds * 1000).toISOString();
  const input: SiteCredentialHealthInput = {
    siteId,
    source,
    credentialSource: resolved.source,
    accountKey: resolved.accountKey,
    state: outcome.state,
    reason: outcome.reason ?? null,
    detail: outcome.detail ?? null,
    checkedAt,
    expiresAt,
  };
  await upsertSiteCredentialHealth(db, input);
  return {
    ...input,
    reason: input.reason ?? null,
    detail: input.detail ?? null,
  };
}

/**
 * Selection-time / manual-recheck entry point for Search Console. Reuses a
 * fresh, tier-matched cached result with no probe; `forceRecheck: true`
 * (manual recheck) bypasses the freshness window unconditionally.
 */
export async function checkSearchConsoleHealth(
  db: D1Database,
  site: { id: number; url: string },
  resolved: ResolvedCredential,
  options: CheckOptions = {},
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<SiteCredentialHealthRecord> {
  if (!options.forceRecheck) {
    const existing = await getSiteCredentialHealth(
      db,
      site.id,
      "search-console",
    );
    if (isFresh(existing, resolved.accountKey, now())) return existing!;
  }
  const outcome = await probeSearchConsole(
    resolved.credentials,
    site.url,
    fetcher,
    now,
  );
  return persistOutcome(db, site.id, "search-console", resolved, outcome, now);
}

export async function checkGoogleAdsHealth(
  db: D1Database,
  site: { id: number },
  resolved: ResolvedCredential,
  developerToken: string,
  options: CheckOptions = {},
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<SiteCredentialHealthRecord> {
  if (!options.forceRecheck) {
    const existing = await getSiteCredentialHealth(db, site.id, "google-ads");
    if (isFresh(existing, resolved.accountKey, now())) return existing!;
  }
  const outcome = await probeGoogleAds(
    resolved.credentials,
    developerToken,
    fetcher,
    now,
  );
  return persistOutcome(db, site.id, "google-ads", resolved, outcome, now);
}

/**
 * Connect-time check: synchronous, always fresh (a connect that reports
 * success without proving access is a lie), runs before the caller reports
 * the site connected.
 */
export async function runConnectHealthCheck(
  db: D1Database,
  site: { id: number; url: string },
  resolved: ResolvedCredential,
  developerToken: string | undefined,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<{
  searchConsole: SiteCredentialHealthRecord;
  googleAds: SiteCredentialHealthRecord | null;
}> {
  const searchConsole = await checkSearchConsoleHealth(
    db,
    site,
    resolved,
    { forceRecheck: true },
    fetcher,
    now,
  );
  const googleAds = developerToken
    ? await checkGoogleAdsHealth(
        db,
        site,
        resolved,
        developerToken,
        { forceRecheck: true },
        fetcher,
        now,
      )
    : null;
  return { searchConsole, googleAds };
}

/**
 * Selection-attempt entry point. Selectability is gated on the Search
 * Console probe only (design's dedicated decision) — Ads health is stored
 * and displayed but never blocks selection.
 */
export async function ensureSelectableHealth(
  db: D1Database,
  site: { id: number; url: string },
  resolved: ResolvedCredential,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<SiteCredentialHealthRecord> {
  return checkSearchConsoleHealth(db, site, resolved, {}, fetcher, now);
}

/**
 * A successful real data call is stronger evidence than a probe: it
 * extends the cached result to healthy without spending a probe call.
 */
export async function recordAuthenticatedCallSuccess(
  db: D1Database,
  siteId: number,
  source: CredentialHealthSource,
  resolved: ResolvedCredential,
  now: () => number = Date.now,
): Promise<void> {
  await persistOutcome(db, siteId, source, resolved, healthyOutcome(), now);
}

/**
 * A real call classifying to `upstream_credential_failure` directly
 * downgrades health without running a probe — a failed real call is
 * stronger evidence than a probe.
 */
export async function recordAuthenticatedCallFailure(
  db: D1Database,
  siteId: number,
  source: CredentialHealthSource,
  resolved: ResolvedCredential,
  reason: HealthReason = "credential_rejected",
  detail: string | null = null,
  now: () => number = Date.now,
): Promise<void> {
  await persistOutcome(
    db,
    siteId,
    source,
    resolved,
    unhealthyOutcome(reason, detail),
    now,
  );
}

/**
 * True only for a failure that is itself evidence the credential is bad
 * (a rejected refresh token, or Search Console returning 401/403) — never
 * for a network timeout or a malformed-query 400, which say nothing about
 * credential validity.
 */
export function isCredentialRejectedError(error: unknown): boolean {
  if (error instanceof GoogleAuthError) return true;
  if (error instanceof SearchConsoleHttpError) {
    return error.status === 401 || error.status === 403;
  }
  return false;
}

/**
 * Wraps a real Search Console/Ads call so its own outcome updates credential
 * health, per this file's header comment — purely additive: the wrapped
 * call's result/error is always returned/re-thrown unchanged, and a
 * health-recording write is never allowed to fail the call itself.
 * `site` is `null` when there is no site to attribute the outcome to (no D1,
 * or the resolution fell through to the global tier).
 */
export async function withCallHealthTracking<T>(
  db: D1Database | undefined,
  site: { id: number } | null,
  source: CredentialHealthSource,
  resolved: ResolvedCredential,
  fn: () => Promise<T>,
  now: () => number = Date.now,
): Promise<T> {
  try {
    const result = await fn();
    if (db && site) {
      try {
        await recordAuthenticatedCallSuccess(
          db,
          site.id,
          source,
          resolved,
          now,
        );
      } catch {
        // A health-tracking hiccup must never turn a successful call into a failure.
      }
    }
    return result;
  } catch (error) {
    if (db && site && isCredentialRejectedError(error)) {
      try {
        await recordAuthenticatedCallFailure(
          db,
          site.id,
          source,
          resolved,
          "credential_rejected",
          error instanceof Error ? error.message : null,
          now,
        );
      } catch {
        // A health-tracking hiccup must never mask the original error.
      }
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Read-only summary for `list_sites` — cached rows only, zero Google calls.
// ---------------------------------------------------------------------------

export type PresentedHealthState =
  "not_connected" | "unchecked" | "stale" | "healthy" | "unhealthy";

export interface PresentedHealth {
  state: PresentedHealthState;
  reason?: string | null;
  checkedAt?: string | null;
}

export interface CredentialStatus {
  tier: "site" | "global" | "none";
  accountLabel: string | null;
  accountKey: string | null;
  health: {
    searchConsole: PresentedHealth;
    googleAds: PresentedHealth;
  };
}

function derivePresentedHealth(
  record: SiteCredentialHealthRecord | null,
  accountKey: string,
  nowMs: number,
): PresentedHealth {
  if (!record || record.accountKey !== accountKey) {
    return { state: "unchecked" };
  }
  if (new Date(record.expiresAt).getTime() <= nowMs) {
    return {
      state: "stale",
      reason: record.reason,
      checkedAt: record.checkedAt,
    };
  }
  if (record.state === "healthy") {
    return { state: "healthy", checkedAt: record.checkedAt };
  }
  return {
    state: "unhealthy",
    reason: record.reason,
    checkedAt: record.checkedAt,
  };
}

/**
 * Reads only cached rows (a local decrypt for tier resolution, plus two D1
 * health-row reads) — no Google call is ever made while serving a list.
 */
export async function credentialStatusForSite(
  env: Env,
  site: { id: number; url: string },
  now: () => number = Date.now,
): Promise<CredentialStatus> {
  let resolved: ResolvedCredential | null = null;
  try {
    resolved = await resolveSiteCredentials(env, site.url);
  } catch {
    resolved = null;
  }

  if (!resolved) {
    return {
      tier: "none",
      accountLabel: null,
      accountKey: null,
      health: {
        searchConsole: { state: "not_connected" },
        googleAds: { state: "not_connected" },
      },
    };
  }

  if (!env.DB) {
    return {
      tier: resolved.source,
      accountLabel: resolved.accountLabel,
      accountKey: resolved.accountKey,
      health: {
        searchConsole: { state: "unchecked" },
        googleAds: { state: "unchecked" },
      },
    };
  }

  const nowMs = now();
  const [scRecord, adsRecord] = await Promise.all([
    getSiteCredentialHealth(env.DB, site.id, "search-console"),
    getSiteCredentialHealth(env.DB, site.id, "google-ads"),
  ]);

  return {
    tier: resolved.source,
    accountLabel: resolved.accountLabel,
    accountKey: resolved.accountKey,
    health: {
      searchConsole: derivePresentedHealth(
        scRecord,
        resolved.accountKey,
        nowMs,
      ),
      googleAds: derivePresentedHealth(adsRecord, resolved.accountKey, nowMs),
    },
  };
}
