/**
 * Auxiliary stub MCP Worker for the `bff-integration` project.
 *
 * Bound as the `SEO_MCP` service-binding target (name `seo-mcp`, matching
 * `bff/wrangler.jsonc`'s `services[0].service`), replacing the real
 * `seo-mcp` Worker for this test project only. It exists to make two
 * properties observable from the real service binding, not from a mocked
 * `env.SEO_MCP`:
 *
 * - `GET /__calls` — a module-level call counter, used by
 *   `gate-ordering.test.ts` to assert the gate-before-dispatch property.
 * - The `Authorization` header on every forwarded `tools/call` request,
 *   asserted per route in `routes.test.ts`.
 *
 * A request can ask this stub to simulate an upstream transport failure by
 * passing a `url` tool argument containing `simulate-401`, `simulate-429`,
 * or `simulate-503` (e.g. `https://simulate-503.example/page`) — this is
 * how `routes.test.ts` exercises the BFF's upstream status mapping
 * without depending on the real, unsimulatable ratelimit binding
 * (respects `ROADMAP.md:20`). The trigger is read from the tool argument
 * rather than a custom header, since the BFF's `mcp-client.ts` does not
 * forward arbitrary incoming headers to the upstream call — only the
 * `Authorization` header it injects itself.
 *
 * Plain JavaScript (not TypeScript): auxiliary `miniflare.workers` entries
 * are loaded directly by workerd, without the Vite/TypeScript transform
 * `wrangler: { configPath }` applies to the primary worker under test.
 */

let calls = 0;
let lastAuthorizationHeader = null;

const HEALTH_STRUCTURED_CONTENT = {
  status: "ok",
  service: "seo-mcp",
  version: "0.1.0",
};

const TOOL_RESULTS = {
  health: HEALTH_STRUCTURED_CONTENT,
  crawl_page: {
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
  },
  check_links: {
    url: "https://example.com",
    pageStatus: 200,
    checked: 1,
    ok: 1,
    broken: 0,
    errors: 0,
    results: [],
  },
  analyze_pagespeed: {
    url: "https://example.com",
    strategy: "mobile",
    labMetrics: {},
    opportunities: [],
  },
};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/__calls") {
      return Response.json({ calls, lastAuthorizationHeader });
    }

    calls++;
    lastAuthorizationHeader = request.headers.get("authorization");

    const body = await request.json();
    const toolName = body?.params?.name;
    const argUrl = body?.params?.arguments?.url ?? "";

    if (argUrl.includes("simulate-401")) {
      return new Response("Unauthorized", {
        status: 401,
        headers: { "www-authenticate": 'Bearer realm="seo-mcp"' },
      });
    }
    if (argUrl.includes("simulate-429")) {
      return new Response("Too many requests", {
        status: 429,
        headers: { "retry-after": "60" },
      });
    }
    if (argUrl.includes("simulate-503")) {
      return new Response("Service unavailable", { status: 503 });
    }

    const structuredContent =
      TOOL_RESULTS[toolName] ?? HEALTH_STRUCTURED_CONTENT;
    return Response.json({
      jsonrpc: "2.0",
      id: "stub",
      result: {
        content: [{ type: "text", text: "ok" }],
        structuredContent,
      },
    });
  },
};
