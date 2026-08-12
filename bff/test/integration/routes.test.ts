/**
 * Integration coverage for Phase 3's remaining routes: real service
 * binding to the stub MCP worker (not a mocked `env.SEO_MCP`), asserting
 * the `Authorization` header reaches the upstream call per route, and
 * that 401/429/503 upstream responses map to the normalized error codes
 * — without depending on the real, unsimulatable ratelimit binding
 * (`ROADMAP.md:20`).
 */
import { describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { createSessionCookie } from "../../src/session";

interface StubEnv {
  DASHBOARD_SESSION_KEY: string;
  SEO_MCP: Fetcher;
}

const stubEnv = env as unknown as StubEnv;

async function lastCall(): Promise<{
  calls: number;
  lastAuthorizationHeader: string | null;
}> {
  const response = await stubEnv.SEO_MCP.fetch("http://stub-mcp/__calls");
  return (await response.json()) as {
    calls: number;
    lastAuthorizationHeader: string | null;
  };
}

async function authenticatedRequest(path: string): Promise<Request> {
  const cookie = await createSessionCookie(
    "dashboard",
    3600,
    stubEnv.DASHBOARD_SESSION_KEY,
  );
  return new Request(`https://bff.example${path}`, {
    headers: { cookie: `dashboard_session=${cookie}` },
  });
}

describe("BFF routes (integration, stub MCP) - Authorization header per route", () => {
  it("sends the Authorization header on the crawl_page route", async () => {
    const response = await SELF.fetch(
      await authenticatedRequest(
        "/api/tools/crawl_page?url=https%3A%2F%2Fexample.com",
      ),
    );
    expect(response.status).toBe(200);
    const { lastAuthorizationHeader } = await lastCall();
    expect(lastAuthorizationHeader).toMatch(/^Bearer .+/);
  });

  it("sends the Authorization header on the check_links route", async () => {
    const response = await SELF.fetch(
      await authenticatedRequest(
        "/api/tools/check_links?url=https%3A%2F%2Fexample.com",
      ),
    );
    expect(response.status).toBe(200);
    const { lastAuthorizationHeader } = await lastCall();
    expect(lastAuthorizationHeader).toMatch(/^Bearer .+/);
  });
});

describe("BFF routes (integration, stub MCP) - upstream status mapping", () => {
  it("maps a simulated upstream 401 to upstream_unauthorized", async () => {
    const response = await SELF.fetch(
      await authenticatedRequest(
        "/api/tools/crawl_page?url=https%3A%2F%2Fsimulate-401.example",
      ),
    );
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("upstream_unauthorized");
  });

  it("maps a simulated upstream 429 to upstream_rate_limited without the real limiter", async () => {
    const response = await SELF.fetch(
      await authenticatedRequest(
        "/api/tools/crawl_page?url=https%3A%2F%2Fsimulate-429.example",
      ),
    );
    expect(response.status).toBe(429);
    const body = (await response.json()) as {
      error: { code: string; retryAfter?: number };
    };
    expect(body.error.code).toBe("upstream_rate_limited");
    expect(body.error.retryAfter).toBe(60);
  });

  it("maps a simulated upstream 503 to upstream_unavailable", async () => {
    const response = await SELF.fetch(
      await authenticatedRequest(
        "/api/tools/crawl_page?url=https%3A%2F%2Fsimulate-503.example",
      ),
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("upstream_unavailable");
  });
});
