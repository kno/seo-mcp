import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { buildServer } from "../../src/server";
import type { Env } from "../../src/config";

/**
 * Minimal in-memory fake D1, matching the exact `prepare(sql).bind(...)`
 * shapes `src/db/site-store.ts`/`src/db/site-credential-store.ts` issue —
 * mirrors `test/google/credentials.test.ts`'s established fake-D1 pattern
 * for this "unit" vitest project (no Miniflare D1 binding available here;
 * see `test/integration/site-credential-store.test.ts`'s own note on why
 * D1-backed store tests live under `test/integration/` instead — this file
 * tests the TOOL layer above the store, so a fake D1 is enough).
 */
interface FakeSiteRow {
  id: number;
  url: string;
  label: string | null;
  created_at: string;
}

interface FakeCredentialRow {
  site_id: number;
  client_id: string;
  refresh_token_ciphertext: string;
  refresh_token_iv: string;
  google_account_email: string;
  account_key: string;
  ads_customer_id: string | null;
  scopes: string;
  connected_at: string;
}

interface FakeHealthRow {
  site_id: number;
  source: string;
  credential_source: string;
  account_key: string;
  state: string;
  reason: string | null;
  detail: string | null;
  checked_at: string;
  expires_at: string;
}

function createFakeDb(seed: { sites?: FakeSiteRow[] } = {}) {
  const sites = new Map<number, FakeSiteRow>();
  for (const site of seed.sites ?? []) sites.set(site.id, site);
  const credentials = new Map<number, FakeCredentialRow>();
  const health = new Map<string, FakeHealthRow>();

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>(): Promise<T | null> {
              if (sql.includes("FROM sites") && sql.includes("WHERE id")) {
                return (sites.get(args[0] as number) ?? null) as T | null;
              }
              if (sql.includes("FROM sites") && sql.includes("WHERE url")) {
                const url = args[0];
                for (const site of sites.values()) {
                  if (site.url === url) return site as unknown as T;
                }
                return null;
              }
              if (sql.includes("FROM site_credentials")) {
                return (credentials.get(args[0] as number) ?? null) as T | null;
              }
              if (sql.includes("FROM site_credential_health")) {
                const key = `${args[0]}:${args[1]}`;
                return (health.get(key) ?? null) as T | null;
              }
              return null;
            },
            async run(): Promise<{ meta: { changes: number } }> {
              if (sql.includes("INSERT INTO site_credentials")) {
                const [
                  siteId,
                  clientId,
                  ciphertext,
                  iv,
                  email,
                  accountKey,
                  adsCustomerId,
                  scopes,
                  connectedAt,
                ] = args as [
                  number,
                  string,
                  string,
                  string,
                  string,
                  string,
                  string | null,
                  string,
                  string,
                ];
                credentials.set(siteId, {
                  site_id: siteId,
                  client_id: clientId,
                  refresh_token_ciphertext: ciphertext,
                  refresh_token_iv: iv,
                  google_account_email: email,
                  account_key: accountKey,
                  ads_customer_id: adsCustomerId,
                  scopes,
                  connected_at: connectedAt,
                });
                return { meta: { changes: 1 } };
              }
              if (sql.includes("DELETE FROM site_credentials")) {
                const siteId = args[0] as number;
                const existed = credentials.delete(siteId);
                return { meta: { changes: existed ? 1 : 0 } };
              }
              if (sql.includes("INSERT INTO site_credential_health")) {
                const [
                  siteId,
                  source,
                  credentialSource,
                  accountKey,
                  state,
                  reason,
                  detail,
                  checkedAt,
                  expiresAt,
                ] = args as [
                  number,
                  string,
                  string,
                  string,
                  string,
                  string | null,
                  string | null,
                  string,
                  string,
                ];
                health.set(`${siteId}:${source}`, {
                  site_id: siteId,
                  source,
                  credential_source: credentialSource,
                  account_key: accountKey,
                  state,
                  reason,
                  detail,
                  checked_at: checkedAt,
                  expires_at: expiresAt,
                });
                return { meta: { changes: 1 } };
              }
              if (sql.includes("DELETE FROM site_credential_health")) {
                const siteId = args[0] as number;
                let changes = 0;
                for (const key of [...health.keys()]) {
                  if (key.startsWith(`${siteId}:`)) {
                    health.delete(key);
                    changes++;
                  }
                }
                return { meta: { changes } };
              }
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return { db, sites, credentials, health };
}

function base64UrlEncodeJson(value: unknown): string {
  const json = JSON.stringify(value);
  const binary = new TextEncoder()
    .encode(json)
    .reduce((acc, byte) => acc + String.fromCharCode(byte), "");
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fakeIdToken(email: string): string {
  const header = base64UrlEncodeJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlEncodeJson({
    email,
    iss: "https://accounts.google.com",
  });
  return `${header}.${payload}.signature`;
}

type ToolHandle = {
  handler: (
    args: unknown,
    ctx: unknown,
  ) => Promise<{
    isError?: boolean;
    content: unknown[];
    structuredContent?: unknown;
  }>;
};

function getTool(env: Env, name: string): ToolHandle {
  const server = buildServer(env);
  return (server as unknown as { _registeredTools: Record<string, ToolHandle> })
    ._registeredTools[name];
}

const ENCRYPTION_KEY = (() => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
})();

const DECOY_REFRESH_TOKEN = "decoy-refresh-token-should-never-leak";
const DECOY_CODE = "decoy-authorization-code-should-never-leak";

function baseEnv(db: D1Database): Env {
  return {
    DB: db,
    DOMAIN_CREDENTIAL_ENCRYPTION_KEY: ENCRYPTION_KEY,
    GOOGLE_CLIENT_ID: "app-client-id.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "app-client-secret",
  };
}

describe("connect_google_account", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("exchanges the code server-side, encrypts+persists, and runs the post-connect probe before reporting success", async () => {
    const { db, credentials, health } = createFakeDb({
      sites: [
        {
          id: 7,
          url: "sc-domain:example.com",
          label: null,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const env = baseEnv(db);

    const tokenFetch = vi.fn(async (url: string | URL) => {
      if (url.toString() === "https://oauth2.googleapis.com/token") {
        return Response.json({
          refresh_token: DECOY_REFRESH_TOKEN,
          access_token: "access-token-abc",
          id_token: fakeIdToken("owner@example.com"),
          expires_in: 3600,
          scope: "openid email webmasters.readonly adwords",
        });
      }
      if (url.toString().includes("searchconsole.googleapis.com")) {
        return Response.json({ permissionLevel: "siteOwner" });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    globalThis.fetch = tokenFetch as unknown as typeof fetch;

    const tool = getTool(env, "connect_google_account");
    const response = await tool.handler(
      {
        siteId: 7,
        code: DECOY_CODE,
        redirectUri: "https://bff.example/auth/google/callback",
      },
      {},
    );

    expect(response.isError).toBeUndefined();
    const result = response.structuredContent as {
      siteUrl: string;
      connected: boolean;
      accountLabel: string;
      health: { searchConsole: { state: string } };
    };
    expect(result.siteUrl).toBe("sc-domain:example.com");
    expect(result.connected).toBe(true);
    expect(result.accountLabel).toBe("owner@example.com");
    expect(result.health.searchConsole.state).toBe("healthy");

    // Persisted: ciphertext, never plaintext.
    const stored = credentials.get(7);
    expect(stored?.refresh_token_ciphertext).not.toContain(DECOY_REFRESH_TOKEN);
    expect(stored?.google_account_email).toBe("owner@example.com");

    // The mandatory synchronous post-connect probe ran and was persisted.
    expect(health.get("7:search-console")?.state).toBe("healthy");

    // Threat matrix row c: no secret material in the tool's own return value.
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain(DECOY_REFRESH_TOKEN);
    expect(serialized).not.toContain(DECOY_CODE);
    expect(serialized).not.toContain(stored?.refresh_token_ciphertext);
    expect(serialized).not.toContain("app-client-secret");
  });

  it("still persists the credential row and reports an unhealthy state when the property is inaccessible, never an unqualified success", async () => {
    const { db, credentials } = createFakeDb({
      sites: [
        {
          id: 8,
          url: "sc-domain:unreachable.com",
          label: null,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const env = baseEnv(db);

    globalThis.fetch = vi.fn(async (url: string | URL) => {
      if (url.toString() === "https://oauth2.googleapis.com/token") {
        return Response.json({
          refresh_token: "another-refresh-token",
          access_token: "access-token-def",
          id_token: fakeIdToken("owner2@example.com"),
          expires_in: 3600,
        });
      }
      if (url.toString().includes("searchconsole.googleapis.com")) {
        return new Response("forbidden", { status: 403 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const tool = getTool(env, "connect_google_account");
    const response = await tool.handler(
      {
        siteId: 8,
        code: "some-code",
        redirectUri: "https://bff.example/auth/google/callback",
      },
      {},
    );

    expect(response.isError).toBeUndefined();
    const result = response.structuredContent as {
      connected: boolean;
      health: { searchConsole: { state: string } };
    };
    expect(result.connected).toBe(true);
    expect(result.health.searchConsole.state).toBe("unhealthy");
    expect(credentials.get(8)).toBeDefined();
  });
});

describe("disconnect_google_account", () => {
  it("rejects without confirm, leaving the credential row intact", async () => {
    const { db, credentials } = createFakeDb({
      sites: [
        {
          id: 3,
          url: "https://connected.example.com",
          label: null,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    credentials.set(3, {
      site_id: 3,
      client_id: "site-client-id",
      refresh_token_ciphertext: "ciphertext",
      refresh_token_iv: "iv",
      google_account_email: "owner@example.com",
      account_key: "ak_abc",
      ads_customer_id: null,
      scopes: "openid",
      connected_at: "2026-01-01T00:00:00.000Z",
    });
    const env = baseEnv(db);

    const tool = getTool(env, "disconnect_google_account");
    const response = await tool.handler({ siteId: 3, confirm: false }, {});

    expect(response.isError).toBe(true);
    expect(credentials.get(3)).toBeDefined();
  });

  it("confirmed disconnect deletes the row and re-resolves to the global tier with a fresh unchecked health state", async () => {
    const { db, credentials, health } = createFakeDb({
      sites: [
        {
          id: 4,
          url: "https://connected2.example.com",
          label: null,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    credentials.set(4, {
      site_id: 4,
      client_id: "site-client-id",
      refresh_token_ciphertext: "ciphertext",
      refresh_token_iv: "iv",
      google_account_email: "owner@example.com",
      account_key: "ak_abc",
      ads_customer_id: null,
      scopes: "openid",
      connected_at: "2026-01-01T00:00:00.000Z",
    });
    health.set("4:search-console", {
      site_id: 4,
      source: "search-console",
      credential_source: "site",
      account_key: "ak_abc",
      state: "healthy",
      reason: null,
      detail: null,
      checked_at: "2026-01-01T00:00:00.000Z",
      expires_at: "2099-01-01T00:00:00.000Z",
    });
    const env: Env = {
      ...baseEnv(db),
      GOOGLE_REFRESH_TOKEN: "global-refresh-token",
    };

    const tool = getTool(env, "disconnect_google_account");
    const response = await tool.handler({ siteId: 4, confirm: true }, {});

    expect(response.isError).toBeUndefined();
    expect(
      (response.structuredContent as { disconnected: boolean }).disconnected,
    ).toBe(true);
    expect(credentials.get(4)).toBeUndefined();

    const checkTool = getTool(env, "check_site_credentials");
    const checkResponse = await checkTool.handler({ siteId: 4 }, {});
    const status = checkResponse.structuredContent as {
      tier: string;
      health: { searchConsole: { state: string } };
    };
    expect(status.tier).toBe("global");
    expect(status.health.searchConsole.state).toBe("unchecked");
  });
});

describe("check_site_credentials", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns the cached summary with zero Google calls when forceRecheck is not set", async () => {
    const { db, health } = createFakeDb({
      sites: [
        {
          id: 5,
          url: "https://cached.example.com",
          label: null,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    health.set("5:search-console", {
      site_id: 5,
      source: "search-console",
      credential_source: "global",
      account_key: "global",
      state: "healthy",
      reason: null,
      detail: null,
      checked_at: "2026-01-01T00:00:00.000Z",
      expires_at: "2099-01-01T00:00:00.000Z",
    });
    const env: Env = {
      ...baseEnv(db),
      GOOGLE_REFRESH_TOKEN: "global-refresh-token",
    };
    const fetcher = vi.fn();
    globalThis.fetch = fetcher as unknown as typeof fetch;

    const tool = getTool(env, "check_site_credentials");
    const response = await tool.handler({ siteId: 5 }, {});

    expect(fetcher).not.toHaveBeenCalled();
    const status = response.structuredContent as {
      health: { searchConsole: { state: string } };
    };
    expect(status.health.searchConsole.state).toBe("healthy");
  });

  it("bypasses the freshness window and runs a fresh probe when forceRecheck is true", async () => {
    const { db, health } = createFakeDb({
      sites: [
        {
          id: 6,
          url: "https://recheck.example.com",
          label: null,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    health.set("6:search-console", {
      site_id: 6,
      source: "search-console",
      credential_source: "global",
      account_key: "global",
      state: "unhealthy",
      reason: "property_not_accessible",
      detail: null,
      checked_at: "2026-01-01T00:00:00.000Z",
      expires_at: "2099-01-01T00:00:00.000Z",
    });
    const env: Env = {
      ...baseEnv(db),
      GOOGLE_REFRESH_TOKEN: "global-refresh-token",
    };
    const fetcher = vi.fn(async (url: string | URL) => {
      if (url.toString() === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "tok", expires_in: 3600 });
      }
      if (url.toString().includes("searchconsole.googleapis.com")) {
        return Response.json({ permissionLevel: "siteOwner" });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetcher as unknown as typeof fetch;

    const tool = getTool(env, "check_site_credentials");
    const response = await tool.handler({ siteId: 6, forceRecheck: true }, {});

    expect(fetcher).toHaveBeenCalled();
    const status = response.structuredContent as {
      health: { searchConsole: { state: string } };
    };
    expect(status.health.searchConsole.state).toBe("healthy");
    expect(health.get("6:search-console")?.state).toBe("healthy");
  });
});
