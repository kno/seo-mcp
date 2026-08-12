# SEO MCP dashboard roadmap

A control panel that visualizes everything the SEO MCP produces — on-page reports, site crawls (domain summaries, crawl policy, internal link graph), and PageSpeed — by connecting to the `/mcp` endpoint as an MCP client.

This is a parallel track to [ROADMAP.md](ROADMAP.md) (the server). Several dashboard phases are explicitly gated by server-side items (storage, OAuth) and must not be started before those land.

## Architecture decision — resolve before Phase 0

- **Backend-for-frontend (BFF), non-negotiable.** The server authenticates every `/mcp` request with the shared `MCP_AUTH_TOKEN`. That token must NEVER reach the browser. The dashboard runs a server component that holds the token and speaks MCP Streamable HTTP; the browser talks only to the BFF.
- **Platform.** Same stack as the server: Cloudflare Worker/Pages, TypeScript, pnpm, the MCP TypeScript SDK client. Reuse the server repo's prettier/vitest conventions.
- **Contract.** The dashboard only consumes MCP tools. It never re-implements crawling and never issues writes — the MCP is read-only analysis.
- **Auth dependency.** Until the server ships OAuth/per-client quotas, there is exactly one shared token, held server-side only. Multi-user dashboard auth is Phase 6 and depends on that server work.

## Phase 0 — foundations

- [ ] Scaffold the app (Vite + React + TS, or a Workers full-stack framework) with lint/format/test parity to the server (pnpm, prettier, vitest).
- [ ] MCP client module wrapping the Streamable HTTP transport + bearer auth, server-side only.
- [ ] BFF endpoints — one thin JSON route per tool (`health`, `crawl_page`, `crawl_site`, `analyze_pagespeed`) that injects the token and forwards to the MCP.
- [ ] Shared loading / error / empty-state contract, and surfacing of MCP failures (401, 429 with `retry-after`, 503).

## Phase 1 — single-page report (`crawl_page`)

- [ ] URL input → on-page card: title, description, canonical, robots, lang, indexability.
- [ ] Headings view (H1/H2/H3) and link counts (internal vs external).
- [ ] Open Graph and JSON-LD panels (types found, invalid-block flag), word count.
- [ ] Issues list with severity badges mapped from the tool's issue codes (`missing_title`, `noindex`, `invalid_jsonld`, `thin_content`, `missing_open_graph`, …).

## Phase 2 — site crawl view (`crawl_site`)

- [ ] Site input with limit/concurrency controls that respect the tool caps (≤20 pages, ≤4 concurrency).
- [ ] Domain summary panel: duplicate titles/descriptions, missing/multiple H1, thin content, non-indexable pages, images-without-alt coverage.
- [ ] Crawl policy panel: robots found, sitemaps declared, disallowed-skipped count/sample.
- [ ] Internal link graph view: orphan pages list and most-linked pages (bar chart).
- [ ] Per-page table with issue counts and drill-down into the Phase 1 report.

## Phase 3 — PageSpeed view (`analyze_pagespeed`)

- [ ] URL + strategy (mobile/desktop) + optional PageSpeed API key field (maps to the tool's `apiKey` input; never stored in the browser).
- [ ] Score gauges (performance, accessibility, best-practices, SEO), lab metrics, optional field INP.
- [ ] Top opportunities table with estimated savings.

## Phase 4 — cross-cutting UX

- [ ] Design system (atomic design, container/presentational split), accessible and responsive components.
- [ ] Result export (JSON/CSV).
- [ ] Consistent surfacing of rate limits and auth/availability errors from the MCP.

## Phase 5 — history and comparison (gated by server persistence)

- [ ] Persist crawl/PageSpeed snapshots and render period-over-period diffs and trend charts.
- [ ] BLOCKED until the server ROADMAP resolves durable storage (D1/KV/R2) and exposes history.

## Phase 6 — multi-tenant (gated by server OAuth/quotas)

- [ ] Dashboard user auth; per-client MCP credentials replacing the shared token; quota/usage display.
- [ ] BLOCKED until the server ROADMAP ships OAuth and per-client quotas.

## Pending decisions

- [ ] Frontend approach: plain React SPA + BFF worker, or a full-stack framework on Workers?
- [ ] Charting: hand-rolled SVG vs a library (bundle-size vs speed of build)?
- [ ] Where the BFF lives: a sibling worker in this repo, a separate worker, or a separate repo?
- [ ] Dashboard-user auth before server OAuth exists: a simple gate, an allowlist, or local-only?
- [ ] Crawl progress: is a single bounded response enough, or is streaming progress (SSE) worth it?

## Non-goals (first release)

- No write paths to the MCP — the panel is read-only.
- No crawling logic in the dashboard — it consumes MCP tools, never bypasses them.
- No shared token in the browser under any circumstance.
