import { env as workerEnv } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSiteCredentials } from "../../src/google/credentials";
import { resetGoogleTokenCache } from "../../src/google/auth";
import { searchConsoleQuery } from "../../src/google/search-console";
import { getKeywordMetrics } from "../../src/google/ads";
import { listBusinessLocations } from "../../src/google/business";
import { addSite } from "../../src/db/site-store";
import type { Env } from "../../src/config";

const DB = (workerEnv as { DB: D1Database }).DB;

beforeAll(async () => {
  await DB.exec(
    "CREATE TABLE IF NOT EXISTS sites (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL UNIQUE, label TEXT, created_at TEXT NOT NULL)",
  );
  await DB.exec(
    "CREATE TABLE IF NOT EXISTS site_credentials (site_id INTEGER PRIMARY KEY, client_id TEXT NOT NULL, refresh_token_ciphertext TEXT NOT NULL, refresh_token_iv TEXT NOT NULL, google_account_email TEXT NOT NULL, account_key TEXT NOT NULL, ads_customer_id TEXT, scopes TEXT NOT NULL, connected_at TEXT NOT NULL)",
  );
});

beforeEach(async () => {
  await DB.exec("DELETE FROM site_credentials");
  await DB.exec("DELETE FROM sites");
  resetGoogleTokenCache();
});

const GLOBAL_ENV: Env = {
  GOOGLE_CLIENT_ID: "global-client-id",
  GOOGLE_CLIENT_SECRET: "global-client-secret",
  GOOGLE_REFRESH_TOKEN: "global-refresh-token",
  GOOGLE_ADS_DEVELOPER_TOKEN: "dev-token",
  GOOGLE_ADS_CUSTOMER_ID: "123-456-7890",
  DB,
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

describe("Phase 2 proof: every call site is behavior-identical when no site_credentials row exists", () => {
  it("resolveSiteCredentials falls back to the global tier for a site with no credential row", async () => {
    const { site } = await addSite(DB, { url: "sc-domain:example.com" });
    expect(site).not.toBeNull();

    const resolved = await resolveSiteCredentials(
      GLOBAL_ENV,
      "sc-domain:example.com",
    );

    expect(resolved.source).toBe("global");
    expect(resolved.accountKey).toBe("global");
    expect(resolved.credentials).toEqual({
      clientId: "global-client-id",
      clientSecret: "global-client-secret",
      refreshToken: "global-refresh-token",
    });
  });

  it("searchConsoleQuery still succeeds end-to-end via the resolved global credentials", async () => {
    await addSite(DB, { url: "sc-domain:example.com" });
    const fetcher = tokenAndDataDispatcher(() =>
      Response.json({
        rows: [
          { keys: ["kw"], clicks: 1, impressions: 10, ctr: 0.1, position: 3 },
        ],
      }),
    );

    const { credentials } = await resolveSiteCredentials(
      GLOBAL_ENV,
      "sc-domain:example.com",
    );
    const result = await searchConsoleQuery(
      {
        siteUrl: "sc-domain:example.com",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      },
      credentials,
      fetcher,
    );

    expect(result.rowCount).toBe(1);
    const tokenCall = fetcher.mock.calls.find((c) =>
      c[0].toString().includes("oauth2.googleapis.com"),
    )!;
    expect(String(tokenCall[1]!.body)).toContain(
      "refresh_token=global-refresh-token",
    );
  });

  it("getKeywordMetrics (Ads) still succeeds end-to-end, always resolving the global tier", async () => {
    const fetcher = tokenAndDataDispatcher(() =>
      Response.json({ results: [{ text: "kw", keywordMetrics: {} }] }),
    );

    const result = await getKeywordMetrics(
      { keywords: ["kw"] },
      GLOBAL_ENV,
      fetcher,
    );

    expect(result.count).toBe(1);
    const tokenCall = fetcher.mock.calls.find((c) =>
      c[0].toString().includes("oauth2.googleapis.com"),
    )!;
    expect(String(tokenCall[1]!.body)).toContain(
      "refresh_token=global-refresh-token",
    );
  });

  it("listBusinessLocations still succeeds end-to-end via globalCredentials", async () => {
    const fetcher = tokenAndDataDispatcher(() =>
      Response.json({
        accounts: [{ name: "accounts/1", accountName: "Acme" }],
      }),
    );

    const result = await listBusinessLocations(GLOBAL_ENV, fetcher);

    expect(result.accounts).toEqual([
      { name: "accounts/1", accountName: "Acme" },
    ]);
    const tokenCall = fetcher.mock.calls.find((c) =>
      c[0].toString().includes("oauth2.googleapis.com"),
    )!;
    expect(String(tokenCall[1]!.body)).toContain(
      "refresh_token=global-refresh-token",
    );
  });

  it("two different sites resolving to the global tier never share a cached access token with a site-tier credential (structural: no row exists anywhere)", async () => {
    await addSite(DB, { url: "sc-domain:a.com" });
    await addSite(DB, { url: "sc-domain:b.com" });

    const resolvedA = await resolveSiteCredentials(
      GLOBAL_ENV,
      "sc-domain:a.com",
    );
    const resolvedB = await resolveSiteCredentials(
      GLOBAL_ENV,
      "sc-domain:b.com",
    );

    // Both fall back to the identical global tier — this is the expected,
    // behavior-identical outcome for this slice (no site_credentials row
    // exists anywhere yet); the cross-account leak this phase closes is
    // proven by test/google/auth.test.ts's headline test instead.
    expect(resolvedA).toEqual(resolvedB);
  });
});
