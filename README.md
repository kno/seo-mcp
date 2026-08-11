# SEO MCP on Cloudflare Workers

`seo-mcp` exposes a small, security-bounded SEO toolkit over MCP Streamable HTTP. It runs on Cloudflare Workers and uses the current v2 `@modelcontextprotocol/server` package.

## Quick start

```bash
pnpm install --frozen-lockfile
cp .env.example .dev.vars
# Set MCP_AUTH_TOKEN in .dev.vars to a long random development token.
pnpm test
pnpm run dev
```

The MCP endpoint is `http://localhost:8787/mcp`. Requests to other paths return `404`.

## Tools

| Tool                | Purpose                                | Important defaults                    |
| ------------------- | -------------------------------------- | ------------------------------------- |
| `health`            | Confirm the Worker is ready            | No input                              |
| `crawl_page`        | Extract on-page SEO signals and issues | 256 KB response cap                   |
| `crawl_site`        | Analyze URLs from `/sitemap.xml`       | 10 pages, max 20; concurrency max 4   |
| `analyze_pagespeed` | Normalize PageSpeed Insights v5        | Mobile; four scores; 10 opportunities |

`crawl_site` supports a clear `urlset` or one bounded sitemap index level. It deliberately does **not** recursively check broken links.

`analyze_pagespeed` requests performance, accessibility, best-practices, and SEO in one PSI v5 call. Category scores are rounded integers on a consistent 0–100 scale; lab metrics and optional field INP remain separate.

## Architecture

```text
MCP /mcp adapter
    -> tool orchestration
        -> crawl + sitemap services
        -> PageSpeed v5 client
            -> shared URL policy + bounded fetch
                -> Workers fetch / HTMLRewriter
```

The MCP adapter is thin. Crawling, extraction, URL policy, and PageSpeed normalization are separate modules so later API clients or MCP tools can reuse them without placeholder implementations.

HTML parsing uses Workers-native `HTMLRewriter`. Its transformed response is fully consumed before extraction returns because element text can arrive in chunks and callbacks complete during body consumption.

The `/mcp` request pipeline is: route → Host/Origin policy → binding/secret availability → bearer authentication → native rate limiter → 64 KB body limit → MCP handler. Host headers, when present, must match the request URL. Browser requests must be same-origin; non-browser MCP clients without an `Origin` header continue to work.

## Secrets

Every MCP request requires the shared `MCP_AUTH_TOKEN`. Local Wrangler reads it from the ignored `.dev.vars` file:

```bash
cp .env.example .dev.vars
# Set MCP_AUTH_TOKEN in .dev.vars.
```

Create the production secret interactively; never put it in `wrangler.jsonc` or command history:

```bash
npx wrangler secret put MCP_AUTH_TOKEN
```

PageSpeed works without a key at Google's anonymous quota. Its optional production key is configured separately:

```bash
npx wrangler secret put PAGESPEED_API_KEY
```

Never commit `.dev.vars`, bearer tokens, or API keys.

## Deploy

```bash
pnpm run deploy
```

Cloudflare credentials and account selection are intentionally external to this repository. After deployment, the endpoint is `https://<worker-host>/mcp`.

## Connect an MCP client

Configure a remote Streamable HTTP server using the deployed URL:

```json
{
  "mcpServers": {
    "seo": {
      "type": "http",
      "url": "https://<worker-host>/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_AUTH_TOKEN>"
      }
    }
  }
}
```

Exact header configuration and secure environment-variable interpolation vary by MCP host. Store the token in the client's secret facility and send it as `Authorization: Bearer <token>`; do not paste a real token into committed configuration.

## Limits and security

- Only `http:` and `https:` targets are accepted. URL credentials, localhost, private/reserved IP literals, and local/internal host suffixes are rejected.
- Redirects are manual, limited to three, and every destination is revalidated.
- MCP request bodies are capped at 64 KB. HTML/XML responses are capped at 256 KB, PageSpeed JSON at 2 MB, and a site crawl shares a 3 MB response-byte budget plus a 256 KB serialized-output limit.
- Ordinary fetches time out after 8 seconds; PageSpeed after 20 seconds.
- Site crawls use at most four concurrent page fetches, twenty pages, and five sitemap documents.
- Sitemap page URLs and child sitemap documents must stay on the requested origin.
- Authentication uses one shared bearer token for a controlled consumer. SHA-256 digests are compared with Workers-native `crypto.subtle.timingSafeEqual`; missing crypto support, secret, or limiter binding fails closed with `503`.
- The native `MCP_RATE_LIMITER` allows approximately 60 authenticated requests per 60 seconds for the shared `mcp:shared-v1` bucket. Cloudflare rate limits are intentionally approximate and applied per Cloudflare location, not as one globally exact counter.
- Cloudflare Workers do not expose a portable DNS-resolution or DNS-pinning API before `fetch`. DNS rebinding therefore remains a residual SSRF risk after hostname and literal-IP filtering. High-assurance deployments should add platform egress restrictions or an explicit destination allowlist.
- A site crawl shares a 48-subrequest budget and uses at most four concurrent page fetches, keeping explicit request/connection bounds below the Free-plan ceilings. These controls do **not** guarantee the 10 ms CPU target; real deployment telemetry is required.

## Development checks

```bash
pnpm run format:check
pnpm run typecheck
pnpm test
npx wrangler deploy --dry-run
```

Tests keep policy and normalization logic pure. Runtime extraction is isolated behind `HTMLRewriter`, while its chunk-sensitive state is unit tested without a DOM dependency. A real `HTMLRewriter` integration remains unverified until dependencies and a Wrangler/Miniflare runtime are available.

This repository uses `pnpm-lock.yaml`; use `pnpm install --frozen-lockfile` for reproducible installs.

## Scope

The MVP intentionally excludes Search Console, Google Ads, persistent crawl storage, scheduled jobs, recursive crawling, and a broken-link checker. Shared bearer authentication is appropriate for the current controlled consumer; OAuth, scopes, and per-client revocation remain a later phase. See [ROADMAP.md](ROADMAP.md) for sequencing and unresolved decisions.
