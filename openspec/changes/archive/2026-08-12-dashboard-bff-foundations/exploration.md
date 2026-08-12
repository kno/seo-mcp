# Exploration — dashboard-bff-foundations

Investigation of what the planned SEO MCP dashboard (`DASHBOARD_ROADMAP.md`) actually requires from
this server before any UI work begins. Every claim below was verified against source with
`file:line` evidence.

## Scope

Near-term change only:

1. A typed, validated contract for MCP tool results that a client can consume.
2. BFF foundations that hold the shared token server-side.
3. A dashboard access gate, decided independently of the server's future OAuth work.

Later dashboard phases (single-page report UI, site crawl UI, PageSpeed UI, history, multi-tenant)
are out of scope here and are noted only where they create dependencies.

## Claim verification

| #   | Claim                                                                                                     | Verdict                         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `crawl_site` caps: `limit` ≤20 (default 10), `concurrency` ≤4                                             | CONFIRMED                       | `src/server.ts:64-66`, `src/config.ts` (`maxCrawlPages: 20`, `maxConcurrency: 4`, `defaultCrawlPages: 10`)                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2   | Auth is a single shared bearer token compared timing-safe (SHA-256 + `timingSafeEqual`)                   | CONFIRMED                       | `src/http/auth.ts:43-69`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 3   | Server returns 401 + `www-authenticate`, 429 + hardcoded `retry-after: 60`, 503 on missing binding/crypto | CONFIRMED                       | `src/http/auth.ts:78-112`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 4   | `Origin`/`Host` mismatch is rejected, so a browser can never call `/mcp` cross-origin                     | CONFIRMED with nuance           | `src/http/request-policy.ts:10-31`. The `Origin` check is **skipped when the header is absent** (`:21`), so non-browser callers pass. Browsers always send `Origin` cross-origin and the server emits no CORS headers, so the claim holds for browsers specifically — which is what matters for the BFF decision.                                                                                                                                                                                                   |
| 5   | The rate limiter uses ONE global fixed key at 60 requests / 60s, shared by every consumer                 | CONFIRMED                       | `src/http/auth.ts:3` (`MCP_RATE_LIMIT_KEY = "mcp:shared-v1"`), `src/http/auth.ts:104-106`, `wrangler.jsonc` (`limit: 60`, `period: 60`)                                                                                                                                                                                                                                                                                                                                                                             |
| 6   | No MCP output schemas; `structuredContent` is an unchecked cast                                           | CONFIRMED                       | `src/server.ts:8-11` (`structuredContent: value as Record<string, unknown>`), `ROADMAP.md:70` lists output schemas as pending                                                                                                                                                                                                                                                                                                                                                                                       |
| 7   | Tool-level failures return `isError: true` with a plain-text message and no structured code               | CONFIRMED                       | `src/server.ts:13-21`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 8   | The URL policy blocks private/loopback/link-local/metadata targets                                        | CONFIRMED                       | `src/security/url-policy.ts`. Consequence: an ungated BFF is a **resource-abuse amplifier**, not an SSRF path into private networks.                                                                                                                                                                                                                                                                                                                                                                                |
| 9   | 8s fetch timeout, ~40s worst-case `crawl_site` latency, 256KB output cap, 64KB inbound cap                | CONFIRMED                       | `src/config.ts` (`fetchTimeoutMs: 8_000`, `maxSiteOutputBytes: 256_000`, `maxSiteResponseBytes: 3_000_000`), `src/http/inbound.ts:1` (`MAX_MCP_REQUEST_BYTES = 64_000`). Note: the crawl pool is continuous work-stealing, not discrete batches, so ~40s is an order-of-magnitude bound, not an exact figure.                                                                                                                                                                                                       |
| 10  | Max `crawl_site` risks the Cloudflare Free-plan subrequest ceiling                                        | CONFIRMED, **already defended** | `src/crawl/site.ts:274` passes `createFetchBudget(fetcher, 48)` (`src/http/fetch.ts:39-41`). Every fetch — robots, sitemap documents, pages, redirect hops — shares that one counter and the crawl fails closed at 48, under the Free-plan ceiling of 50 external subrequests per invocation. `README.md` already documents this. An unbounded worst case (1 robots + 5 sitemap docs + 20 pages × up to 4 redirect hops) would exceed 50, which is precisely why the budget exists. **No new work is needed here.** |

