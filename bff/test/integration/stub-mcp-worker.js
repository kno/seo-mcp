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
 * `gsc-insight-views` (`authenticated-gsc-insights.test.ts`, PR6) adds a
 * third family of `isError` triggers, ALSO read from `siteUrl`, that
 * simulate `classify.ts#classifyStorageFailure`'s two OWN (non-Google)
 * texts: `simulate-d1-not-configured` ("D1 storage is not configured") and
 * `simulate-insufficient-snapshots` ("Need at least two snapshots to
 * compare") — the exact strings `src/server.ts` raises for its three
 * D1-backed snapshot tools.
 *
 * `keyword-research-view` (`authenticated-keyword-research.test.ts`, PR8)
 * adds a fourth family, read from the `keywords`/`seedKeywords`/`seedUrl`
 * tool arguments instead of `siteUrl` (neither Ads-backed tool has a
 * `siteUrl` field): `simulate-ads-not-configured` ("Google Ads developer
 * token is not configured") — `src/google/ads.ts`'s own constant, task 8.6.
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
  find_striking_distance_keywords: {
    siteUrl: "https://example.com",
    startDate: "2026-07-01",
    endDate: "2026-07-28",
    dimensions: ["query", "page"],
    criteria: {
      minPosition: 11,
      maxPosition: 20,
      minImpressions: 1,
      limit: 25,
    },
    rowCount: 1,
    rows: [
      {
        keys: ["seo mcp", "/"],
        clicks: 4,
        impressions: 300,
        ctr: 0.013,
        position: 14.2,
      },
    ],
  },
  find_low_ctr_opportunities: {
    siteUrl: "https://example.com",
    startDate: "2026-07-01",
    endDate: "2026-07-28",
    dimensions: ["query", "page"],
    criteria: { maxPosition: 10, minImpressions: 10, maxCtr: 0.02, limit: 25 },
    rowCount: 1,
    rows: [
      {
        keys: ["seo mcp landing page", "/landing"],
        clicks: 3,
        impressions: 900,
        ctr: 0.0033,
        position: 4.1,
      },
    ],
  },
  snapshot_search_console: {
    snapshotId: 1,
    siteUrl: "https://example.com",
    rowCount: 1,
    capturedAt: "2026-07-28T00:00:00.000Z",
  },
  list_search_console_snapshots: {
    siteUrl: "https://example.com",
    count: 2,
    snapshots: [
      {
        id: 2,
        siteUrl: "https://example.com",
        capturedAt: "2026-07-28T00:00:00.000Z",
        startDate: "2026-07-01",
        endDate: "2026-07-28",
        label: "current",
      },
      {
        id: 1,
        siteUrl: "https://example.com",
        capturedAt: "2026-06-28T00:00:00.000Z",
        startDate: "2026-06-01",
        endDate: "2026-06-28",
        label: "base",
      },
    ],
  },
  compare_search_console: {
    siteUrl: "https://example.com",
    baseSnapshotId: 1,
    currentSnapshotId: 2,
    diff: {
      baseCount: 2,
      currentCount: 2,
      decayed: [
        {
          query: "seo mcp",
          page: "/",
          base: { clicks: 10, impressions: 100, ctr: 0.1, position: 5.2 },
          current: { clicks: 4, impressions: 100, ctr: 0.04, position: 8.1 },
          clicksDelta: -6,
          impressionsDelta: 0,
          positionDelta: 2.9,
        },
      ],
      improved: [
        {
          query: "seo tool",
          page: "/tools",
          base: { clicks: 2, impressions: 50, ctr: 0.04, position: 12.1 },
          current: { clicks: 9, impressions: 60, ctr: 0.15, position: 6.4 },
          clicksDelta: 7,
          impressionsDelta: 10,
          positionDelta: -5.7,
        },
      ],
      lost: [
        {
          query: "discontinued feature",
          page: "/old",
          base: { clicks: 3, impressions: 40, ctr: 0.075, position: 9.5 },
          current: null,
          clicksDelta: -3,
          impressionsDelta: -40,
          positionDelta: 0,
        },
      ],
      gained: [
        {
          query: "new launch",
          page: "/new",
          base: null,
          current: { clicks: 5, impressions: 70, ctr: 0.071, position: 7.2 },
          clicksDelta: 5,
          impressionsDelta: 70,
          positionDelta: 0,
        },
      ],
    },
  },
  get_keyword_metrics: {
    customerId: "1234567890",
    count: 1,
    keywords: [
      {
        keyword: "seo tool",
        avgMonthlySearches: 1000,
        competition: "MEDIUM",
        competitionIndex: 45,
        lowTopOfPageBid: 1.2,
        highTopOfPageBid: 3.4,
      },
    ],
  },
  discover_keywords: {
    customerId: "1234567890",
    count: 1,
    keywords: [
      {
        keyword: "seo software",
        avgMonthlySearches: 500,
        competition: "LOW",
        competitionIndex: 12,
        lowTopOfPageBid: 0.8,
        highTopOfPageBid: 2.1,
      },
    ],
  },
  cluster_keywords: {
    count: 2,
    intents: { commercial: 2 },
    clusters: [{ label: "seo", keywords: ["seo tool", "seo software"] }],
    keywords: [
      { keyword: "seo tool", intent: "commercial", tokens: ["seo", "tool"] },
      {
        keyword: "seo software",
        intent: "commercial",
        tokens: ["seo", "software"],
      },
    ],
  },
  find_seo_opportunities: {
    siteUrl: "https://example.com",
    startDate: "2026-07-01",
    endDate: "2026-07-28",
    count: 1,
    opportunities: [
      {
        type: "low_ctr",
        query: "seo mcp",
        page: "/",
        impressions: 500,
        currentPosition: 4.2,
        impact: 500,
        effort: 1,
        priorityScore: 500,
        recommendation: "Rewrite title/meta description to improve CTR.",
      },
    ],
  },
  find_keyword_cannibalization: {
    siteUrl: "https://example.com",
    startDate: "2026-07-01",
    endDate: "2026-07-28",
    count: 1,
    groups: [
      {
        query: "seo mcp",
        pageCount: 2,
        totalImpressions: 300,
        totalClicks: 20,
        pages: [
          { page: "/a", clicks: 12, impressions: 200, position: 5.1 },
          { page: "/b", clicks: 8, impressions: 100, position: 8.4 },
        ],
      },
    ],
  },
  map_keywords_to_pages: {
    siteUrl: "https://example.com",
    startDate: "2026-07-01",
    endDate: "2026-07-28",
    count: 1,
    pages: [
      {
        page: "/",
        queryCount: 1,
        totalClicks: 10,
        totalImpressions: 100,
        topQueries: [
          { query: "seo mcp", clicks: 10, impressions: 100, position: 5.2 },
        ],
      },
    ],
  },
  find_content_gaps: {
    siteUrl: "https://example.com",
    startDate: "2026-07-01",
    endDate: "2026-07-28",
    count: 1,
    gaps: [
      {
        query: "seo mcp gap",
        page: "/gap",
        impressions: 50,
        clicks: 0,
        position: 25,
      },
    ],
  },
  analyze_domain: {
    url: "https://example.com",
    crawl: {
      sitemapFound: true,
      crawled: 1,
      failed: 0,
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
      crawlPolicy: {
        robotsUrl: "https://example.com/robots.txt",
        robotsFound: true,
        userAgent: "seo-mcp",
        sitemapsDeclared: [],
        disallowedSkipped: { count: 0, sample: [] },
      },
      linkGraph: {
        crawledPages: 1,
        orphanPages: { count: 0, sample: [] },
        topLinkedPages: [],
      },
    },
  },
};

const DECOY_CREDENTIAL = "DECOY_REFRESH_TOKEN_xyz789";

const GSC_ERROR_TEXTS = {
  "simulate-gsc-not-configured": "Google credentials are not configured",
  "simulate-gsc-credential-failure": `OAuth token exchange failed: invalid_grant ${DECOY_CREDENTIAL}`,
  "simulate-gsc-quota": `Search Analytics API error: quota exceeded ${DECOY_CREDENTIAL}`,
  "simulate-gsc-unknown-failure": `Unexpected upstream failure ${DECOY_CREDENTIAL}`,
  "simulate-d1-not-configured": "D1 storage is not configured",
  "simulate-insufficient-snapshots": "Need at least two snapshots to compare",
};

const ADS_ERROR_TEXTS = {
  "simulate-ads-not-configured": "Google Ads developer token is not configured",
};

/**
 * `seo-intelligence-view` (task 10.9, threat row g): `analyze_domain` is
 * the ONE authenticated tool where an upstream Google failure rides an
 * otherwise-SUCCESSFUL `structuredContent` payload instead of an `isError`
 * result — `gscError` is a raw `Error.message` on a 200-OK `DomainReport`
 * (`src/seo/domain-report.ts#analyzeDomain`). This trigger, read from the
 * `gscProperty` argument, simulates exactly that shape so the decoy-sweep
 * has a real success-payload leak path to assert against, not only an
 * `isError` one.
 */
const DOMAIN_ENRICHMENT_FAILURE_TRIGGER = "simulate-domain-enrichment-failure";

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
    const argKeywordsText = [
      ...(body?.params?.arguments?.keywords ?? []),
      ...(body?.params?.arguments?.seedKeywords ?? []),
      body?.params?.arguments?.seedUrl ?? "",
    ].join(" ");

    const argGscProperty = body?.params?.arguments?.gscProperty ?? "";
    if (
      toolName === "analyze_domain" &&
      argGscProperty.includes(DOMAIN_ENRICHMENT_FAILURE_TRIGGER)
    ) {
      const baseReport = TOOL_RESULTS.analyze_domain;
      return Response.json({
        jsonrpc: "2.0",
        id: "stub",
        result: {
          content: [{ type: "text", text: "ok" }],
          structuredContent: {
            ...baseReport,
            gscError: `OAuth token exchange failed: invalid_grant ${DECOY_CREDENTIAL}`,
          },
        },
      });
    }

    for (const [trigger, text] of Object.entries(GSC_ERROR_TEXTS)) {
      if (argSiteUrl.includes(trigger)) {
        return Response.json({
          jsonrpc: "2.0",
          id: "stub",
          result: { content: [{ type: "text", text }], isError: true },
        });
      }
    }

    for (const [trigger, text] of Object.entries(ADS_ERROR_TEXTS)) {
      if (argKeywordsText.includes(trigger)) {
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
