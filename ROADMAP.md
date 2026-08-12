# SEO MCP roadmap

The first release proves a bounded, Workers-native SEO MCP before adding authenticated data sources or persistent crawl infrastructure.

## Completed — implemented MVP foundation

- [x] Cloudflare Worker and MCP v2 Streamable HTTP endpoint at `/mcp`
- [x] `health`, `crawl_page`, `crawl_site`, and `analyze_pagespeed` tools
- [x] Workers-native chunk-safe `HTMLRewriter` extraction implementation
- [x] Shared URL/SSRF policy, validated redirects, timeouts, and byte caps
- [x] Bounded sitemap crawling and one-level sitemap index support
- [x] PageSpeed v5 normalization with lab/field separation
- [x] Optional per-call PageSpeed API key via the `analyze_pagespeed` tool input
- [x] Unit tests, CI, deployment configuration, and operator documentation

## Current — reproducible build and runtime verification

- [x] Reproducible installs: committed `pnpm-lock.yaml`, pinned `packageManager`, and CI on `pnpm install --frozen-lockfile`
- [x] Run the real Vitest suite, typecheck, and Wrangler dry-run with installed dependencies
- [x] Wrangler/Miniflare integration test for real `HTMLRewriter` extraction (the `/mcp` auth path stays out — the ratelimit binding is not reliably simulated)
- [ ] Exercise a deployed Worker with multiple MCP hosts
- [ ] Record real Free-plan CPU, output-size, and subrequest telemetry

## Pending — planned capabilities

### Complete on-page analysis

- [x] Canonical, robots, H2/H3, internal/external links, JSON-LD, Open Graph, word count, and indexability
- [ ] Per-page response timings (fetch-layer instrumentation)
- [x] Domain summaries: duplicates, missing/multiple H1s, thin content, non-indexable pages, and images without alt text

### More useful crawling

- [x] Robots.txt awareness
- [x] Explicit crawl policy reported in the result
- [ ] Broken-link checking as a separately budgeted crawl job, not silently added to `crawl_site`

### Google Search Console

- [ ] OAuth and secure refresh-token management
- [ ] `search_console_query`
- [ ] `find_striking_distance_keywords`
- [ ] `find_low_ctr_opportunities`
- [ ] Content-decay detection and period-over-period comparison

### Keyword research

- [ ] Google Ads Keyword Planner integration
- [ ] `discover_keywords`
- [ ] `get_keyword_metrics`
- [ ] Volume, CPC, competition, intent, and clustering

### SEO intelligence

- [ ] `analyze_domain`
- [ ] `find_seo_opportunities`
- [ ] Keyword-to-page mapping
- [ ] Content gaps, cannibalizations, and internal-linking recommendations
- [ ] Impact/effort prioritization

### Persistence and operation

- [ ] Crawl history and comparisons
- [ ] Scheduled jobs if the data justifies them
- [ ] OAuth, per-client quotas, and revocation, replacing the shared token once there are multiple consumers
- [ ] Real telemetry of Workers Free-plan limits

### Protocol and tooling

- [ ] Add MCP output schemas and remove the structured-output cast after validating the stable v2 signature against installed declarations

### Additional free sources

- [ ] Evaluate Google Trends, Bing Webmaster Tools, Google Business Profile, structured-data validation, and permitted SERP data

## Pending decisions

- [ ] Which MCP hosts and authentication flow must be supported first?
- [ ] Should durable history use D1, KV, R2, or remain external?
- [ ] Which Search Console dimensions and Google Ads reports provide the first valuable slice?
- [ ] What rate limits and retention policy fit the expected deployment?
