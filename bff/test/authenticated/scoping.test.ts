/**
 * `domain-google-credentials`, Phase 5 — credential-scoped BFF cache key
 * and per-account quota ledger. Headline test (threat matrix row e): two
 * `accountKey`s must NEVER share a cache entry for identical tool args —
 * the second cross-account cache leak `design.md` identified, structurally
 * identical to (but separate from) the token-cache leak Phase 2 fixed.
 */
import { describe, expect, it, vi } from "vitest";
import { handleRequest } from "../../src/router";
import { createSessionCookie } from "../../src/session";
import { getQuotaEstimate } from "../../src/authenticated/quota-ledger";

function fakeKv(initial: Record<string, string> = {}): KVNamespace {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  } as unknown as KVNamespace;
}

function throwingKv(): KVNamespace {
  return {
    get: vi.fn(async () => {
      throw new Error("KV unreachable");
    }),
    put: vi.fn(async () => {
      throw new Error("KV unreachable");
    }),
    delete: vi.fn(async () => {
      throw new Error("KV unreachable");
    }),
  } as unknown as KVNamespace;
}

function credentialEntry(
  tier: "site" | "global" | "none",
  accountKey: string | null,
  accountLabel: string | null,
  searchConsoleState:
    | "not_connected"
    | "unchecked"
    | "stale"
    | "healthy"
    | "unhealthy" = "healthy",
) {
  return {
    tier,
    accountKey,
    accountLabel,
    health: {
      searchConsole: { state: searchConsoleState },
      googleAds: { state: searchConsoleState },
    },
  };
}

/** Discriminates the stubbed `SEO_MCP` fetch response by the JSON-RPC
 * `params.name`/`params.arguments.siteUrl`, so `list_sites` (used to
 * refresh the `ak1:{siteUrl}` map) and `search_console_query` (the real
 * authenticated call) get different, realistic responses from ONE stub. */
function stubSeoMcp(
  sites: Array<{
    url: string;
    id: number;
    credential: ReturnType<typeof credentialEntry>;
  }>,
) {
  return vi.fn(async (request: Request) => {
    const body = (await request.json()) as {
      params: { name: string; arguments: Record<string, unknown> };
    };
    if (body.params.name === "list_sites") {
      return Response.json({
        jsonrpc: "2.0",
        id: "1",
        result: {
          structuredContent: {
            count: sites.length,
            sites: sites.map((site) => ({
              id: site.id,
              url: site.url,
              label: null,
              createdAt: "2026-01-01T00:00:00.000Z",
              credential: site.credential,
            })),
          },
        },
      });
    }
    const siteUrl = body.params.arguments.siteUrl as string;
    return Response.json({
      jsonrpc: "2.0",
      id: "1",
      result: {
        structuredContent: {
          siteUrl,
          startDate: "2026-07-01",
          endDate: "2026-07-28",
          dimensions: ["query", "page"],
          rowCount: 1,
          rows: [
            { keys: ["q"], clicks: 1, impressions: 1, ctr: 1, position: 1 },
          ],
        },
      },
    });
  });
}

function fakeEnv(overrides: Partial<Env> = {}): Env {
  return {
    GATE_STRATEGY: "shared-secret-cookie",
    MCP_ORIGIN: "https://seo-mcp.internal",
    DASHBOARD_SECRET: "top-secret-value",
    DASHBOARD_SESSION_KEY: "session-signing-key",
    MCP_AUTH_TOKEN: "mcp-token",
    RESULT_CACHE: fakeKv(),
    AUTH_SOURCE_TTL_SECONDS: { "search-console": { closed: 21600, open: 900 } },
    AUTH_SOURCE_BUDGET: { "search-console": 300 },
    ...overrides,
  } as unknown as Env;
}

async function authenticatedRequest(env: Env, path: string): Promise<Request> {
  const cookie = await createSessionCookie(
    "dashboard",
    3600,
    env.DASHBOARD_SESSION_KEY,
  );
  return new Request(`https://bff.example${path}`, {
    headers: { cookie: `dashboard_session=${cookie}` },
  });
}

