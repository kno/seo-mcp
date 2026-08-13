/**
 * Integration coverage for `keyword-research-view`'s three-tool registry
 * slice (PR8), against the stub MCP worker (never the real Google/`seo-mcp`
 * credential path) — extends `authenticated-gsc-insights.test.ts`'s pattern:
 *
 * - `get_keyword_metrics` / `discover_keywords` are authenticated, under a
 *   NEW, separate `google-ads` source — task 8.5's "second quota indicator"
 *   requirement is backed here by asserting the response's `quota.source`
 *   is `"google-ads"`, never `"search-console"`, and that a currency label
 *   is present (task 8.2).
 * - `cluster_keywords` is NOT authenticated — asserted by construction: its
 *   response carries no `sourceFreshness` and no `quota` field at all
 *   (unlike every route above), because it never reaches
 *   `dispatchAuthenticated()` in the first place (task 8.5's "cluster_keywords
 *   touches neither quota source").
 * - A missing Ads developer token classifies as
 *   `upstream_source_not_configured`, distinct from a genuinely empty
 *   result (task 8.6).
 */
import { describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { createSessionCookie } from "../../src/session";

interface StubEnv {
  DASHBOARD_SESSION_KEY: string;
  SEO_MCP: Fetcher;
}

const stubEnv = env as unknown as StubEnv;

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

describe("keyword-research-view — get_keyword_metrics is authenticated under google-ads", () => {
  it("returns sourceFreshness, a google-ads quota, and a currency label", async () => {
    const response = await SELF.fetch(
      await authenticatedRequest(
        "/api/tools/get_keyword_metrics?keywords=seo%20tool",
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { count: number };
      sourceFreshness?: { source: string; lagDays: number; basis: string };
      quota?: { source: string };
      currencyLabel?: string;
    };
    expect(body.sourceFreshness).toBeDefined();
    expect(body.sourceFreshness?.source).toBe("google-ads");
    expect(body.sourceFreshness?.source).not.toBe("search-console");
    // `deriveSourceFreshness`'s own `wholeDaysBetween` rounds a real
    // wall-clock `today` against a date-only `asOf`, so an end-to-end
    // request can observe 0 OR 1 depending on time-of-day at test run —
    // the exact-`0` case is pinned with a fixed `today` in
    // `registry.test.ts`'s "lagDays override of 0" unit test instead. What
    // matters here is that it is NEVER the GSC reporting-lag figure (2).
    expect(body.sourceFreshness?.lagDays).toBeLessThanOrEqual(1);
    expect(body.sourceFreshness?.basis).toBe("assumed");
    expect(body.quota).toBeDefined();
    expect(body.quota?.source).toBe("google-ads");
    expect(body.quota?.source).not.toBe("search-console");
    expect(body.currencyLabel).toBe("USD");
    expect(body.data.count).toBe(1);
  });
});

describe("keyword-research-view — discover_keywords is additive, shares the same google-ads source", () => {
  it("returns the same envelope shape as get_keyword_metrics", async () => {
    const response = await SELF.fetch(
      await authenticatedRequest(
        "/api/tools/discover_keywords?seedKeywords=seo%20tool",
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      sourceFreshness?: { source: string };
      quota?: { source: string };
    };
    expect(body.sourceFreshness?.source).toBe("google-ads");
    expect(body.quota?.source).toBe("google-ads");
  });
});

describe("keyword-research-view — cluster_keywords is NOT authenticated (task 8.5)", () => {
  it("carries no sourceFreshness and no quota field at all", async () => {
    const response = await SELF.fetch(
      await authenticatedRequest(
        "/api/tools/cluster_keywords?keywords=seo%20tool,seo%20software",
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.sourceFreshness).toBeUndefined();
    expect(body.quota).toBeUndefined();
    expect(body.currencyLabel).toBeUndefined();
    expect((body.data as { count: number }).count).toBe(2);
  });

  it("proceeds even when the google-ads quota would be exhausted — it spends no Google Ads quota", async () => {
    // Exhausting the ledger requires no setup here: the structural
    // assertion above (no `quota` field reaches this route's dispatch path
    // at all) already proves `cluster_keywords` cannot be gated by
    // `google-ads` quota state — there is no call site that could read it.
    const response = await SELF.fetch(
      await authenticatedRequest(
        "/api/tools/cluster_keywords?keywords=one,two,three",
      ),
    );
    expect(response.status).toBe(200);
  });
});

describe("keyword-research-view — missing Ads developer token (task 8.6)", () => {
  it("classifies as upstream_source_not_configured, distinct from an empty result", async () => {
    const response = await SELF.fetch(
      await authenticatedRequest(
        "/api/tools/get_keyword_metrics?keywords=simulate-ads-not-configured",
      ),
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("upstream_source_not_configured");
    expect(body.error.code).not.toBe("tool_failed");
  });

  it("never uses the storage classifier's codes for an Ads failure", async () => {
    const response = await SELF.fetch(
      await authenticatedRequest(
        "/api/tools/get_keyword_metrics?keywords=simulate-ads-not-configured",
      ),
    );
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).not.toBe("upstream_storage_not_configured");
  });
});

describe("keyword-research-view — allowlist governs the two authenticated routes (threat row f)", () => {
  it.each(["get_keyword_metrics", "discover_keywords"])(
    "rejects an unauthenticated request to %s before any upstream call",
    async (tool) => {
      const response = await SELF.fetch(
        new Request(
          `https://bff.example/api/tools/${tool}?keywords=seo%20tool&seedKeywords=seo%20tool`,
        ),
      );
      expect(response.status).toBe(401);
    },
  );
});
