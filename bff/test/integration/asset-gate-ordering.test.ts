/**
 * Proves the single most important property Phase 1 (dashboard-views) must
 * demonstrate: the `assets` Cloudflare binding never answers a static asset
 * path before `bff/src/gate.ts` has authorized the request. Without
 * `run_worker_first: true` on the `assets` binding (`bff/wrangler.jsonc`),
 * the Asset Worker answers matching paths BEFORE the user Worker, silently
 * bypassing the gate — this test's unauthenticated cases must fail for
 * exactly that reason until `run_worker_first: true` is set.
 *
 * Runs against the real `SELF` BFF Worker over the real `assets` binding
 * declared in `bff/wrangler.jsonc`, backed by the built `bff/ui/dist`
 * fixture (`pnpm build:ui`, wired as a `pretest` hook).
 */
import { beforeAll, describe, expect, it } from "vitest";
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

// Vite content-hashes the built bundle filename, so it changes whenever
// bff/ui/src changes. This test runs inside the Miniflare/workerd sandbox,
// which does not expose plain Node fs access, so the hash cannot be read
// from disk. Instead, discover it via an authenticated fetch of the real
// built index page — already proven to work in this environment below —
// rather than hardcoding a hash that would silently go stale.
let hashedJsPath: string;

beforeAll(async () => {
  const response = await SELF.fetch(await authenticatedRequest("/"));
  const html = await response.text();
  const match = html.match(/<script[^>]+src="(\/assets\/[^"]+\.js)"/);
  if (!match) {
    throw new Error(
      "Could not find a hashed JS bundle reference in the built index.html",
    );
  }
  hashedJsPath = match[1];
});

describe("BFF asset-gate ordering (integration, real assets binding)", () => {
  const STATIC_PATHS = [
    "/",
    "/index.html",
    "/favicon.ico",
    "/some/unknown/deep-link",
  ];

  for (const path of STATIC_PATHS) {
    it(`rejects an unauthenticated request to ${path} with gate_unauthorized before any asset is served`, async () => {
      const response = await SELF.fetch(`https://bff.example${path}`);
      expect(response.status).toBe(401);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("gate_unauthorized");
    });
  }

  it("rejects an unauthenticated request to the hashed JS bundle with gate_unauthorized", async () => {
    const response = await SELF.fetch(`https://bff.example${hashedJsPath}`);
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("gate_unauthorized");
  });

  it("serves the real built index page for an authenticated request to /", async () => {
    const response = await SELF.fetch(await authenticatedRequest("/"));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("<title>SEO Dashboard</title>");
  });

  it("serves the hashed built JS bundle for an authenticated request", async () => {
    const response = await SELF.fetch(await authenticatedRequest(hashedJsPath));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/javascript/);
  });

  it("falls back to the SPA shell for an authenticated unknown deep link", async () => {
    const response = await SELF.fetch(
      await authenticatedRequest("/some/unknown/deep-link"),
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("<title>SEO Dashboard</title>");
  });
});