function gscPath(siteUrl: string): string {
  return `/api/tools/search_console_query?siteUrl=${encodeURIComponent(siteUrl)}&startDate=2026-07-01&endDate=2026-07-28`;
}

describe("credential-scoped cache key — two accountKeys never share a cache entry (threat row e)", () => {
  it("produces a cache MISS for identical args under a different resolved account, never a hit", async () => {
    const env = fakeEnv({
      SEO_MCP: {
        fetch: stubSeoMcp([
          {
            id: 1,
            url: "https://site-a.example",
            credential: credentialEntry(
              "site",
              "account-a",
              "owner-a@example.com",
            ),
          },
          {
            id: 2,
            url: "https://site-b.example",
            credential: credentialEntry(
              "site",
              "account-b",
              "owner-b@example.com",
            ),
          },
        ]),
      } as unknown as Fetcher,
    });

    const firstRequest = await authenticatedRequest(
      env,
      gscPath("https://site-a.example"),
    );
    const firstResponse = await handleRequest(firstRequest, env);
    const firstBody = (await firstResponse.json()) as {
      cacheStatus: string;
      credential: { accountKey: string; source: string };
    };
    expect(firstBody.cacheStatus).toBe("miss");
    expect(firstBody.credential.accountKey).toBe("account-a");
    expect(firstBody.credential.source).toBe("site");

    // Different siteUrl -> different resolved account -> even though the
    // rest of the query args (dates) are byte-identical, this MUST be a
    // fresh cache miss, not a hit reusing site-a's cached entry.
    const secondRequest = await authenticatedRequest(
      env,
      gscPath("https://site-b.example"),
    );
    const secondResponse = await handleRequest(secondRequest, env);
    const secondBody = (await secondResponse.json()) as {
      cacheStatus: string;
      credential: { accountKey: string; source: string };
    };
    expect(secondBody.cacheStatus).toBe("miss");
    expect(secondBody.credential.accountKey).toBe("account-b");

    // Repeating site-a's exact request now DOES hit its own cache entry —
    // proving the miss above was genuine cross-account scoping, not a
    // generally-broken cache.
    const thirdRequest = await authenticatedRequest(
      env,
      gscPath("https://site-a.example"),
    );
    const thirdResponse = await handleRequest(thirdRequest, env);
    const thirdBody = (await thirdResponse.json()) as { cacheStatus: string };
    expect(thirdBody.cacheStatus).toBe("hit");
  });
});

describe("credential-scoped quota ledger — buckets per account, not per site", () => {
  it("increments two independent buckets for two sites on two different accounts", async () => {
    const env = fakeEnv({
      SEO_MCP: {
        fetch: stubSeoMcp([
          {
            id: 1,
            url: "https://site-a.example",
            credential: credentialEntry(
              "site",
              "account-a",
              "owner-a@example.com",
            ),
          },
          {
            id: 2,
            url: "https://site-b.example",
            credential: credentialEntry(
              "site",
              "account-b",
              "owner-b@example.com",
            ),
          },
        ]),
      } as unknown as Fetcher,
    });

    await handleRequest(
      await authenticatedRequest(env, gscPath("https://site-a.example")),
      env,
    );
    await handleRequest(
      await authenticatedRequest(env, gscPath("https://site-b.example")),
      env,
    );

    const estimateA = await getQuotaEstimate(
      env.RESULT_CACHE,
      "search-console",
      300,
      "account-a",
    );
    const estimateB = await getQuotaEstimate(
      env.RESULT_CACHE,
      "search-console",
      300,
      "account-b",
    );
    expect(estimateA.atLeast).toBe(1);
    expect(estimateB.atLeast).toBe(1);
  });

  it("shares ONE ledger bucket for two sites on the SAME Google account", async () => {
    const env = fakeEnv({
      SEO_MCP: {
        fetch: stubSeoMcp([
          {
            id: 1,
            url: "https://site-a.example",
            credential: credentialEntry(
              "site",
              "shared-account",
              "owner@example.com",
            ),
          },
          {
            id: 2,
            url: "https://site-c.example",
            credential: credentialEntry(
              "site",
              "shared-account",
              "owner@example.com",
            ),
          },
        ]),
      } as unknown as Fetcher,
    });

    await handleRequest(
      await authenticatedRequest(env, gscPath("https://site-a.example")),
      env,
    );
    await handleRequest(
      await authenticatedRequest(env, gscPath("https://site-c.example")),
      env,
    );

    const estimate = await getQuotaEstimate(
      env.RESULT_CACHE,
      "search-console",
      300,
      "shared-account",
    );
    expect(estimate.atLeast).toBe(2);
  });
});

