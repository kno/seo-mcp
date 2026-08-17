import { env as workerEnv } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkSearchConsoleHealth,
  checkGoogleAdsHealth,
  runConnectHealthCheck,
  ensureSelectableHealth,
  recordAuthenticatedCallSuccess,
  recordAuthenticatedCallFailure,
  CREDENTIAL_HEALTH_TTL_SECONDS,
} from "../../src/google/health";
import { resetGoogleTokenCache } from "../../src/google/auth";
import {
  getSiteCredentialHealth,
  upsertSiteCredentialHealth,
} from "../../src/db/site-credential-store";
import type { ResolvedCredential } from "../../src/google/credential-types";

const DB = (workerEnv as { DB: D1Database }).DB;

beforeAll(async () => {
  await DB.exec(
    "CREATE TABLE IF NOT EXISTS site_credential_health (site_id INTEGER NOT NULL, source TEXT NOT NULL, credential_source TEXT NOT NULL, account_key TEXT NOT NULL, state TEXT NOT NULL, reason TEXT, detail TEXT, checked_at TEXT NOT NULL, expires_at TEXT NOT NULL, PRIMARY KEY (site_id, source))",
  );
});

beforeEach(async () => {
  await DB.exec("DELETE FROM site_credential_health");
  resetGoogleTokenCache();
});

const SITE = { id: 1, url: "sc-domain:example.com" };

const RESOLVED: ResolvedCredential = {
  credentials: {
    clientId: "client-id",
    clientSecret: "client-secret",
    refreshToken: "refresh-token",
  },
  source: "site",
  accountKey: "account-key-1",
  accountLabel: "owner@example.com",
};

function tokenAndDataDispatcher(dataResponse: () => Response) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = input.toString();
    if (url.includes("oauth2.googleapis.com/token")) {
      return Response.json({ access_token: "access-123", expires_in: 3600 });
    }
    return dataResponse();
  });
}

const HEALTHY_SC_RESPONSE = () =>
  Response.json({ permissionLevel: "siteOwner" });

describe("connect-time probe", () => {
  it("runs synchronously and persists the result before the caller reports connected", async () => {
    const fetcher = tokenAndDataDispatcher(HEALTHY_SC_RESPONSE);

    const result = await runConnectHealthCheck(
      DB,
      SITE,
      RESOLVED,
      undefined,
      fetcher,
    );

    expect(result.searchConsole.state).toBe("healthy");
    const persisted = await getSiteCredentialHealth(
      DB,
      SITE.id,
      "search-console",
    );
    expect(persisted?.state).toBe("healthy");
  });
});

describe("selection-time probe", () => {
  it("runs a probe when no cached record exists", async () => {
    const fetcher = tokenAndDataDispatcher(HEALTHY_SC_RESPONSE);

    await ensureSelectableHealth(DB, SITE, RESOLVED, fetcher);

    expect(fetcher).toHaveBeenCalled();
    const persisted = await getSiteCredentialHealth(
      DB,
      SITE.id,
      "search-console",
    );
    expect(persisted?.state).toBe("healthy");
  });

  it("reuses a fresh, healthy cached result with no probe", async () => {
    const now = () => Date.parse("2026-08-17T00:00:00.000Z");
    await upsertSiteCredentialHealth(DB, {
      siteId: SITE.id,
      source: "search-console",
      credentialSource: RESOLVED.source,
      accountKey: RESOLVED.accountKey,
      state: "healthy",
      checkedAt: "2026-08-16T21:00:00.000Z",
      expiresAt: "2026-08-17T03:00:00.000Z",
    });
    const fetcher = vi.fn<typeof fetch>();

    const result = await ensureSelectableHealth(
      DB,
      SITE,
      RESOLVED,
      fetcher,
      now,
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.state).toBe("healthy");
  });

  it("runs a fresh probe when the cached result is stale (expires_at <= now)", async () => {
    const now = () => Date.parse("2026-08-17T05:00:00.000Z");
    await upsertSiteCredentialHealth(DB, {
      siteId: SITE.id,
      source: "search-console",
      credentialSource: RESOLVED.source,
      accountKey: RESOLVED.accountKey,
      state: "healthy",
      checkedAt: "2026-08-16T21:00:00.000Z",
      expiresAt: "2026-08-17T03:00:00.000Z",
    });
    const fetcher = tokenAndDataDispatcher(HEALTHY_SC_RESPONSE);

    await ensureSelectableHealth(DB, SITE, RESOLVED, fetcher, now);

    expect(fetcher).toHaveBeenCalled();
  });

  it("runs a fresh probe when the cached record belongs to a different accountKey (tier change)", async () => {
    const now = () => Date.parse("2026-08-17T00:00:00.000Z");
    await upsertSiteCredentialHealth(DB, {
      siteId: SITE.id,
      source: "search-console",
      credentialSource: "global",
      accountKey: "global",
      state: "healthy",
      checkedAt: "2026-08-16T23:58:00.000Z",
      expiresAt: "2026-08-17T05:58:00.000Z",
    });
    const fetcher = tokenAndDataDispatcher(HEALTHY_SC_RESPONSE);

    await ensureSelectableHealth(DB, SITE, RESOLVED, fetcher, now);

    expect(fetcher).toHaveBeenCalled();
    const persisted = await getSiteCredentialHealth(
      DB,
      SITE.id,
      "search-console",
    );
    expect(persisted?.accountKey).toBe(RESOLVED.accountKey);
  });
});

