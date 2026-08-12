# SEO MCP dashboard roadmap

A control panel that visualizes everything the SEO MCP produces — on-page reports, site crawls (domain summaries, crawl policy, internal link graph), and PageSpeed — by connecting to the `/mcp` endpoint as an MCP client.

This is a parallel track to [ROADMAP.md](ROADMAP.md) (the server). Several dashboard phases are explicitly gated by server-side items (storage, OAuth) and must not be started before those land.

The near-term slice is specced under `openspec/changes/dashboard-bff-foundations/` (exploration, proposal, delta specs, design). That change is the authority on scope and requirements for Phase −1 and Phase 0; this file stays the long-range map.

## Architecture decision — resolved

- **Backend-for-frontend (BFF), non-negotiable.** The server authenticates every `/mcp` request with the shared `MCP_AUTH_TOKEN`. That token must NEVER reach the browser. The dashboard runs a server component that holds the token; the browser talks only to the BFF.
- **BFF placement: a sibling Worker in this repo, wired to `seo-mcp` by a service binding.** Service bindings are in-process RPC, so the token never crosses the public network, and the two Workers keep separate release and failure domains.
- **Platform.** Same stack as the server: Cloudflare Workers, TypeScript, pnpm, the MCP TypeScript SDK client. Reuse the server repo's prettier/vitest conventions.
- **Contract.** The dashboard only consumes MCP tools. It never re-implements crawling and never issues writes — the MCP is read-only analysis.
- **Auth dependency.** Until the server ships OAuth/per-client quotas there is exactly one shared token, held server-side only. _Dashboard access control is NOT gated by that work_ — see Phase 0. Per-client MCP credentials are Phase 6.

## Server constraints the dashboard must design around

Verified against the code; these are the numbers that shape the UI, not guesses.

| Constraint                      | Value                                                                                                                 | Source                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Rate limit                      | 60 requests / 60s on **one global key** (`mcp:shared-v1`), shared by every MCP consumer                               | `src/http/auth.ts:3`, `wrangler.jsonc`                                          |
| `crawl_site` caps               | `limit` ≤20 (default 10), `concurrency` ≤4                                                                            | `src/server.ts:64-66`, `src/config.ts`                                          |
| Worst-case `crawl_site` latency | ~40s (8s per-fetch timeout × 20 pages at concurrency 4)                                                               | `src/config.ts`                                                                 |
| `crawl_site` output cap         | 256KB                                                                                                                 | `src/config.ts` (`maxSiteOutputBytes`)                                          |
| Inbound MCP request cap         | 64KB                                                                                                                  | `src/http/inbound.ts:1`                                                         |
| `check_links` bounds            | ≤50 links probed, concurrency 6, 6s per probe                                                                         | `src/config.ts` (`maxLinkChecks`, `linkCheckConcurrency`, `linkProbeTimeoutMs`) |
| Subrequest budget               | `crawl_site`: 48 fetches, fails closed, under the Free-plan ceiling of 50. **`check_links`: 60 — ABOVE that ceiling** | `src/crawl/site.ts:274`, `src/config.ts` (`linkCheckSubrequestBudget`)          |
| Transport failures              | 401 + `www-authenticate`, 429 + `retry-after: 60`, 503                                                                | `src/http/auth.ts:78-112`                                                       |
| Tool failures                   | `isError: true` with a plain-text message, no structured code                                                         | `src/server.ts:13-21`                                                           |

Two consequences worth stating outright:

- **A dashboard is a request amplifier against a bucket it does not own.** Adding a BFF creates no new rate-limit bucket. Every panel refresh competes with every other MCP host. Caching and request coalescing are Phase 0 work, not polish.
- **`src/http/request-policy.ts` is not access control.** It rejects mismatched `Origin`/`Host`, but skips the check entirely when `Origin` is absent (`:21`), so it defends browsers only. The BFF's own gate is load-bearing.
- **`check_links` can hit the platform subrequest ceiling.** Its budget (60) sits above the Free-plan ceiling (50) that the `crawl_site` budget of 48 exists to stay under, so the failure arrives as a platform error rather than a graceful fail-closed. Server-side defect, tracked separately; the dashboard must surface it as an upstream error, never as an empty success.