describe("every authenticated result carries credential provenance", () => {
  it("requires the credential field on a global-fallback result too", async () => {
    const env = fakeEnv({
      SEO_MCP: {
        fetch: stubSeoMcp([
          {
            id: 1,
            url: "https://global-site.example",
            credential: credentialEntry("global", "global", null),
          },
        ]),
      } as unknown as Fetcher,
    });

    const request = await authenticatedRequest(
      env,
      gscPath("https://global-site.example"),
    );
    const response = await handleRequest(request, env);
    const body = (await response.json()) as {
      credential?: {
        source: string;
        accountKey: string;
        accountLabel: string | null;
        basis: string;
      };
    };
    expect(body.credential).toBeDefined();
    expect(body.credential?.source).toBe("global");
    expect(body.credential?.accountKey).toBe("global");
    expect(body.credential?.basis).toBe("bff-resolved");
  });
});

describe("threat row k: ak1 map KV absent/throwing still serves a live result, unavailable quota only", () => {
  it("serves the live result with a fixed fallback accountKey when RESULT_CACHE is absent", async () => {
    const env = fakeEnv({
      RESULT_CACHE: undefined,
      SEO_MCP: {
        fetch: stubSeoMcp([]),
      } as unknown as Fetcher,
    });
    const request = await authenticatedRequest(
      env,
      gscPath("https://site-a.example"),
    );
    const response = await handleRequest(request, env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: unknown;
      quota?: { basis: string };
      credential?: { source: string };
    };
    expect(body.data).toBeDefined();
    expect(body.quota?.basis).toBe("unavailable");
    expect(body.credential?.source).toBe("global");
  });

  it("serves the live result when RESULT_CACHE throws on the ak1 lookup", async () => {
    const env = fakeEnv({
      RESULT_CACHE: throwingKv(),
      SEO_MCP: {
        fetch: stubSeoMcp([]),
      } as unknown as Fetcher,
    });
    const request = await authenticatedRequest(
      env,
      gscPath("https://site-a.example"),
    );
    const response = await handleRequest(request, env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown };
    expect(body.data).toBeDefined();
  });
});

describe("site-scoped gating (task 5.6): distinct 503 codes, never a generic tool failure", () => {
  it("rejects with site_credential_not_connected when the site resolves to tier 'none'", async () => {
    const env = fakeEnv({
      SEO_MCP: {
        fetch: stubSeoMcp([
          {
            id: 1,
            url: "https://unconnected.example",
            credential: credentialEntry("none", null, null, "not_connected"),
          },
        ]),
      } as unknown as Fetcher,
    });
    const request = await authenticatedRequest(
      env,
      gscPath("https://unconnected.example"),
    );
    const response = await handleRequest(request, env);
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("site_credential_not_connected");
  });

  it("rejects with site_credential_unhealthy when the site's Search Console health is unhealthy", async () => {
    const env = fakeEnv({
      SEO_MCP: {
        fetch: stubSeoMcp([
          {
            id: 1,
            url: "https://unhealthy.example",
            credential: credentialEntry(
              "site",
              "account-x",
              "owner@example.com",
              "unhealthy",
            ),
          },
        ]),
      } as unknown as Fetcher,
    });
    const request = await authenticatedRequest(
      env,
      gscPath("https://unhealthy.example"),
    );
    const response = await handleRequest(request, env);
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("site_credential_unhealthy");
  });
});
