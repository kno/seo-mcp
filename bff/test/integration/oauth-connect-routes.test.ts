/**
 * `google-account-connect-flow` / `dashboard-bff`: structural, allowlist
 * invariants that hold even before Phase 4b's `connect_google_account`
 * tool exists — `connect_google_account` is never reachable through the
 * generic `/api/tools/{tool}` dispatch path, and the authorize/callback
 * routes are individually enumerated string matches, not a wildcard or
 * pattern. Runs against the real `SELF` BFF Worker wired to the stub MCP
 * auxiliary worker, over the real `services` binding declared in
 * `bff/wrangler.jsonc`.
 */
import { describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { createSessionCookie } from "../../src/session";

interface StubEnv {
  DASHBOARD_SESSION_KEY: string;
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

describe("OAuth connect routes (allowlist invariants, design's route table)", () => {
  it("/api/tools/connect_google_account 404s even for an authenticated request", async () => {
    const response = await SELF.fetch(
      await authenticatedRequest("/api/tools/connect_google_account"),
    );
    expect(response.status).toBe(404);
  });

  it("a similarly-shaped-but-wrong authorize path does not match", async () => {
    const response = await SELF.fetch(
      await authenticatedRequest("/auth/google/authorized?siteId=1"),
    );
    expect(response.status).not.toBe(302);
  });

  it("the authorize route requires authentication (gate_unauthorized, no redirect)", async () => {
    const response = await SELF.fetch(
      "https://bff.example/auth/google/authorize?siteId=1",
    );
    expect(response.status).toBe(401);
  });

  it("the callback route is reachable with no session cookie at all", async () => {
    const response = await SELF.fetch(
      "https://bff.example/auth/google/callback?code=x&state=y",
      { redirect: "manual" },
    );
    // Rejected by state verification (malformed/forged), not by the
    // session gate — a 401 here would mean the pre-gate placement failed.
    expect(response.status).toBe(302);
    const location = response.headers.get("location") as string;
    expect(location).toContain("connect_error=state_invalid");
  });
});
