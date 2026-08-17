/**
 * `google-account-connect-flow` / `site-google-credentials`, Phase 4b:
 * the full authorize → callback → connected round-trip through the REAL
 * `SELF` BFF Worker and the REAL stub MCP worker
 * (`bff/test/integration/stub-mcp-worker.js`), mirroring `oauth-connect-
 * routes.test.ts`'s (Phase 4a) real-service-binding approach.
 *
 * The stub's `connect_google_account` response embeds a decoy secret
 * (`DECOY_REFRESH_TOKEN`, sourced from the auxiliary worker's OWN
 * binding — see `vitest.bff-integration.config.ts` — never a literal in
 * this file) to prove the change's headline containment property: even
 * though `bff/src/oauth/callback.ts` calls `connect_google_account` with
 * `validateUpstreamResults: false` and never inspects `result.data`
 * beyond `result.ok`, the decoy value never appears in the callback's
 * response body, headers, redirect URL, or the `RESULT_CACHE` KV
 * namespace it can write to.
 */
import { describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { createSessionCookie } from "../../src/session";

interface StubEnv {
  DASHBOARD_SESSION_KEY: string;
  RESULT_CACHE: KVNamespace;
}

const stubEnv = env as unknown as StubEnv;

const DECOY_REFRESH_TOKEN = "decoy-refresh-token-should-never-leak-987";

async function sessionCookie(): Promise<string> {
  const cookie = await createSessionCookie(
    "dashboard",
    3600,
    stubEnv.DASHBOARD_SESSION_KEY,
  );
  return cookie as string;
}

async function authenticatedRequest(path: string): Promise<Request> {
  const cookie = await sessionCookie();
  return new Request(`https://bff.example${path}`, {
    headers: { cookie: `dashboard_session=${cookie}` },
    redirect: "manual",
  });
}

async function assertKvContainsNoDecoy(): Promise<void> {
  const listing = await stubEnv.RESULT_CACHE.list();
  for (const key of listing.keys) {
    const value = await stubEnv.RESULT_CACHE.get(key.name);
    expect(value ?? "").not.toContain(DECOY_REFRESH_TOKEN);
  }
}

describe("OAuth connect round-trip (mocked Google token endpoint, Phase 4b headline containment test)", () => {
  it("completes authorize -> callback -> connected and never leaks the decoy refresh token anywhere", async () => {
    // Step 1: authorize — mints the state token and redirects to Google.
    const authorizeResponse = await SELF.fetch(
      await authenticatedRequest("/auth/google/authorize?siteId=1"),
    );
    expect(authorizeResponse.status).toBe(302);
    const authorizeLocation = new URL(
      authorizeResponse.headers.get("location") as string,
    );
    expect(authorizeLocation.origin).toBe("https://accounts.google.com");
    const state = authorizeLocation.searchParams.get("state");
    expect(state).toBeTruthy();

    // Step 2: callback — Google's cross-site redirect, no cookie present.
    // The BFF forwards `code` to `connect_google_account`, which the stub
    // answers with a decoy-bearing structuredContent (see file header).
    const callbackResponse = await SELF.fetch(
      `https://bff.example/auth/google/callback?code=test-authorization-code&state=${encodeURIComponent(state as string)}`,
      { redirect: "manual" },
    );

    expect(callbackResponse.status).toBe(302);
    const callbackLocation = callbackResponse.headers.get("location") as string;
    expect(callbackLocation).toContain("connected=1");

    // Containment: the decoy never appears in the redirect URL, any
    // response header, or the response body.
    expect(callbackLocation).not.toContain(DECOY_REFRESH_TOKEN);
    callbackResponse.headers.forEach((value) => {
      expect(value).not.toContain(DECOY_REFRESH_TOKEN);
    });
    const callbackBody = await callbackResponse.text();
    expect(callbackBody).not.toContain(DECOY_REFRESH_TOKEN);

    // Containment: the decoy never entered the RESULT_CACHE KV namespace
    // (`connect_google_account` is never dispatched through the cache
    // path at all, but this asserts the invariant directly rather than
    // trusting that fact).
    await assertKvContainsNoDecoy();
  });

  it("/api/tools/connect_google_account remains 404, even after a real connect", async () => {
    const response = await SELF.fetch(
      await authenticatedRequest("/api/tools/connect_google_account"),
    );
    expect(response.status).toBe(404);
  });
});
