/**
 * Integration coverage for `gsc-insight-views`' five-tool registry slice
 * (PR6), against the stub MCP worker (never the real Google/`seo-mcp`
 * credential path) — extends `authenticated-search-console.test.ts`'s
 * pattern to the five new authenticated routes:
 *
 * - The three live-Google tools (`find_striking_distance_keywords`,
 *   `find_low_ctr_opportunities`, `snapshot_search_console`) expose the
 *   required `sourceFreshness` field, exactly like `search_console_query`.
 * - The two D1-only tools (`list_search_console_snapshots`,
 *   `compare_search_console`) classify their OWN "D1 storage is not
 *   configured" / "Need at least two snapshots to compare" texts to the two
 *   new, distinct error codes (task 6.7) — never the Google classifier's
 *   codes, and never the generic `tool_failed` default.
 * - Every one of the five routes still honors the allowlist/containment
 *   properties `registry.test.ts` and `authenticated-search-console.test.ts`
 *   already assert at the unit level; this file does not re-assert threat
 *   rows (a)/(f) again per tool, only what is genuinely new per route.
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

const BASE_QUERY = "startDate=2026-07-01&endDate=2026-07-28";

describe("gsc-insight-views — live-Google tools carry the required sourceFreshness", () => {
  it.each([
    "find_striking_distance_keywords",
    "find_low_ctr_opportunities",
    "snapshot_search_console",
  ])("returns sourceFreshness alongside data for %s", async (tool) => {
    const response = await SELF.fetch(
      await authenticatedRequest(
        `/api/tools/${tool}?siteUrl=https%3A%2F%2Fexample.com&${BASE_QUERY}`,
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: unknown;
      sourceFreshness?: { source: string; basis: string };
    };
    expect(body.sourceFreshness).toBeDefined();
    expect(body.sourceFreshness?.source).toBe("search-console");
    expect(body.sourceFreshness?.basis).toBe("assumed");
  });
});

describe("gsc-insight-views — D1-only tools carry sourceFreshness with no live Google call", () => {
  it("list_search_console_snapshots returns sourceFreshness derived from its own most-recent snapshot", async () => {
    const response = await SELF.fetch(
      await authenticatedRequest(
        "/api/tools/list_search_console_snapshots?siteUrl=https%3A%2F%2Fexample.com",
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { snapshots: Array<{ endDate: string }> };
      sourceFreshness?: { asOf: string };
    };
    expect(body.sourceFreshness).toBeDefined();
    expect(body.sourceFreshness?.asOf).toBeDefined();
  });

  it("compare_search_console returns sourceFreshness and the diff's four named buckets", async () => {
    const response = await SELF.fetch(
      await authenticatedRequest(
        "/api/tools/compare_search_console?siteUrl=https%3A%2F%2Fexample.com",
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        baseSnapshotId: number;
        currentSnapshotId: number;
        diff: {
          decayed: unknown[];
          improved: unknown[];
          lost: unknown[];
          gained: unknown[];
        };
      };
      sourceFreshness?: unknown;
    };
    expect(body.sourceFreshness).toBeDefined();
    expect(body.data.baseSnapshotId).toBe(1);
    expect(body.data.currentSnapshotId).toBe(2);
    expect(body.data.diff.decayed).toHaveLength(1);
    expect(body.data.diff.improved).toHaveLength(1);
    expect(body.data.diff.lost).toHaveLength(1);
    expect(body.data.diff.gained).toHaveLength(1);
  });
});

describe("gsc-insight-views — D1-specific classify-and-discard (task 6.7)", () => {
  it("classifies a missing D1 binding as upstream_storage_not_configured, distinct from tool_failed", async () => {
    const response = await SELF.fetch(
      await authenticatedRequest(
        "/api/tools/list_search_console_snapshots?siteUrl=https%3A%2F%2Fsimulate-d1-not-configured.example",
      ),
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("upstream_storage_not_configured");
  });

  it("classifies fewer-than-two-snapshots as insufficient_snapshots, distinct from an empty diff", async () => {
    const response = await SELF.fetch(
      await authenticatedRequest(
        "/api/tools/compare_search_console?siteUrl=https%3A%2F%2Fsimulate-insufficient-snapshots.example",
      ),
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("insufficient_snapshots");
  });

  it("never uses the Google classifier's codes for a D1-only tool's own failure text", async () => {
    const response = await SELF.fetch(
      await authenticatedRequest(
        "/api/tools/list_search_console_snapshots?siteUrl=https%3A%2F%2Fsimulate-d1-not-configured.example",
      ),
    );
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).not.toBe("upstream_source_not_configured");
  });
});

describe("gsc-insight-views — allowlist still governs every new route (threat row f)", () => {
  it.each([
    "find_striking_distance_keywords",
    "find_low_ctr_opportunities",
    "snapshot_search_console",
    "list_search_console_snapshots",
    "compare_search_console",
  ])(
    "rejects an unauthenticated request to %s before any upstream call",
    async (tool) => {
      const response = await SELF.fetch(
        new Request(
          `https://bff.example/api/tools/${tool}?siteUrl=https%3A%2F%2Fexample.com&${BASE_QUERY}`,
        ),
      );
      expect(response.status).toBe(401);
    },
  );
});
