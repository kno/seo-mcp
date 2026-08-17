/**
 * The SPA shell (`/`, hashed assets, unknown deep links) is served
 * unauthenticated — a fresh visitor must be able to load the page
 * containing the login form itself, or they can never submit it. Real
 * data only ever comes from `/api/tools/*`, which stays fully gated
 * (`bff/test/integration/gate-ordering.test.ts` covers that boundary).
 *
 * `run_worker_first: true` on the `assets` binding (`bff/wrangler.jsonc`)
 * is still required, but for a different reason now: without it, the
 * Asset Worker's own `single-page-application` fallback would intercept
 * `/api/tools/*` paths (which match no real file) and serve `index.html`
 * for them directly, before this Worker's routing ever ran — this
 * module's actual gate (`bff/src/gate.ts`) would never even be reached.
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
  // `/favicon.ico` is binary, not HTML — asserted on status only below.
  const HTML_PATHS = ["/", "/index.html", "/some/unknown/deep-link"];

  for (const path of HTML_PATHS) {
    it(`serves the SPA shell for an UNAUTHENTICATED request to ${path} (the login form itself must be reachable without a session)`, async () => {
      const response = await SELF.fetch(`https://bff.example${path}`);
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain("<title>SEO Dashboard</title>");
    });
  }

  it("serves the favicon for an UNAUTHENTICATED request", async () => {
    const response = await SELF.fetch("https://bff.example/favicon.ico");
    expect(response.status).toBe(200);
  });

  it("serves the hashed built JS bundle for an UNAUTHENTICATED request", async () => {
    const response = await SELF.fetch(`https://bff.example${hashedJsPath}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/javascript/);
  });

  it("still rejects an unauthenticated /api/tools/* request with gate_unauthorized (only the static shell is exempt)", async () => {
    const response = await SELF.fetch("https://bff.example/api/tools/health");
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
