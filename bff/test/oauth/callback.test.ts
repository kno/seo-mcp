import { describe, expect, it, vi } from "vitest";
import { handleOauthCallback } from "../../src/oauth/callback";
import { mintState } from "../../src/oauth/state";

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

function stubMcpFetch(behavior: "success" | "rejected"): Fetcher {
  return {
    fetch: vi.fn(async () =>
      behavior === "success"
        ? Response.json({
            jsonrpc: "2.0",
            id: "1",
            result: { structuredContent: { connected: true } },
          })
        : Response.json({ error: "invalid_grant: bad code" }, { status: 502 }),
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
    SEO_MCP: stubMcpFetch("success"),
    RESULT_CACHE: fakeKv(),
    ...overrides,
  } as Env;
}

async function callbackRequest(code: string, state: string): Promise<Request> {
  return new Request(
    `https://bff.example/auth/google/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
  );
}

describe("handleOauthCallback", () => {
  it("succeeds with no cookie present on the request", async () => {
    const env = fakeEnv();
    const state = await mintState(
      { siteId: 7, sub: "dashboard" },
      env.GOOGLE_OAUTH_STATE_KEY,
      env.RESULT_CACHE,
    );
    const request = await callbackRequest("auth-code", state as string);
    expect(request.headers.get("cookie")).toBeNull();
    const response = await handleOauthCallback(request, env);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") as string);
    expect(location.hash).toBe("#/manage-domains?connected=1");
  });

  it("classifies a Google token-endpoint rejection into a normalized connect_error, never raw upstream text", async () => {
    const env = fakeEnv({ SEO_MCP: stubMcpFetch("rejected") });
    const state = await mintState(
      { siteId: 7, sub: "dashboard" },
      env.GOOGLE_OAUTH_STATE_KEY,
      env.RESULT_CACHE,
    );
    const response = await handleOauthCallback(
      await callbackRequest("bad-code", state as string),
      env,
    );
    expect(response.status).toBe(302);
    const location = response.headers.get("location") as string;
    expect(location).not.toContain("invalid_grant");
    expect(location).not.toContain("bad code");
    const url = new URL(location);
    const hashParams = new URLSearchParams(
      url.hash.replace(/^#\/manage-domains\?/, ""),
    );
    expect(hashParams.get("connect_error")).toBe("token_exchange_failed");
  });

  it("rejects an invalid state before attempting any code exchange", async () => {
    const env = fakeEnv();
    const response = await handleOauthCallback(
      await callbackRequest("some-code", "forged.state"),
      env,
    );
    expect(env.SEO_MCP.fetch).not.toHaveBeenCalled();
    expect(response.status).toBe(302);
    const url = new URL(response.headers.get("location") as string);
    const hashParams = new URLSearchParams(
      url.hash.replace(/^#\/manage-domains\?/, ""),
    );
    expect(hashParams.get("connect_error")).toBe("state_invalid");
  });
});
