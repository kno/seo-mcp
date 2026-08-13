/**
 * Integration coverage for `analyze_domain`'s classify-and-discard path —
 * task 10.9 (threat row g). Unlike every other authenticated tool's
 * `isError` failure path (`authenticated-search-console.test.ts`),
 * `analyze_domain`'s `gscError` rides an otherwise-SUCCESSFUL
 * `structuredContent` payload (a 200-OK `DomainReport`), so this decoy
 * sweep asserts the leak path the unit test
 * (`bff/test/authenticated/domain-report.test.ts`) cannot exercise:
 * end-to-end, through `dispatchAuthenticated()`'s real cache-write and
 * response-serialization path, not just the pure transform function.
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

const BASE_QUERY =
  "url=https%3A%2F%2Fexample.com&startDate=2026-07-01&endDate=2026-07-28";

describe("analyze_domain - nested gscError classify-and-discard (threat row g)", () => {
  it("never forwards the decoy credential embedded in a success-payload gscError", async () => {
    const response = await SELF.fetch(
      await authenticatedRequest(
        `/api/tools/analyze_domain?${BASE_QUERY}&gscProperty=simulate-domain-enrichment-failure.example`,
      ),
    );
    expect(response.status).toBe(200);
    const bodyText = await response.text();
    expect(bodyText).not.toContain(DECOY_CREDENTIAL);
    expect(bodyText).not.toContain("invalid_grant");

    const body = JSON.parse(bodyText) as {
      data: {
        gscError?: unknown;
        enrichmentError?: { code: string };
        crawl: unknown;
      };
    };
    expect(body.data.gscError).toBeUndefined();
    expect(body.data.enrichmentError).toEqual({
      code: "upstream_credential_failure",
    });
    expect(body.data.crawl).toBeDefined();
  });

  it("renders the not-requested state distinctly (no search, no enrichmentError)", async () => {
    const response = await SELF.fetch(
      await authenticatedRequest(
        `/api/tools/analyze_domain?url=https%3A%2F%2Fexample.com`,
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { search?: unknown; gscError?: unknown; enrichmentError?: unknown };
    };
    expect(body.data.search).toBeUndefined();
    expect(body.data.gscError).toBeUndefined();
    expect(body.data.enrichmentError).toBeUndefined();
  });
});