## Phase −1 — typed result contract (server-side prerequisite)

Blocks Phase 1. Pulled forward from `ROADMAP.md` "Protocol and tooling".

- [ ] Declare MCP output schemas for **all five tools** (`health`, `crawl_page`, `crawl_site`, `check_links`, `analyze_pagespeed`) and remove the `structuredContent: value as Record<string, unknown>` cast (`src/server.ts:8-11`).
- [ ] Publish the already-exported result types (`PageAnalysis`, `SiteCrawlResult` and nested types, `LinkCheckResult`, `PageSpeedResult`) as one importable module, so schema and client types derive from a single source.

Without this the dashboard consumes untyped, unvalidated JSON: a field rename on the server would not break the build, it would break the UI in production.

The server also registers `search_console_query` (commit `9e570a3`). It is **deferred** from Phase −1 and Phase 0 into Phase 5: it depends on an external authenticated source (a Google refresh token held as a Worker secret), so its caching and staleness semantics differ from the crawl tools. Its auth is Google's, not MCP-client auth.

## Principle: the dashboard tracks the tool set

The dashboard exists to surface everything the MCP produces, so **every tool the server registers gets a view, and a new tool's view lands as part of adding it** — not as a later catch-up. This roadmap has already been caught out twice by tools landing mid-planning (`check_links`, then `search_console_query`).

Consequence for planning: specs for tools that do not exist yet are written against the roadmap's stated intent, not against a verified result shape. They are provisional by construction and MUST be reconciled against the real output schema when each tool ships. Each such spec says so explicitly.

Smaller than it looks: the installed `@modelcontextprotocol/server@2.0.0` accepts a Zod schema as `outputSchema` beside `inputSchema`, converts it to JSON Schema itself, and **already validates `structuredContent` at runtime**. Declaring the schema buys the validation. One constraint: every schema root must be an object, or the SDK applies a legacy `{result:…}` wire wrap.

## Phase 0 — foundations

- [ ] Scaffold the app with lint/format/test parity to the server (pnpm, prettier, vitest — joining the existing `unit` and Miniflare `integration` projects).
- [ ] MCP client module wrapping the transport + bearer auth, server-side only.
- [ ] BFF endpoints — one thin JSON route per tool (`health`, `crawl_page`, `crawl_site`, `check_links`, `analyze_pagespeed`) that injects the token and forwards to the MCP. When a tool is added to the server, its route lands in the same change.
- [ ] **Dashboard access gate.** Timing-safe credential comparison, secrets via `wrangler secret put`, rejection _before_ any MCP call. Shipping the BFF without this deploys a token-holding open proxy to the crawler.
- [ ] **Result cache and request coalescing** against the shared 60/min bucket: bounded configurable TTL per tool, explicit refresh bypass, surfaced result age. Must tolerate a cache miss or absent binding rather than failing closed.
- [ ] **Normalized error envelope** — stable `code`, message, optional `retryAfter` — covering gate rejection, upstream 401/429/503, tool `isError`, schema-validation failure, and BFF timeout.
- [ ] Explicit BFF timeout budget above the ~40s `crawl_site` bound, plus the shared loading / error / empty-state contract.
- [ ] **Design system baseline** (atomic design, container/presentational split) established here, before the three views are built.

## Phase 1 — single-page report (`crawl_page`)

- [ ] URL input → on-page card: title, description, canonical, robots, lang, indexability.
- [ ] Headings view (H1/H2/H3) and link counts (internal vs external).
- [ ] Open Graph and JSON-LD panels (types found, invalid-block flag), word count.
- [ ] Issues list with severity badges mapped from the tool's issue codes (`missing_title`, `noindex`, `invalid_jsonld`, `thin_content`, `missing_open_graph`, …).
- [ ] Broken-links panel (`check_links`), triggered on demand rather than on page load — it is the most subrequest-hungry tool. Show `checked`/`ok`/`broken`/`errors` counts so a bounded probe set is never read as a clean bill of health, and distinguish `broken` (4xx/5xx) from `error` (unreachable/timeout).

