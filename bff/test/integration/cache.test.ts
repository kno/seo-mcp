/**
 * Integration coverage for Phase 4's result cache: real KV read/write/TTL
 * against the actual `RESULT_CACHE` binding declared in
 * `bff/wrangler.jsonc`, exercised through the real `SELF` BFF Worker (not
 * a mocked `env.RESULT_CACHE`). `isolatedStorage` is the
 * `@cloudflare/vitest-pool-workers` default, so KV state does not leak
 * between test files/cases.
 */
import { describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { createSessionCookie } from "../../src/session";

interface StubEnv {
  DASHBOARD_SESSION_KEY: string;
  SEO_MCP: Fetcher;
}

const stubEnv = env as unknown as StubEnv;

async function stubCallCount(): Promise<number> {
  const response = await stubEnv.SEO_MCP.fetch("http://stub-mcp/__calls");
  const body = (await response.json()) as { calls: number };
  return body.calls;
}

async function authenticatedRequest(
  path: string,
  init: RequestInit = {},
): Promise<Request> {
  const cookie = await createSessionCookie(
    "dashboard",
    3600,
    stubEnv.DASHBOARD_SESSION_KEY,
  );
  return new Request(`https://bff.example${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), cookie: `dashboard_session=${cookie}` },
  });
}

describe("BFF result cache (integration, real KV)", () => {
  it("serves a repeated identical request from cache without a second upstream call", async () => {
    const before = await stubCallCount();

    const first = await SELF.fetch(
      await authenticatedRequest(
        "/api/tools/crawl_page?url=https%3A%2F%2Fcache-once.example",
      ),
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      cacheStatus: string;
      resultAge: number;
    };
    expect(firstBody.cacheStatus).toBe("miss");
    expect(await stubCallCount()).toBe(before + 1);

    const second = await SELF.fetch(
      await authenticatedRequest(
        "/api/tools/crawl_page?url=https%3A%2F%2Fcache-once.example",
      ),
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as {
      cacheStatus: string;
      resultAge: number;
    };
    expect(secondBody.cacheStatus).toBe("hit");
    expect(secondBody.resultAge).toBeGreaterThanOrEqual(0);
    // Still only ONE upstream call total — the second request was served
    // entirely from KV.
    expect(await stubCallCount()).toBe(before + 1);
  });

  it("does not coalesce a different request under the same key", async () => {
    const before = await stubCallCount();

    await SELF.fetch(
      await authenticatedRequest(
        "/api/tools/crawl_page?url=https%3A%2F%2Fcache-a.example",
      ),
    );
    await SELF.fetch(
      await authenticatedRequest(
        "/api/tools/crawl_page?url=https%3A%2F%2Fcache-b.example",
      ),
    );

    expect(await stubCallCount()).toBe(before + 2);
  });

  it("bypasses the cache read with ?refresh=1 but still repopulates it", async () => {
    const before = await stubCallCount();

    await SELF.fetch(
      await authenticatedRequest(
        "/api/tools/crawl_page?url=https%3A%2F%2Fcache-refresh.example",
      ),
    );
    expect(await stubCallCount()).toBe(before + 1);

    const refreshed = await SELF.fetch(
      await authenticatedRequest(
        "/api/tools/crawl_page?url=https%3A%2F%2Fcache-refresh.example&refresh=1",
      ),
    );
    expect(refreshed.status).toBe(200);
    // refresh=1 forces a real upstream call even though a cached entry
    // already exists.
    expect(await stubCallCount()).toBe(before + 2);

    // The refresh call's result was written back, so the next plain
    // request is served from cache again without a third upstream call.
    const third = await SELF.fetch(
      await authenticatedRequest(
        "/api/tools/crawl_page?url=https%3A%2F%2Fcache-refresh.example",
      ),
    );
    const thirdBody = (await third.json()) as { cacheStatus: string };
    expect(thirdBody.cacheStatus).toBe("hit");
    expect(await stubCallCount()).toBe(before + 2);
  });

  it("never caches an analyze_pagespeed request carrying an explicit apiKey", async () => {
    const before = await stubCallCount();
    const requestInit: RequestInit = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://example.com",
        apiKey: "secret-key",
      }),
    };

    const first = await SELF.fetch(
      await authenticatedRequest("/api/tools/analyze_pagespeed", requestInit),
    );
    const firstBody = (await first.json()) as { cacheStatus: string };
    expect(firstBody.cacheStatus).toBe("bypass");
    expect(await stubCallCount()).toBe(before + 1);

    const second = await SELF.fetch(
      await authenticatedRequest("/api/tools/analyze_pagespeed", requestInit),
    );
    const secondBody = (await second.json()) as { cacheStatus: string };
    expect(secondBody.cacheStatus).toBe("bypass");
    // Every apiKey-bearing request reaches upstream — never served from
    // cache, since it is never written to the cache in the first place.
    expect(await stubCallCount()).toBe(before + 2);
  });

  it("rejects an apiKey supplied over GET even though the route otherwise accepts query-string input", async () => {
    const response = await SELF.fetch(
      await authenticatedRequest(
        "/api/tools/analyze_pagespeed?url=https%3A%2F%2Fexample.com&apiKey=secret-key",
      ),
    );
    expect(response.status).toBe(400);
  });

  it("never caches list_search_console_snapshots (a deleted snapshot must never keep appearing in a stale cached list until its TTL elapses)", async () => {
    const before = await stubCallCount();
    const path =
      "/api/tools/list_search_console_snapshots?siteUrl=https%3A%2F%2Fcache-never.example";

    const first = await SELF.fetch(await authenticatedRequest(path));
    const firstBody = (await first.json()) as { cacheStatus: string };
    expect(firstBody.cacheStatus).toBe("bypass");
    expect(await stubCallCount()).toBe(before + 1);

    const second = await SELF.fetch(await authenticatedRequest(path));
    const secondBody = (await second.json()) as { cacheStatus: string };
    expect(secondBody.cacheStatus).toBe("bypass");
    // A second identical request must reach the stub again -- proof it was
    // never written to the cache, not just that this call skipped reading it.
    expect(await stubCallCount()).toBe(before + 2);
  });

  it("never caches list_crawl_snapshots, for the same reason", async () => {
    const before = await stubCallCount();
    const path =
      "/api/tools/list_crawl_snapshots?url=https%3A%2F%2Fcache-never-crawl.example";

    const first = await SELF.fetch(await authenticatedRequest(path));
    const firstBody = (await first.json()) as { cacheStatus: string };
    expect(firstBody.cacheStatus).toBe("bypass");
    expect(await stubCallCount()).toBe(before + 1);

    const second = await SELF.fetch(await authenticatedRequest(path));
    const secondBody = (await second.json()) as { cacheStatus: string };
    expect(secondBody.cacheStatus).toBe("bypass");
    expect(await stubCallCount()).toBe(before + 2);
  });
});
