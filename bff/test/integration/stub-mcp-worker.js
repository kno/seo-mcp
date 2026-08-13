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
 * `search_console_query` (`authenticated-search-console.test.ts`) adds a
 * second family of `isError` triggers, read from `siteUrl` instead of
 * `url`, that simulate the four `classify.ts` outcomes with Google-shaped
 * error text — including a decoy credential literal
 * (`DECOY_REFRESH_TOKEN_xyz789`) in the not-configured/credential/quota
 * texts, so the containment sweep has something real to assert is
 * discarded: `simulate-gsc-not-configured`, `simulate-gsc-credential-
 * failure`, `simulate-gsc-quota`, `simulate-gsc-unknown-failure`.
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
    linksFound: 1,
    truncated: false,
  },
  analyze_pagespeed: {
    url: "https://example.com",
    strategy: "mobile",
    labMetrics: {},
    opportunities: [],
  },
  search_console_query: {
    siteUrl: "https://example.com",
    startDate: "2026-07-01",
    endDate: "2026-07-28",
    dimensions: ["query", "page"],
    rowCount: 1,
    rows: [
      {
        keys: ["seo mcp", "/"],
        clicks: 10,
        impressions: 100,
        ctr: 0.1,
        position: 5.2,
      },
    ],
  },
};

const DECOY_CREDENTIAL = "DECOY_REFRESH_TOKEN_xyz789";

const GSC_ERROR_TEXTS = {
  "simulate-gsc-not-configured": "Google credentials are not configured",
  "simulate-gsc-credential-failure": `OAuth token exchange failed: invalid_grant ${DECOY_CREDENTIAL}`,
  "simulate-gsc-quota": `Search Analytics API error: quota exceeded ${DECOY_CREDENTIAL}`,
  "simulate-gsc-unknown-failure": `Unexpected upstream failure ${DECOY_CREDENTIAL}`,
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
    const argSiteUrl = body?.params?.arguments?.siteUrl ?? "";

    for (const [trigger, text] of Object.entries(GSC_ERROR_TEXTS)) {
      if (argSiteUrl.includes(trigger)) {
        return Response.json({
          jsonrpc: "2.0",
          id: "stub",
          result: { content: [{ type: "text", text }], isError: true },
        });
      }
    }

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
