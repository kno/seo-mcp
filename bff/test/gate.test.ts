import { describe, expect, it, vi } from "vitest";
import { authenticate, createSession } from "../src/gate";
import { createSessionCookie } from "../src/session";

function fakeEnv(overrides: Partial<Env> = {}): Env {
  return {
    GATE_STRATEGY: "shared-secret-cookie",
    MCP_ORIGIN: "https://seo-mcp.internal",
    DASHBOARD_SECRET: "top-secret-value",
    DASHBOARD_SESSION_KEY: "session-signing-key",
    MCP_AUTH_TOKEN: "mcp-token",
    SEO_MCP: { fetch: vi.fn() } as unknown as Fetcher,
    ...overrides,
  } as Env;
}

function requestWithCookie(cookieValue?: string): Request {
  return new Request("https://bff.example/api/tools/health", {
    headers: cookieValue ? { cookie: `dashboard_session=${cookieValue}` } : {},
  });
}

describe("authenticate — allowed/denied/unavailable outcomes", () => {
  it("denies a request with no session cookie, never touching the upstream binding", async () => {
    const env = fakeEnv();
    const outcome = await authenticate(requestWithCookie(), env);
    expect(outcome).toBe("denied");
    expect(env.SEO_MCP.fetch).not.toHaveBeenCalled();
  });

  it("allows a request carrying a valid session cookie, never touching the upstream binding", async () => {
    const env = fakeEnv();
    const cookie = await createSessionCookie(
      "dashboard",
      3600,
      env.DASHBOARD_SESSION_KEY,
    );
    const outcome = await authenticate(requestWithCookie(cookie), env);
    expect(outcome).toBe("allowed");
    expect(env.SEO_MCP.fetch).not.toHaveBeenCalled();
  });

  it("denies a request carrying a tampered session cookie", async () => {
    const env = fakeEnv();
    const cookie = await createSessionCookie(
      "dashboard",
      3600,
      env.DASHBOARD_SESSION_KEY,
    );
    expect(cookie).toBeDefined();
    const tampered = `${cookie}tampered`;
    const outcome = await authenticate(requestWithCookie(tampered), env);
    expect(outcome).toBe("denied");
  });

  it("denies a request carrying an expired session cookie", async () => {
    const env = fakeEnv();
    const cookie = await createSessionCookie(
      "dashboard",
      -60,
      env.DASHBOARD_SESSION_KEY,
    );
    const outcome = await authenticate(requestWithCookie(cookie), env);
    expect(outcome).toBe("denied");
  });

  it("reports unavailable when the session signing key is not configured", async () => {
    const env = fakeEnv({ DASHBOARD_SESSION_KEY: "" });
    const outcome = await authenticate(requestWithCookie(), env);
    expect(outcome).toBe("unavailable");
    expect(env.SEO_MCP.fetch).not.toHaveBeenCalled();
  });
});

describe("createSession — timing-safe credential comparison", () => {
  it("rejects an incorrect credential using a timing-safe (hash-based) comparison", async () => {
    const env = fakeEnv();
    const digestSpy = vi.spyOn(globalThis.crypto.subtle, "digest");
    const request = new Request("https://bff.example/auth/session", {
      method: "POST",
      body: JSON.stringify({ secret: "wrong-secret-value" }),
    });
    const response = await createSession(request, env);
    expect(response.status).toBe(401);
    // Both the provided and expected credentials are hashed before
    // comparison, mirroring `verifyTokens` in `src/http/auth.ts`.
    expect(digestSpy).toHaveBeenCalledTimes(2);
    digestSpy.mockRestore();
  });

  it("issues a session cookie for the correct credential without embedding the raw secret", async () => {
    const env = fakeEnv();
    const request = new Request("https://bff.example/auth/session", {
      method: "POST",
      body: JSON.stringify({ secret: env.DASHBOARD_SECRET }),
    });
    const response = await createSession(request, env);
    expect(response.status).toBe(204);
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain("dashboard_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).not.toContain(env.DASHBOARD_SECRET);
  });

  it("reports gate_unavailable when the shared secret is not configured", async () => {
    const env = fakeEnv({ DASHBOARD_SECRET: "" });
    const request = new Request("https://bff.example/auth/session", {
      method: "POST",
      body: JSON.stringify({ secret: "anything" }),
    });
    const response = await createSession(request, env);
    expect(response.status).toBe(503);
  });

  it("rejects a malformed request body as invalid_input", async () => {
    const env = fakeEnv();
    const request = new Request("https://bff.example/auth/session", {
      method: "POST",
      body: "not-json",
    });
    const response = await createSession(request, env);
    expect(response.status).toBe(400);
  });

  it("issues the session cookie with the exact SameSite=Lax attribute (Threat Matrix row h)", async () => {
    const env = fakeEnv();
    const request = new Request("https://bff.example/auth/session", {
      method: "POST",
      body: JSON.stringify({ secret: env.DASHBOARD_SECRET }),
    });
    const response = await createSession(request, env);
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).not.toContain("SameSite=Strict");
  });
});

describe("router.ts — every state-changing route remains POST or confirm-gated (Threat Matrix row h)", () => {
  it("every /api/tools/{delete_*} route is registered POST-only in router.ts", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(__dirname, "../src/router.ts"), "utf8");
    const stateChangingPaths = [
      "/api/tools/delete_search_console_snapshot",
      "/api/tools/delete_crawl_snapshot",
      "/api/tools/delete_site",
    ];
    for (const path of stateChangingPaths) {
      const anchor = source.indexOf(`url.pathname === "${path}"`);
      expect(anchor).toBeGreaterThan(-1);
      const precedingSlice = source.slice(0, anchor);
      const lastMethodCheckIndex = precedingSlice.lastIndexOf(
        'request.method === "POST"',
      );
      expect(lastMethodCheckIndex).toBeGreaterThan(-1);
    }
  });
});
