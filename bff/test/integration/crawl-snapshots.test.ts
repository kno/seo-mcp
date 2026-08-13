/**
 * Integration coverage for `history-comparison-view`'s crawl-snapshot
 * family (PR11), against the stub MCP worker (never a real crawl) —
 * `snapshot_crawl`/`list_crawl_snapshots`/`compare_crawls` are NOT
 * authenticated (see `authenticated/registry.ts`'s doc comment): no
 * `dashboard_session` cookie is required, and no `sourceFreshness`/`quota`
 * envelope field is present — an ordinary `dispatch()` response, exactly
 * like `crawl_site`/`cluster_keywords`.
 *
 * - The three routes classify their OWN "D1 storage is not configured" /
 *   "Need at least two crawl snapshots to compare" texts to the same two
 *   distinct error codes the GSC-snapshot family uses (task 11.6), despite
 *   going through the non-authenticated `dispatch()` path.
 * - `compare_crawls`' diff carries the crawl-specific five-field shape
 *   (`newPages`/`removedPages`/`newIssues`/`resolvedIssues`/
 *   `issueCountDeltas`), never the GSC family's four-bucket shape.
 */
import { describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { createSessionCookie } from "../../src/session";

interface StubEnv {
  DASHBOARD_SESSION_KEY: string;
  SEO_MCP: Fetcher;
}

const stubEnv = env as unknown as StubEnv;

/**
 * The dashboard session gate (`gate.ts#authenticate`) runs BEFORE dispatch
 * for EVERY `/api/tools/*` route, including a NON-authenticated-source one
 * like `snapshot_crawl` — this is the login gate, a DIFFERENT mechanism
 * from `authenticated/registry.ts`'s allowlist (which governs
 * `sourceFreshness`/quota, not login). A logged-in request to
 * `snapshot_crawl` still gets no `sourceFreshness`/`quota` field at all.
 */
async function loggedInRequest(path: string): Promise<Request> {
  const cookie = await createSessionCookie(
    "dashboard",
    3600,
    stubEnv.DASHBOARD_SESSION_KEY,
  );
  return new Request(`https://bff.example${path}`, {
    headers: { cookie: `dashboard_session=${cookie}` },
  });
}

describe("history-comparison-view — crawl-snapshot family carries no authenticated-source envelope", () => {
  it("snapshot_crawl returns an ordinary BffOk envelope with no sourceFreshness/quota", async () => {
    const response = await SELF.fetch(
      await loggedInRequest(
        "/api/tools/snapshot_crawl?url=https%3A%2F%2Fexample.com",
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { snapshotId: number; url: string };
      sourceFreshness?: unknown;
      quota?: unknown;
    };
    expect(body.data.snapshotId).toBeDefined();
    expect(body.sourceFreshness).toBeUndefined();
    expect(body.quota).toBeUndefined();
  });

  it("list_crawl_snapshots and compare_crawls also carry no sourceFreshness/quota", async () => {
    const listResponse = await SELF.fetch(
      await loggedInRequest(
        "/api/tools/list_crawl_snapshots?url=https%3A%2F%2Fexample.com",
      ),
    );
    expect(listResponse.status).toBe(200);
    const listBody = (await listResponse.json()) as {
      sourceFreshness?: unknown;
    };
    expect(listBody.sourceFreshness).toBeUndefined();

    const compareResponse = await SELF.fetch(
      await loggedInRequest(
        "/api/tools/compare_crawls?url=https%3A%2F%2Fexample.com",
      ),
    );
    expect(compareResponse.status).toBe(200);
    const compareBody = (await compareResponse.json()) as {
      sourceFreshness?: unknown;
    };
    expect(compareBody.sourceFreshness).toBeUndefined();
  });

  it("compare_crawls returns the crawl-specific five-field diff shape, never the GSC family's four buckets", async () => {
    const response = await SELF.fetch(
      await loggedInRequest(
        "/api/tools/compare_crawls?url=https%3A%2F%2Fexample.com",
      ),
    );
    const body = (await response.json()) as {
      data: {
        diff: {
          newPages: unknown[];
          removedPages: unknown[];
          newIssues: unknown[];
          resolvedIssues: unknown[];
          issueCountDeltas: Record<string, number>;
        };
      };
    };
    expect(body.data.diff.newPages).toHaveLength(1);
    expect(body.data.diff.removedPages).toHaveLength(1);
    expect(body.data.diff.newIssues).toHaveLength(1);
    expect(body.data.diff.resolvedIssues).toHaveLength(1);
    expect(body.data.diff.issueCountDeltas).toBeDefined();
    expect(body.data.diff).not.toHaveProperty("decayed");
    expect(body.data.diff).not.toHaveProperty("improved");
  });
});

describe("history-comparison-view — crawl-snapshot D1-specific classify-and-discard (task 11.6)", () => {
  it("classifies a missing D1 binding as upstream_storage_not_configured, distinct from tool_failed", async () => {
    const response = await SELF.fetch(
      await loggedInRequest(
        "/api/tools/list_crawl_snapshots?url=https%3A%2F%2Fsimulate-crawl-d1-not-configured.example",
      ),
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("upstream_storage_not_configured");
  });

  it("classifies fewer-than-two-crawl-snapshots as insufficient_snapshots, distinct from an empty diff", async () => {
    const response = await SELF.fetch(
      await loggedInRequest(
        "/api/tools/compare_crawls?url=https%3A%2F%2Fsimulate-crawl-insufficient-snapshots.example",
      ),
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("insufficient_snapshots");
  });

  it("never uses the Google classifier's codes for the crawl family's own failure text", async () => {
    const response = await SELF.fetch(
      await loggedInRequest(
        "/api/tools/list_crawl_snapshots?url=https%3A%2F%2Fsimulate-crawl-d1-not-configured.example",
      ),
    );
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).not.toBe("upstream_source_not_configured");
  });

  it("the GSC family's own insufficient_snapshots trigger text does not accidentally match a crawl-family route", async () => {
    // The two families raise DIFFERENT literal error strings by design
    // (src/server.ts: "Need at least two snapshots to compare" vs. "Need at
    // least two crawl snapshots to compare"). A crawl-family url built from
    // the GSC trigger's own name is not one of `compare_crawls`' matched
    // triggers at all, so it never raises isError — it round-trips as an
    // ordinary successful comparison instead of accidentally cross-matching.
    const response = await SELF.fetch(
      await loggedInRequest(
        "/api/tools/compare_crawls?url=https%3A%2F%2Fsimulate-insufficient-snapshots.example",
      ),
    );
    expect(response.status).toBe(200);
  });
});

describe("history-comparison-view — crawl-snapshot routes still require the dashboard session gate", () => {
  it.each(["snapshot_crawl", "list_crawl_snapshots", "compare_crawls"])(
    "rejects an unauthenticated request to %s before any upstream call",
    async (tool) => {
      const response = await SELF.fetch(
        new Request(
          `https://bff.example/api/tools/${tool}?url=https%3A%2F%2Fexample.com`,
        ),
      );
      expect(response.status).toBe(401);
    },
  );
});