## Typed-contract survey

The result shapes are already exported TypeScript interfaces:

- `PageAnalysis` — `src/seo/html.ts:281`
- `DomainSummary`, `CrawlPolicy`, `LinkGraphSummary`, `SiteCrawlResult`, `SitePageAnalysis`,
  `DomainCategory`, `DuplicateGroup` — `src/crawl/site.ts:9-68`
- `PageSpeedResult`, `Strategy` — `src/pagespeed/types.ts:1-32`
- `LinkProbe`, `LinkCheckResult` — `src/crawl/links.ts`

So the gap is **not** "no types exist". It is two narrower gaps:

1. The types are not published anywhere a client can import them.
2. The wire payload (`structuredContent`) carries no runtime validation, because there are no MCP
   output schemas (claim 6).

### Options

| Approach                                                   | Effort              | Assessment                                                                                                 |
| ---------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------- |
| Ship MCP output schemas (the pending `ROADMAP.md:70` item) | Medium              | Fixes the real protocol gap for **every** client, not just this dashboard, and removes the unchecked cast. |
| Export the existing result types as a shared module        | Low                 | Compile-time safety only; no wire validation. Viable first step.                                           |
| Hand-duplicate the types in the dashboard                  | Low now, high later | Guaranteed silent drift. Rejected.                                                                         |

The first two are complementary, not alternatives: schemas give runtime validation, the shared module
gives the client compile-time types derived from one source.

## BFF placement options

| Approach                                               | Assessment                                                                                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| New routes in this same Worker                         | Lowest effort; the token never crosses a network boundary. Couples the dashboard release cadence to the server's and blurs the read-only MCP boundary. |
| Separate Worker, same repo, wired by a service binding | Token stays off the public network (service bindings are in-process RPC). Keeps release and failure domains separate. Preferred.                       |
| Separate Worker or repo over public HTTPS              | The token crosses the public network on every call. Highest exposure.                                                                                  |

A same-Worker or service-binding BFF also sidesteps the `Origin` policy in `request-policy.ts`
entirely, since no cross-origin browser request is ever made to `/mcp`.

## Caching and request coalescing

The binding constraint is the single global 60/min bucket (claim 5): adding a BFF creates **no new
bucket**, it consumes the existing one alongside every other MCP host. A dashboard refreshing panels
is a request amplifier against that shared budget.

`wrangler.jsonc` currently declares no storage bindings at all — only the rate limiter and
observability. So any caching layer means adding a binding:

- **Cache API** — no binding needed, but per-colo and unsuitable as the sole coalescing mechanism.
- **KV with TTL** — lowest effort for plain result caching. Eventually consistent.
- **Durable Object** — the only primitive that can genuinely coalesce concurrent identical crawls
  into one upstream call. Strongest fit for the amplification problem; more machinery.

## Access control versus server OAuth

Dashboard access control is **independent** of the server's OAuth work and must not be gated behind
it. The BFF decides who may trigger calls that spend the single shared token and bucket; it is not
distributing per-user MCP credentials. That distribution is the genuinely OAuth-dependent piece, and
it stays gated (`DASHBOARD_ROADMAP.md:12,63`).

Leaving the gate until later means deploying a token-holding open proxy to the crawler: anyone can
exhaust the 60/min budget shared with every other consumer and use the Worker to crawl third-party
sites. Severity is bounded by the URL policy (claim 8) — resource abuse, not internal network
access — but it is a Phase 0 concern, not a Phase 6 one.

## Risks

- The shared 60/min bucket has no per-client isolation; a busy BFF degrades every other MCP consumer.
- `structuredContent` has no runtime validation until the output-schema item ships.
- Worst-case `crawl_site` latency (~40s) needs explicit BFF timeout and loading-state handling. The
  bounded-response versus SSE question is already an open decision in `DASHBOARD_ROADMAP.md`.
- The `Origin` check defends browsers, not callers that omit the header (claim 4).

## Conclusion

Ready for proposal. Bounded scope: publish a typed and validated result contract, stand up the BFF
holding the token server-side with caching/coalescing against the shared bucket, and gate dashboard
access independently of server OAuth.
