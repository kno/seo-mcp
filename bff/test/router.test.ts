import { describe, expect, it, vi } from "vitest";
import { handleRequest } from "../src/router";
import { createSessionCookie } from "../src/session";

function stubHealthFetch() {
  return vi.fn(async () =>
    Response.json({
      jsonrpc: "2.0",
      id: "1",
      result: {
        structuredContent: {
          status: "ok",
          service: "seo-mcp",
          version: "0.1.0",
        },
      },
    }),
  );
}

function fakeEnv(overrides: Partial<Env> = {}): Env {
  return {
    GATE_STRATEGY: "shared-secret-cookie",
    MCP_ORIGIN: "https://seo-mcp.internal",
    DASHBOARD_SECRET: "top-secret-value",
    DASHBOARD_SESSION_KEY: "session-signing-key",
    MCP_AUTH_TOKEN: "mcp-token",
    SEO_MCP: { fetch: stubHealthFetch() } as unknown as Fetcher,
    ...overrides,
  } as Env;
}

async function authenticatedRequest(
  env: Env,
  path: string,
  init: RequestInit = {},
): Promise<Request> {
  const cookie = await createSessionCookie(
    "dashboard",
    3600,
    env.DASHBOARD_SESSION_KEY,
  );
  return new Request(`https://bff.example${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), cookie: `dashboard_session=${cookie}` },
  });
}

describe("router — gate authorizes before any upstream dispatch", () => {
  it("rejects an unauthenticated health request before calling SEO_MCP", async () => {
    const env = fakeEnv();
    const response = await handleRequest(
      new Request("https://bff.example/api/tools/health"),
      env,
    );
    expect(response.status).toBe(401);
    expect(env.SEO_MCP.fetch).not.toHaveBeenCalled();
  });

  it("returns the health tool result for an authenticated request", async () => {
    const env = fakeEnv();
    const request = await authenticatedRequest(env, "/api/tools/health");
    const response = await handleRequest(request, env);
    expect(response.status).toBe(200);
    expect(env.SEO_MCP.fetch).toHaveBeenCalledOnce();
    const body = (await response.json()) as { data: unknown };
    expect(body.data).toEqual({
      status: "ok",
      service: "seo-mcp",
      version: "0.1.0",
    });
  });

  it("injects the shared bearer token only on the SEO_MCP fetch, and never elsewhere", async () => {
    const env = fakeEnv();
    const request = await authenticatedRequest(env, "/api/tools/health");
    const response = await handleRequest(request, env);
    const [upstreamRequest] = (env.SEO_MCP.fetch as ReturnType<typeof vi.fn>)
      .mock.calls[0] as [Request];
    expect(upstreamRequest.headers.get("authorization")).toBe(
      `Bearer ${env.MCP_AUTH_TOKEN}`,
    );
    expect(response.headers.get("authorization")).toBeNull();
    const bodyText = JSON.stringify(await response.clone().json());
    expect(bodyText).not.toContain(env.MCP_AUTH_TOKEN);
  });

  it("returns 404 for an unknown tool route without calling SEO_MCP", async () => {
    const env = fakeEnv();
    const request = await authenticatedRequest(
      env,
      "/api/tools/does-not-exist",
    );
    const response = await handleRequest(request, env);
    expect(response.status).toBe(404);
    expect(env.SEO_MCP.fetch).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request to an unknown route before any routing decision", async () => {
    const env = fakeEnv();
    const response = await handleRequest(
      new Request("https://bff.example/api/tools/does-not-exist"),
      env,
    );
    expect(response.status).toBe(401);
    expect(env.SEO_MCP.fetch).not.toHaveBeenCalled();
  });

  it("allows POST /auth/session without a prior session, since it is the login endpoint itself", async () => {
    const env = fakeEnv();
    const request = new Request("https://bff.example/auth/session", {
      method: "POST",
      body: JSON.stringify({ secret: env.DASHBOARD_SECRET }),
    });
    const response = await handleRequest(request, env);
    expect(response.status).toBe(204);
    expect(env.SEO_MCP.fetch).not.toHaveBeenCalled();
  });

  it("maps an upstream failure on the health route to a normalized error, never a silent success", async () => {
    const env = fakeEnv({
      SEO_MCP: {
        fetch: vi.fn(
          async () => new Response("Service Unavailable", { status: 503 }),
        ),
      } as unknown as Fetcher,
    });
    const request = await authenticatedRequest(env, "/api/tools/health");
    const response = await handleRequest(request, env);
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("upstream_unavailable");
  });
});
