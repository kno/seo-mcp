import { describe, expect, it, vi } from "vitest";
import { handleRequest } from "../src/router";
import { createSessionCookie } from "../src/session";

function stubHealthFetch() {
  return vi.fn(async () =>
    Response.json({
      jsonrpc: "2.0",
      id: "1",
      result: {
        structuredContent: {
          status: "ok",
          service: "seo-mcp",
          version: "0.1.0",
        },
      },
    }),
  );
}

function fakeEnv(overrides: Partial<Env> = {}): Env {
  return {
    GATE_STRATEGY: "shared-secret-cookie",
    MCP_ORIGIN: "https://seo-mcp.internal",
    DASHBOARD_SECRET: "top-secret-value",
    DASHBOARD_SESSION_KEY: "session-signing-key",
    MCP_AUTH_TOKEN: "mcp-token",
    SEO_MCP: { fetch: stubHealthFetch() } as unknown as Fetcher,
    ...overrides,
  } as Env;
}

async function authenticatedRequest(
  env: Env,
  path: string,
  init: RequestInit = {},
): Promise<Request> {
  const cookie = await createSessionCookie(
    "dashboard",
    3600,
    env.DASHBOARD_SESSION_KEY,
  );
  return new Request(`https://bff.example${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), cookie: `dashboard_session=${cookie}` },
  });
}

describe("router — gate authorizes before any upstream dispatch", () => {
  it("rejects an unauthenticated health request before calling SEO_MCP", async () => {
    const env = fakeEnv();
    const response = await handleRequest(
      new Request("https://bff.example/api/tools/health"),
      env,
    );
    expect(response.status).toBe(401);
    expect(env.SEO_MCP.fetch).not.toHaveBeenCalled();
  });

  it("returns the health tool result for an authenticated request", async () => {
    const env = fakeEnv();
    const request = await authenticatedRequest(env, "/api/tools/health");
    const response = await handleRequest(request, env);
    expect(response.status).toBe(200);
    expect(env.SEO_MCP.fetch).toHaveBeenCalledOnce();
    const body = (await response.json()) as { data: unknown };
    expect(body.data).toEqual({
      status: "ok",
      service: "seo-mcp",
      version: "0.1.0",
    });
  });

  it("injects the shared bearer token only on the SEO_MCP fetch, and never elsewhere", async () => {
    const env = fakeEnv();
    const request = await authenticatedRequest(env, "/api/tools/health");
    const response = await handleRequest(request, env);
    const [upstreamRequest] = (env.SEO_MCP.fetch as ReturnType<typeof vi.fn>)
      .mock.calls[0] as [Request];
    expect(upstreamRequest.headers.get("authorization")).toBe(
      `Bearer ${env.MCP_AUTH_TOKEN}`,
    );
    expect(response.headers.get("authorization")).toBeNull();
    const bodyText = JSON.stringify(await response.clone().json());
    expect(bodyText).not.toContain(env.MCP_AUTH_TOKEN);
  });

  it("returns 404 for an unknown tool route without calling SEO_MCP", async () => {
    const env = fakeEnv();
    const request = await authenticatedRequest(
      env,
      "/api/tools/does-not-exist",
    );
    const response = await handleRequest(request, env);
    expect(response.status).toBe(404);
    expect(env.SEO_MCP.fetch).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request to an unknown route before any routing decision", async () => {
    const env = fakeEnv();
    const response = await handleRequest(
      new Request("https://bff.example/api/tools/does-not-exist"),
      env,
    );
    expect(response.status).toBe(401);
    expect(env.SEO_MCP.fetch).not.toHaveBeenCalled();
  });

  it("allows POST /auth/session without a prior session, since it is the login endpoint itself", async () => {
    const env = fakeEnv();
    const request = new Request("https://bff.example/auth/session", {
      method: "POST",
      body: JSON.stringify({ secret: env.DASHBOARD_SECRET }),
    });
    const response = await handleRequest(request, env);
    expect(response.status).toBe(204);
    expect(env.SEO_MCP.fetch).not.toHaveBeenCalled();
  });

  it("maps an upstream failure on the health route to a normalized error, never a silent success", async () => {
    const env = fakeEnv({
      SEO_MCP: {
        fetch: vi.fn(
          async () => new Response("Service Unavailable", { status: 503 }),
        ),
      } as unknown as Fetcher,
    });
    const request = await authenticatedRequest(env, "/api/tools/health");
    const response = await handleRequest(request, env);
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("upstream_unavailable");
  });
});

function stubToolFetch(structuredContent: unknown) {
  return vi.fn(async () =>
    Response.json({
      jsonrpc: "2.0",
      id: "1",
      result: { structuredContent },
    }),
  );
}

describe("router — crawl_page input validation", () => {
  it("rejects a request missing the required url", async () => {
    const env = fakeEnv();
    const request = await authenticatedRequest(env, "/api/tools/crawl_page");
    const response = await handleRequest(request, env);
    expect(response.status).toBe(400);
    expect(env.SEO_MCP.fetch).not.toHaveBeenCalled();
  });

  it("rejects a non-URL value for url", async () => {
    const env = fakeEnv();
    const request = await authenticatedRequest(
      env,
      "/api/tools/crawl_page?url=not-a-url",
    );
    const response = await handleRequest(request, env);
    expect(response.status).toBe(400);
    expect(env.SEO_MCP.fetch).not.toHaveBeenCalled();
  });

  it("dispatches a valid request to the MCP tool", async () => {
    const env = fakeEnv({
      SEO_MCP: {
        fetch: stubToolFetch({
          url: "https://example.com",
          status: 200,
          bytesRead: 10,
          title: "t",
          description: "d",
          h1: [],
          h2: [],
          h3: [],
          links: [],
          internalLinkTargets: [],
          internalLinks: 0,
          externalLinks: 0,
          imageCount: 0,
          imagesMissingAlt: 0,
          openGraph: {},
          jsonLd: { blocks: 0, types: [], invalid: 0 },
          wordCount: 0,
          indexable: true,
          issues: [],
        }),
      } as unknown as Fetcher,
    });
    const request = await authenticatedRequest(
      env,
      "/api/tools/crawl_page?url=https%3A%2F%2Fexample.com",
    );
    const response = await handleRequest(request, env);
    expect(response.status).toBe(200);
    expect(env.SEO_MCP.fetch).toHaveBeenCalledOnce();
  });
});

describe("router — crawl_site input validation", () => {
  it("rejects a limit outside 1-20 before calling the MCP tool", async () => {
    const env = fakeEnv();
    const request = await authenticatedRequest(
      env,
      "/api/tools/crawl_site?url=https%3A%2F%2Fexample.com&limit=21",
    );
    const response = await handleRequest(request, env);
    expect(response.status).toBe(400);
    expect(env.SEO_MCP.fetch).not.toHaveBeenCalled();
  });

  it("rejects a concurrency outside 1-4 before calling the MCP tool", async () => {
    const env = fakeEnv();
    const request = await authenticatedRequest(
      env,
      "/api/tools/crawl_site?url=https%3A%2F%2Fexample.com&concurrency=5",
    );
    const response = await handleRequest(request, env);
    expect(response.status).toBe(400);
    expect(env.SEO_MCP.fetch).not.toHaveBeenCalled();
  });

  it("accepts limit and concurrency at their default values when omitted", async () => {
    const env = fakeEnv({
      SEO_MCP: {
        fetch: stubToolFetch({
          site: "https://example.com",
          sitemap: "https://example.com/sitemap.xml",
          sitemapFound: true,
          crawlPolicy: {
            robotsUrl: "https://example.com/robots.txt",
            robotsFound: false,
            userAgent: "seo-mcp",
            sitemapsDeclared: [],
            disallowedSkipped: { count: 0, sample: [] },
          },
          requested: 1,
          crawled: 1,
          failed: 0,
          documentsRead: 1,
          subrequests: 1,
          bytesRead: 1,
          outputBytes: 1,
          pages: [],
          issueCounts: {},
          summary: {
            pagesAnalyzed: 1,
            duplicateTitles: [],
            duplicateDescriptions: [],
            missingH1: { count: 0, sample: [] },
            multipleH1: { count: 0, sample: [] },
            thinContent: { count: 0, sample: [] },
            nonIndexable: { count: 0, sample: [] },
            imagesMissingAlt: { pages: 0, images: 0 },
          },
          linkGraph: {
            crawledPages: 1,
            orphanPages: { count: 0, sample: [] },
            topLinkedPages: [],
          },
        }),
      } as unknown as Fetcher,
    });
    const request = await authenticatedRequest(
      env,
      "/api/tools/crawl_site?url=https%3A%2F%2Fexample.com",
    );
    const response = await handleRequest(request, env);
    expect(response.status).toBe(200);
    expect(env.SEO_MCP.fetch).toHaveBeenCalledOnce();
  });
});

describe("router — check_links input validation", () => {
  it("rejects a request missing the required url", async () => {
    const env = fakeEnv();
    const request = await authenticatedRequest(env, "/api/tools/check_links");
    const response = await handleRequest(request, env);
    expect(response.status).toBe(400);
    expect(env.SEO_MCP.fetch).not.toHaveBeenCalled();
  });

  it("dispatches a valid request to the MCP tool", async () => {
    const env = fakeEnv({
      SEO_MCP: {
        fetch: stubToolFetch({
          url: "https://example.com",
          pageStatus: 200,
          checked: 1,
          ok: 1,
          broken: 0,
          errors: 0,
          results: [],
        }),
      } as unknown as Fetcher,
    });
    const request = await authenticatedRequest(
      env,
      "/api/tools/check_links?url=https%3A%2F%2Fexample.com",
    );
    const response = await handleRequest(request, env);
    expect(response.status).toBe(200);
    expect(env.SEO_MCP.fetch).toHaveBeenCalledOnce();
  });
});

describe("router — analyze_pagespeed input validation", () => {
  it("rejects an invalid strategy", async () => {
    const env = fakeEnv();
    const request = await authenticatedRequest(
      env,
      "/api/tools/analyze_pagespeed?url=https%3A%2F%2Fexample.com&strategy=tablet",
    );
    const response = await handleRequest(request, env);
    expect(response.status).toBe(400);
    expect(env.SEO_MCP.fetch).not.toHaveBeenCalled();
  });

  it("accepts an omitted apiKey (optional field)", async () => {
    const env = fakeEnv({
      SEO_MCP: {
        fetch: stubToolFetch({
          url: "https://example.com",
          strategy: "mobile",
          labMetrics: {},
          opportunities: [],
        }),
      } as unknown as Fetcher,
    });
    const request = await authenticatedRequest(
      env,
      "/api/tools/analyze_pagespeed?url=https%3A%2F%2Fexample.com",
    );
    const response = await handleRequest(request, env);
    expect(response.status).toBe(200);
    expect(env.SEO_MCP.fetch).toHaveBeenCalledOnce();
  });

  it("rejects an apiKey supplied over GET — it must travel over POST instead", async () => {
    const env = fakeEnv();
    const request = await authenticatedRequest(
      env,
      "/api/tools/analyze_pagespeed?url=https%3A%2F%2Fexample.com&strategy=desktop&apiKey=secret-key",
    );
    const response = await handleRequest(request, env);
    expect(response.status).toBe(400);
    expect(env.SEO_MCP.fetch).not.toHaveBeenCalled();
  });

  it("accepts an explicit apiKey over POST and never echoes it back in the response", async () => {
    const env = fakeEnv({
      SEO_MCP: {
        fetch: stubToolFetch({
          url: "https://example.com",
          strategy: "desktop",
          labMetrics: {},
          opportunities: [],
        }),
      } as unknown as Fetcher,
    });
    const request = await authenticatedRequest(
      env,
      "/api/tools/analyze_pagespeed",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://example.com",
          strategy: "desktop",
          apiKey: "secret-key",
        }),
      },
    );
    const response = await handleRequest(request, env);
    expect(response.status).toBe(200);
    const bodyText = JSON.stringify(await response.clone().json());
    expect(bodyText).not.toContain("secret-key");
  });
});