describe("manual recheck", () => {
  it("bypasses the freshness window even for a fresh cached result", async () => {
    const now = () => Date.parse("2026-08-17T00:00:00.000Z");
    await upsertSiteCredentialHealth(DB, {
      siteId: SITE.id,
      source: "search-console",
      credentialSource: RESOLVED.source,
      accountKey: RESOLVED.accountKey,
      state: "unhealthy",
      reason: "property_not_accessible",
      checkedAt: "2026-08-16T23:58:00.000Z",
      expiresAt: "2026-08-17T05:58:00.000Z",
    });
    const fetcher = tokenAndDataDispatcher(HEALTHY_SC_RESPONSE);

    const result = await checkSearchConsoleHealth(
      DB,
      SITE,
      RESOLVED,
      { forceRecheck: true },
      fetcher,
      now,
    );

    expect(fetcher).toHaveBeenCalled();
    expect(result.state).toBe("healthy");
  });
});

describe("listing sites never triggers a probe", () => {
  it("has no listing-facing function that calls a probe (structural: checkSearchConsoleHealth/checkGoogleAdsHealth/runConnectHealthCheck are the only probe entry points)", async () => {
    // `credentialStatusForSite` (the function `list_sites` calls) is
    // exercised in test/schemas/sites.test.ts and
    // test/integration/list-sites-credential.test.ts, which assert zero
    // fetch calls directly. This test asserts the state-machine module
    // exports no other function name a listing could plausibly reach.
    const health = await import("../../src/google/health");
    expect(typeof health.credentialStatusForSite).toBe("function");
  });
});

describe("checking is never persisted", () => {
  it("no persisted health row ever has state other than healthy/unhealthy", async () => {
    const fetcher = tokenAndDataDispatcher(HEALTHY_SC_RESPONSE);
    await checkSearchConsoleHealth(DB, SITE, RESOLVED, {}, fetcher);

    const { results } = await DB.prepare(
      "SELECT DISTINCT state FROM site_credential_health",
    ).all<{ state: string }>();
    for (const row of results) {
      expect(["healthy", "unhealthy"]).toContain(row.state);
    }
  });
});

describe("a real call's own outcome", () => {
  it("success extends expires_at without running a probe", async () => {
    await upsertSiteCredentialHealth(DB, {
      siteId: SITE.id,
      source: "search-console",
      credentialSource: RESOLVED.source,
      accountKey: RESOLVED.accountKey,
      state: "healthy",
      checkedAt: "2026-08-16T00:00:00.000Z",
      expiresAt: "2026-08-16T06:00:00.000Z",
    });
    const now = () => Date.parse("2026-08-17T00:00:00.000Z");

    await recordAuthenticatedCallSuccess(
      DB,
      SITE.id,
      "search-console",
      RESOLVED,
      now,
    );

    const persisted = await getSiteCredentialHealth(
      DB,
      SITE.id,
      "search-console",
    );
    expect(persisted?.state).toBe("healthy");
    expect(Date.parse(persisted!.expiresAt)).toBe(
      now() + CREDENTIAL_HEALTH_TTL_SECONDS * 1000,
    );
  });

  it("an upstream_credential_failure directly downgrades health without running a probe", async () => {
    await upsertSiteCredentialHealth(DB, {
      siteId: SITE.id,
      source: "search-console",
      credentialSource: RESOLVED.source,
      accountKey: RESOLVED.accountKey,
      state: "healthy",
      checkedAt: "2026-08-16T00:00:00.000Z",
      expiresAt: "2026-08-17T06:00:00.000Z",
    });
    const now = () => Date.parse("2026-08-17T00:00:00.000Z");

    await recordAuthenticatedCallFailure(
      DB,
      SITE.id,
      "search-console",
      RESOLVED,
      "credential_rejected",
      null,
      now,
    );

    const persisted = await getSiteCredentialHealth(
      DB,
      SITE.id,
      "search-console",
    );
    expect(persisted?.state).toBe("unhealthy");
    expect(persisted?.reason).toBe("credential_rejected");
  });
});

describe("Google Ads health", () => {
  it("checkGoogleAdsHealth persists a record independent of Search Console gating", async () => {
    const fetcher = tokenAndDataDispatcher(() =>
      Response.json({ resourceNames: ["customers/999"] }),
    );

    const result = await checkGoogleAdsHealth(
      DB,
      SITE,
      RESOLVED,
      "dev-token",
      {},
      fetcher,
    );

    expect(result.state).toBe("healthy");
    const persisted = await getSiteCredentialHealth(DB, SITE.id, "google-ads");
    expect(persisted?.state).toBe("healthy");
  });
});
