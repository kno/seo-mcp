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
- [x] Per-page response timings (fetch-layer instrumentation) — `fetchTimeMs`
- [x] Domain summaries: duplicates, missing/multiple H1s, thin content, non-indexable pages, and images without alt text

### More useful crawling

- [x] Robots.txt awareness
- [x] Explicit crawl policy reported in the result
- [x] Broken-link checking as a separately budgeted job — the `check_links` tool (single page; recursive/site-wide stays future work)

### Google Search Console

- [x] Single-tenant Google auth (stored refresh token → cached access token)
- [x] `search_console_query` — verified live against real Search Console data
- [x] `find_striking_distance_keywords`
- [x] `find_low_ctr_opportunities`
- [x] Content-decay detection and period-over-period comparison (D1 snapshots + `compare_search_console`)

### Keyword research

- [x] Google Ads Keyword Planner integration (single-tenant, API v23)
- [x] `discover_keywords`
- [x] `get_keyword_metrics`
- [x] Volume, CPC, competition, intent, and clustering — volume/competition/bids via Ads; intent + clustering via `cluster_keywords`

### SEO intelligence

- [x] `analyze_domain` (unified crawl + GSC + link-graph report)
- [x] `find_seo_opportunities`
- [x] Keyword-to-page mapping (`map_keywords_to_pages`)
- [x] Content gaps, cannibalizations, and internal-linking recommendations (`find_content_gaps`, `find_keyword_cannibalization`; internal linking surfaced via the crawl link graph — orphan/most-linked pages)
- [x] Impact/effort prioritization

### Persistence and operation

- [ ] Crawl history and comparisons
- [ ] Scheduled jobs if the data justifies them
- [ ] OAuth, per-client quotas, and revocation, replacing the shared token once there are multiple consumers
- [ ] Real telemetry of Workers Free-plan limits

### Protocol and tooling

- [ ] Add MCP output schemas and remove the structured-output cast after validating the stable v2 signature against installed declarations

### Additional free sources

- [ ] Evaluate Google Trends, Bing Webmaster Tools, Google Business Profile, structured-data validation, and permitted SERP data

## Deployment decisions

> **⚠️ Decision update — pivoting to MULTI-TENANT.** The deployment shape is changing: the MCP will serve multiple users and must **receive per-user authentications** (OAuth), not a single shared bearer token. This supersedes the single-tenant auth and quota decisions below. It is a large architecture change (authorization server, per-user identity, per-user Google credentials, per-client quotas, revocation) that MUST be designed as its own change, not added ad hoc. The dashboard design is affected — see [DASHBOARD_ROADMAP.md](DASHBOARD_ROADMAP.md); the shared-token BFF model no longer holds.

The MVP was built single-tenant (one owner, one Google account); that is why GSC/Ads currently use one stored refresh token. The multi-tenant pivot re-opens the auth decisions:

- [ ] **Client → MCP auth (SUPERSEDED → multi-tenant):** move from the shared bearer token to OAuth 2.1 / per-user identity with per-client quotas and revocation. To be designed.
- [x] **Durable history storage:** D1 (SQLite) for metrics and history; R2 for raw payloads only if full archival is later wanted; KV not needed now. (Still valid; multi-tenant will add per-user scoping to the D1 schema.)
- [ ] **Google auth (GSC/Ads) (SUPERSEDED → multi-tenant):** each user connects their own Google account; refresh tokens become per-user, not one Worker secret. The current single stored refresh token is an MVP stopgap.
- [x] **First data slice:** GSC `query + page` by date (striking-distance, low-CTR, content decay); Google Ads `get_keyword_metrics` before `discover_keywords`.
- [ ] **Rate limit + retention (SUPERSEDED → multi-tenant):** global shared rate limit becomes per-user/per-client quotas. Rolling 90-day retention in D1 still applies.

Consequence: the multi-tenant auth work is now IN SCOPE (no longer deferred) and blocks Phase 6/7 of the dashboard. Existing GSC/Ads/persistence code keeps working under the MVP stored-token model until the multi-tenant auth change lands.
