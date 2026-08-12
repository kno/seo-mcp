/**
 * Proves the single most important property Phase 2 must demonstrate: the
 * dashboard access gate authorizes every request BEFORE any dispatch to
 * the MCP service binding, for both unauthenticated requests and unknown
 * routes. Runs against the real `SELF` BFF Worker wired to the stub MCP
 * auxiliary worker (`stub-mcp-worker.ts`) declared in
 * `vitest.bff-integration.config.ts`, over the real `services` binding
 * declared in `bff/wrangler.jsonc` — not a mocked `env.SEO_MCP`.
 */
import { describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { createSessionCookie } from "../../src/session";

interface StubEnv {
  DASHBOARD_SESSION_KEY: string;
  SEO_MCP: Fetcher;
}

const stubEnv = env as unknown as StubEnv;

async function stubCallCount(): Promise<number> {
  const response = await stubEnv.SEO_MCP.fetch("http://stub-mcp/__calls");
  const body = (await response.json()) as { calls: number };
  return body.calls;
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

describe("BFF gate ordering (integration, stub MCP)", () => {
  it("never calls the stub upstream MCP for an unauthenticated request", async () => {
    const before = await stubCallCount();
    const response = await SELF.fetch("https://bff.example/api/tools/health");
    expect(response.status).toBe(401);
    expect(await stubCallCount()).toBe(before);
  });

  it("never calls the stub upstream MCP for an unknown route, even when authenticated", async () => {
    const before = await stubCallCount();
    const response = await SELF.fetch(
      await authenticatedRequest("/api/tools/does-not-exist"),
    );
    expect(response.status).toBe(404);
    expect(await stubCallCount()).toBe(before);
  });

  it("calls the stub upstream MCP exactly once for an authenticated health request", async () => {
    const before = await stubCallCount();
    const response = await SELF.fetch(
      await authenticatedRequest("/api/tools/health"),
    );
    expect(response.status).toBe(200);
    expect(await stubCallCount()).toBe(before + 1);
    const body = (await response.json()) as { data: { status: string } };
    expect(body.data.status).toBe("ok");
  });
});
