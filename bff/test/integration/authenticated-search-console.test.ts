/**
 * Integration coverage for Phase 2's authenticated route class, wired for
 * `search_console_query` against the stub MCP worker (never the real
 * Google/`seo-mcp` credential path):
 *
 * - Threat row (a): an unauthenticated request reaches neither Google nor
 *   any upstream call — asserted via the stub's `/__calls` counter, which
 *   only increments on a forwarded `tools/call`.
 * - Threat row (d): the four classifier outcomes map to the documented
 *   codes/statuses, and a decoy credential embedded in the simulated
 *   upstream failure text never appears in the response body — the
 *   classify-and-discard rule holds end-to-end, not only at the unit level.
 * - The required `sourceFreshness` field is present on every successful
 *   authenticated response.
 */
import { describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { createSessionCookie } from "../../src/session";

interface StubEnv {
  DASHBOARD_SESSION_KEY: string;
  SEO_MCP: Fetcher;
}

const stubEnv = env as unknown as StubEnv;

const DECOY_CREDENTIAL = "DECOY_REFRESH_TOKEN_xyz789";

async function callsSnapshot(): Promise<{ calls: number }> {
  const response = await stubEnv.SEO_MCP.fetch("http://stub-mcp/__calls");
  return (await response.json()) as { calls: number };
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

const BASE_QUERY = "startDate=2026-07-01&endDate=2026-07-28";

describe("search_console_query — unauthenticated containment (threat row a)", () => {
  it("never reaches Google/seo-mcp for an unauthenticated request", async () => {
    const before = await callsSnapshot();
    const response = await SELF.fetch(
      new Request(
        `https://bff.example/api/tools/search_console_query?siteUrl=https%3A%2F%2Fexample.com&${BASE_QUERY}`,
      ),
    );
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("gate_unauthorized");
    const after = await callsSnapshot();
    expect(after.calls).toBe(before.calls);
  });
});

describe("search_console_query — successful response carries required sourceFreshness", () => {
  it("returns sourceFreshness alongside data on a successful call", async () => {
    const response = await SELF.fetch(
      await authenticatedRequest(
        `/api/tools/search_console_query?siteUrl=https%3A%2F%2Fexample.com&${BASE_QUERY}`,
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: unknown;
      sourceFreshness?: {
        source: string;
        asOf: string;
        lagDays: number;
        basis: string;
      };
    };
    expect(body.sourceFreshness).toBeDefined();
    expect(body.sourceFreshness?.source).toBe("search-console");
    expect(body.sourceFreshness?.basis).toBe("assumed");
  });
});

describe("search_console_query — classify-and-discard (threat row d)", () => {
  it("classifies the exact not-configured constant as upstream_source_not_configured", async () => {
    const response = await SELF.fetch(
      await authenticatedRequest(
        `/api/tools/search_console_query?siteUrl=https%3A%2F%2Fsimulate-gsc-not-configured.example&${BASE_QUERY}`,
      ),
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("upstream_source_not_configured");
  });

  it("classifies an OAuth credential error and never forwards the decoy credential text", async () => {
    const response = await SELF.fetch(
      await authenticatedRequest(
        `/api/tools/search_console_query?siteUrl=https%3A%2F%2Fsimulate-gsc-credential-failure.example&${BASE_QUERY}`,
      ),
    );
    expect(response.status).toBe(502);
    const bodyText = await response.text();
    expect(bodyText).not.toContain(DECOY_CREDENTIAL);
    const body = JSON.parse(bodyText) as { error: { code: string } };
    expect(body.error.code).toBe("upstream_credential_failure");
  });

  it("classifies Google quota exhaustion without a fabricated retryAfter", async () => {
    const response = await SELF.fetch(
      await authenticatedRequest(
        `/api/tools/search_console_query?siteUrl=https%3A%2F%2Fsimulate-gsc-quota.example&${BASE_QUERY}`,
      ),
    );
    expect(response.status).toBe(429);
    const body = (await response.json()) as {
      error: { code: string; retryAfter?: number };
    };
    expect(body.error.code).toBe("upstream_source_quota");
    expect(body.error.retryAfter).toBeUndefined();
  });

  it("maps an unmatched upstream failure to the non-retryable tool_failed default", async () => {
    const response = await SELF.fetch(
      await authenticatedRequest(
        `/api/tools/search_console_query?siteUrl=https%3A%2F%2Fsimulate-gsc-unknown-failure.example&${BASE_QUERY}`,
      ),
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("tool_failed");
  });
});

describe("search_console_query — allowlist (threat row f)", () => {
  it("returns 404, never dispatching upstream, for a business_* tool name", async () => {
    const before = await callsSnapshot();
    const response = await SELF.fetch(
      await authenticatedRequest("/api/tools/business_reply_review"),
    );
    expect(response.status).toBe(404);
    const after = await callsSnapshot();
    expect(after.calls).toBe(before.calls);
  });
});
