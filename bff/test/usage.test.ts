import { describe, expect, it } from "vitest";
import {
  USAGE_WINDOW_MS,
  getUsageSnapshot,
  recordUpstreamCall,
  resetUsageForTest,
} from "../src/usage";
import { handleRequest } from "../src/router";
import { createSessionCookie } from "../src/session";

function fakeEnv(overrides: Partial<Env> = {}): Env {
  return {
    GATE_STRATEGY: "shared-secret-cookie",
    MCP_ORIGIN: "https://seo-mcp.internal",
    DASHBOARD_SECRET: "top-secret-value",
    DASHBOARD_SESSION_KEY: "session-signing-key",
    MCP_AUTH_TOKEN: "mcp-token",
    SEO_MCP: { fetch: async () => new Response(null) } as unknown as Fetcher,
    ...overrides,
  } as Env;
}

async function authenticatedRequest(env: Env, path: string): Promise<Request> {
  const cookie = await createSessionCookie(
    "dashboard",
    3600,
    env.DASHBOARD_SESSION_KEY,
  );
  return new Request(`https://bff.example${path}`, {
    headers: { cookie: `dashboard_session=${cookie}` },
  });
}

describe("usage accounting — own observed upstream call volume", () => {
  it("starts a fresh window at zero calls", () => {
    resetUsageForTest();
    const snapshot = getUsageSnapshot();
    expect(snapshot.callCount).toBe(0);
  });

  it("increments the observed call count on each recorded upstream call", () => {
    resetUsageForTest();
    recordUpstreamCall();
    recordUpstreamCall();
    const snapshot = getUsageSnapshot();
    expect(snapshot.callCount).toBe(2);
  });

  it("never marks the figure as authoritative — always estimate: true, with an explanatory note", () => {
    resetUsageForTest();
    const snapshot = getUsageSnapshot();
    expect(snapshot.estimate).toBe(true);
    expect(snapshot.note).toMatch(/estimate|not.*authoritative/i);
  });

  it("reports the covered window in seconds", () => {
    resetUsageForTest();
    const snapshot = getUsageSnapshot();
    expect(snapshot.windowSeconds).toBe(USAGE_WINDOW_MS / 1000);
  });

  it("resets the count once the window has fully elapsed", () => {
    const start = 1_000_000;
    resetUsageForTest(start);
    recordUpstreamCall(start + 10);
    expect(getUsageSnapshot(start + 10).callCount).toBe(1);

    recordUpstreamCall(start + USAGE_WINDOW_MS + 1);
    const snapshot = getUsageSnapshot(start + USAGE_WINDOW_MS + 1);
    expect(snapshot.callCount).toBe(1);
    expect(snapshot.windowElapsedSeconds).toBe(0);
  });
});

describe("GET /api/usage — read-only route", () => {
  it("requires authentication before returning any accounting", async () => {
    const env = fakeEnv();
    const response = await handleRequest(
      new Request("https://bff.example/api/usage"),
      env,
    );
    expect(response.status).toBe(401);
  });

  it("returns the observed call volume marked as an estimate, never an authoritative count", async () => {
    resetUsageForTest();
    const env = fakeEnv();
    const request = await authenticatedRequest(env, "/api/usage");
    const response = await handleRequest(request, env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      callCount: number;
      windowSeconds: number;
      estimate: boolean;
      note: string;
    };
    expect(typeof body.callCount).toBe("number");
    expect(body.estimate).toBe(true);
    expect(body.note.length).toBeGreaterThan(0);
  });
});