## Phase 2 — site crawl view (`crawl_site`)

- [ ] Site input with limit/concurrency controls that respect the tool caps (≤20 pages, ≤4 concurrency). Default the UI low (5–10) and make 20 an explicit, warned choice given the latency bound.
- [ ] Domain summary panel: duplicate titles/descriptions, missing/multiple H1, thin content, non-indexable pages, images-without-alt coverage.
- [ ] Crawl policy panel: robots found, sitemaps declared, disallowed-skipped count/sample.
- [ ] Internal link graph view: orphan pages list and most-linked pages (bar chart).
- [ ] Per-page table with issue counts and drill-down into the Phase 1 report.

## Phase 3 — PageSpeed view (`analyze_pagespeed`)

- [ ] URL + strategy (mobile/desktop) + optional PageSpeed API key field (maps to the tool's `apiKey` input; never stored in the browser).
- [ ] Score gauges (performance, accessibility, best-practices, SEO), lab metrics, optional field INP.
- [ ] Top opportunities table with estimated savings.

## Phase 4 — cross-cutting UX

- [ ] Accessibility and responsive audit across the three views.
- [ ] Result export (JSON/CSV).
- [ ] Usage/quota visibility: surface how close the shared bucket is to its limit.

## Phase 5 — authenticated data sources

`ROADMAP.md` resolved the deployment shape as **single-tenant**: one owner, their own sites, one Google account. Google access uses a stored refresh token held as a Worker secret, not a user OAuth flow — so these are no longer blocked on an authorization server. Specced in `openspec/changes/dashboard-insights/`.

- [ ] Search Console view: `search_console_query` (shipped), then `find_striking_distance_keywords`, `find_low_ctr_opportunities`, content-decay and period-over-period comparison.
- [ ] Keyword research view: `get_keyword_metrics` first, then `discover_keywords` — volume, CPC, competition, intent, clustering.
- [ ] SEO intelligence view: `analyze_domain`, `find_seo_opportunities`, keyword-to-page mapping, content gaps, cannibalizations, internal-linking recommendations, impact/effort prioritization.

## Phase 6 — history and comparison (gated by server persistence)

- [ ] Persist snapshots and render period-over-period diffs and trend charts.
- [ ] Storage decision is resolved (**D1** for metrics and history, rolling 90-day retention; R2 only if full archival is later wanted). Still BLOCKED on the server actually implementing history and exposing it.

## Phase 7 — multi-tenant (only if the deployment shape changes)

`ROADMAP.md` resolved to keep the shared bearer token, with per-client tokens only if a second consumer appears. This phase is therefore **conditional, not scheduled**.

- [ ] Per-client MCP credentials and per-client quota display.
- Note: dashboard _access_ auth is Phase 0 and was never blocked by this. What this phase adds is distinct MCP credentials per user, which single-tenant does not need.

## Pending decisions

- [x] ~~Where the BFF lives~~ — sibling Worker in this repo, service binding.
- [x] ~~Dashboard-user auth before server OAuth exists~~ — ship a gate in Phase 0, independent of OAuth. _Mechanism still open:_ signed session cookie vs allowlist vs local-only.
- [ ] Crawl progress: bounded response or streaming progress (SSE)? Affects the BFF route shape; Phase 0 assumes bounded, and the route must survive either choice.
- [ ] Cache TTL per tool — needs a product answer on acceptable result staleness.
- [ ] Coalescing primitive: KV with TTL first, or a Durable Object for true cross-isolate coalescing? Needs an agreed, observable escalation trigger.
- [ ] Frontend approach: plain React SPA, or a full-stack framework on Workers?
- [ ] Charting: hand-rolled SVG vs a library (bundle-size vs speed of build)?

## Non-goals (first release)

- No write paths to the MCP — the panel is read-only.
- No crawling logic in the dashboard — it consumes MCP tools, never bypasses them.
- No shared token in the browser under any circumstance.
- No new subrequest-budget work. The existing 48-fetch budget already keeps `crawl_site` under the Free-plan ceiling.
