import { describe, expect, it, vi } from "vitest";
import { handleOauthAuthorize } from "../../src/oauth/authorize";
import { createSessionCookie } from "../../src/session";
import { SESSION_COOKIE_NAME } from "../../src/gate";

function fakeKv(): KVNamespace {
  const store = new Map<string, string>();
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

function stubMcpFetch(sites: Array<{ id: number; url: string }>): Fetcher {
  return {
    fetch: vi.fn(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: "1",
        result: {
          structuredContent: {
            count: sites.length,
            sites: sites.map((site) => ({
              ...site,
              label: null,
              createdAt: "2026-01-01T00:00:00.000Z",
              credential: {
                tier: "none",
                accountLabel: null,
                accountKey: "global",
                health: {
                  searchConsole: { state: "unchecked" },
                  googleAds: { state: "unchecked" },
                },
              },
            })),
          },
        },
      }),
    ),
  } as unknown as Fetcher;
}

function fakeEnv(overrides: Partial<Env> = {}): Env {
  return {
    GATE_STRATEGY: "shared-secret-cookie",
    MCP_ORIGIN: "https://seo-mcp.internal",
    DASHBOARD_SECRET: "top-secret-value",
    DASHBOARD_SESSION_KEY: "session-signing-key",
    MCP_AUTH_TOKEN: "mcp-token",
    GOOGLE_OAUTH_STATE_KEY: "state-signing-key",
    GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
    SEO_MCP: stubMcpFetch([{ id: 7, url: "https://example.com" }]),
    RESULT_CACHE: fakeKv(),
    ...overrides,
  } as Env;
}

async function authorizeRequest(
  siteId: string,
  cookieValue?: string,
): Promise<Request> {
  return new Request(
    `https://bff.example/auth/google/authorize?siteId=${siteId}`,
    {
      headers: cookieValue
        ? { cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` }
        : {},
    },
  );
}

describe("handleOauthAuthorize", () => {
  it("rejects an unauthenticated request before any KV write or redirect", async () => {
    const env = fakeEnv();
    const response = await handleOauthAuthorize(
      await authorizeRequest("7"),
      env,
    );
    expect(response.status).not.toBe(302);
    expect(env.RESULT_CACHE.put).not.toHaveBeenCalled();
    expect(env.SEO_MCP.fetch).not.toHaveBeenCalled();
  });

  it("rejects a request naming an unknown siteId before minting state or redirecting", async () => {
    const env = fakeEnv();
    const cookie = await createSessionCookie(
      "dashboard",
      3600,
      env.DASHBOARD_SESSION_KEY,
    );
    const response = await handleOauthAuthorize(
      await authorizeRequest("999", cookie),
      env,
    );
    expect(response.status).not.toBe(302);
    expect(env.RESULT_CACHE.put).not.toHaveBeenCalled();
  });

  it("redirects to Google with a signed state for a known site, authenticated session", async () => {
    const env = fakeEnv();
    const cookie = await createSessionCookie(
      "dashboard",
      3600,
      env.DASHBOARD_SESSION_KEY,
    );
    const response = await handleOauthAuthorize(
      await authorizeRequest("7", cookie),
      env,
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") as string);
    expect(location.origin).toBe("https://accounts.google.com");
    expect(location.searchParams.get("client_id")).toBe(env.GOOGLE_CLIENT_ID);
    expect(location.searchParams.get("access_type")).toBe("offline");
    expect(location.searchParams.get("prompt")).toBe("consent");
    expect(location.searchParams.get("scope")).toBe(
      "openid email https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/adwords",
    );
    expect(location.searchParams.get("state")).toBeTruthy();
    expect(env.RESULT_CACHE.put).toHaveBeenCalledTimes(1);
  });
});
