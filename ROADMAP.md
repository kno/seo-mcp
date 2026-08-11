# SEO MCP roadmap

The first release proves a bounded, Workers-native SEO MCP before adding authenticated data sources or persistent crawl infrastructure.

## Completed — implemented MVP foundation

- [x] Cloudflare Worker and MCP v2 Streamable HTTP endpoint at `/mcp`
- [x] `health`, `crawl_page`, `crawl_site`, and `analyze_pagespeed` tools
- [x] Workers-native chunk-safe `HTMLRewriter` extraction implementation
- [x] Shared URL/SSRF policy, validated redirects, timeouts, and byte caps
- [x] Bounded sitemap crawling and one-level sitemap index support
- [x] PageSpeed v5 normalization with lab/field separation
- [x] Unit tests, CI, deployment configuration, and operator documentation

## Current — reproducible build and runtime verification

- [ ] Generate and commit `package-lock.json`, then change CI from `npm install` to `npm ci`
- [x] Run the real Vitest suite, typecheck, and Wrangler dry-run with installed dependencies
- [ ] Add a lightweight Wrangler/Miniflare integration test for `HTMLRewriter` and `/mcp`
- [ ] Exercise a deployed Worker with multiple MCP hosts
- [ ] Record real Free-plan CPU, output-size, and subrequest telemetry

## Next

- [ ] Optional authentication and per-client quotas
- [ ] Robots.txt awareness and explicit crawl policy reporting
- [ ] Durable crawl summaries with a storage choice driven by measured usage
- [ ] Search Console client and tools after OAuth/product requirements are defined
- [ ] Google Ads client and tools after account hierarchy and reporting scope are defined
- [ ] Add MCP output schemas and remove the structured-output cast after validating the stable v2 signature against installed declarations

## Pending decisions

- [ ] Which MCP hosts and authentication flow must be supported first?
- [ ] Should durable history use D1, KV, R2, or remain external?
- [ ] Which Search Console dimensions and Google Ads reports provide the first valuable slice?
- [ ] What rate limits and retention policy fit the expected deployment?

Recursive broken-link checking remains outside the MVP. It should be designed as a separately budgeted crawl job rather than silently added to `crawl_site`.
