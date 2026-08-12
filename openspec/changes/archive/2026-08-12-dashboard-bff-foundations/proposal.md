# Proposal: Dashboard BFF Foundations

## Intent

The dashboard cannot start safely today. Auth is one shared bearer token (`src/http/auth.ts:43-69`) that must never reach a browser, `structuredContent` is an unchecked cast (`src/server.ts:8-11`), tool failures are plain text (`src/server.ts:13-21`), and every consumer shares one 60-req/60s bucket (`mcp:shared-v1`). A dashboard is a request amplifier against that bucket. This change ships the server-side foundations so Phase 0 UI work can begin without leaking the token or degrading other MCP consumers.

## Outcomes

- A client can consume tool results with compile-time types and runtime-validated payloads.
- The shared token stays server-side; the browser never sees it.
- Repeated dashboard panel loads do not multiply upstream MCP calls.
- Only authorized people can spend the shared token and bucket.
- Auth, rate-limit, availability, and tool failures arrive as one machine-readable envelope.

## Scope

### In Scope

1. MCP output schemas for all tools + removal of the cast (pulls `ROADMAP.md:70` forward), plus a published result-types module.
2. A BFF Worker in this repo, wired to `seo-mcp` by a service binding, holding `MCP_AUTH_TOKEN`.
3. A KV result cache with per-tool TTL and isolate-local single-flight dedupe.
4. A dashboard access gate (signed session cookie over secret-held credentials), independent of server OAuth.
5. A normalized error envelope: stable `code`, message, optional `retryAfter`.

### Out of Scope (non-goals)

- All dashboard UI phases: single-page report, crawl view, PageSpeed view, export, history, multi-tenant.
- Any subrequest-budget work. `src/crawl/site.ts:274` already caps `crawl_site` at 48 fetches, under the Free-plan ceiling. **Confirmed sufficient; do not touch.**
- Any write path to the MCP. It stays read-only analysis.
- Server OAuth / per-client quotas (`ROADMAP.md:65`).

## Capabilities

### New Capabilities

- `mcp-result-contract`: output schemas, validated `structuredContent`, published result types.
- `dashboard-bff`: service-binding BFF holding the token, one JSON route per tool.
- `bff-result-cache`: KV TTL cache + single-flight dedupe against the shared bucket.
- `dashboard-access-gate`: authentication for BFF callers.
- `mcp-error-contract`: normalized error envelope across tool and transport failures.

### Modified Capabilities

None. `openspec/specs/` is empty; this is the first captured capability set.

## Approach and Tradeoffs

| #   | Decision                                                                           | Alternatives rejected                                                                                                                      | Rationale                                                                                                                                                                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Ship output schemas **and** a published types module                               | Types-only export (no wire validation); hand-duplicated types in the dashboard (silent drift)                                              | Complementary, not alternatives: schemas give runtime validation for every client, the module gives one type source. Schemas are a prerequisite, not a follow-up.                                                                                                                                         |
| 2   | Separate Worker, same repo, service binding                                        | Same-Worker routes (couples release cadence, blurs the read-only MCP boundary); public HTTPS (token crosses the public network every call) | Service bindings are in-process RPC: the token never hits the network, `Origin` policy is bypassed legitimately, and failure/release domains stay separate.                                                                                                                                               |
| 3   | KV TTL cache + single-flight now; Durable Object coalescing behind a named trigger | Cache API only (per-colo, insufficient alone); DO first (correct but heaviest machinery for an unvalidated load profile)                   | Adding the BFF creates **no new bucket**. KV removes the dominant duplicate-panel traffic at one binding's cost. DO is the only true cross-isolate coalescer; adopt it when observability shows 429s persisting.                                                                                          |
| 4   | Ship the gate in this change                                                       | Defer to Phase 6 with OAuth                                                                                                                | Deferring ships **a token-holding open proxy to the crawler**: anyone can drain the 60/min budget shared with every consumer and crawl third-party sites. Bounded to resource abuse by `src/security/url-policy.ts`, but Phase 0, not Phase 6. Distributing per-user MCP credentials remains OAuth-gated. |
| 5   | One error envelope, translated at the BFF                                          | Pass through raw MCP text                                                                                                                  | Tool failures are plain-text `isError` (`src/server.ts:13-21`); transport failures are 401/429/503 (`src/http/auth.ts:78-112`). Clients need one shape with a stable code and `retryAfter`.                                                                                                               |

## Corrections from Exploration (record of what changed)

| Original assumption                                                                 | Verified correction                                                                                                                                                                               | Consequence                                                                                                     |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Max `crawl_site` risks the Free-plan subrequest ceiling                             | Already defended: `src/crawl/site.ts:274` passes `createFetchBudget(fetcher, 48)`; every fetch (robots, sitemaps, pages, redirect hops) shares that counter and fails closed under the 50 ceiling | Subrequest work removed from scope entirely — it would have been redundant effort                               |
| The `Origin`/`Host` policy makes a browser-facing proxy unnecessary to reason about | `src/http/request-policy.ts:21` **skips the `Origin` check when the header is absent**, so non-browser callers pass                                                                               | The BFF gate is load-bearing on its own; the `Origin` policy defends browsers only and is not an access control |

## Affected Areas

| Area                           | Impact    | Description                                                                                                                |
| ------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/server.ts`                | Modified  | Output schemas per tool; remove `as Record<string, unknown>`; structured error payload. **Higher risk: MCP tool surface.** |
| `src/types/` (new)             | New       | Published result-types entry point.                                                                                        |
| `wrangler.jsonc`               | Modified  | KV namespace binding; regenerate `Env` via `wrangler types`.                                                               |
| `bff/` (new Worker)            | New       | Routes, MCP client, cache, gate. **Higher risk: holds the shared secret.**                                                 |
| `src/http/*`, `src/security/*` | Unchanged | No edits planned. Any drift here escalates review.                                                                         |

## Risks

| Risk                                              | Likelihood | Mitigation                                                                                |
| ------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------- |
| Output schemas reject currently-passing payloads  | Med        | TDD per tool against real fixtures; schemas land before BFF work.                         |
| Stale cached results mislead users                | Med        | Short per-tool TTLs; surface result age; explicit refresh bypass.                         |
| BFF still exhausts the shared 60/min bucket       | Med        | Cache + dedupe + gate; observability on 429s triggers the DO decision.                    |
| Access gate implemented weakly                    | Med        | Secrets via `wrangler secret put`; timing-safe comparison, mirroring `src/http/auth.ts`.  |
| ~40s worst-case `crawl_site` exceeds BFF timeouts | Med        | Explicit BFF timeout above the crawl bound; loading contract; SSE stays an open decision. |
| MCP tool-surface / secret-handling changes        | —          | **Project rule: flagged higher risk.** Requires integration tests on the `/mcp` surface.  |

## Rollback Plan

- **Schemas / cast removal**: additive to the protocol; revert the `src/server.ts` commit and redeploy. If already deployed, `wrangler rollback` (or `wrangler versions deploy` to the prior version). Old clients ignoring `structuredContent` are unaffected either way.
- **KV binding**: remove from `wrangler.jsonc`, rerun `wrangler types`, redeploy. Cache is derived data — deleting the namespace loses nothing. Code must tolerate a cache miss/absent binding rather than fail closed.
- **BFF Worker**: independently deployable. Delete the deployment; `seo-mcp` keeps serving MCP hosts unchanged. Removing its service binding requires a `seo-mcp` config revert only if the binding is declared there.
- **Gate**: never rolled back independently — rolling it back while the BFF lives is exactly the open-proxy state this change exists to prevent.

## Open Decisions (need the human)

| Decision                                        | Status                                                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where the BFF lives (`DASHBOARD_ROADMAP.md:62`) | **Closed** by this proposal: sibling Worker in this repo, service binding.                                                                        |
| Dashboard-user auth before server OAuth (`:63`) | **Closed** in principle (ship a gate now, independent of OAuth). Mechanism — signed cookie vs allowlist vs local-only — still needs confirmation. |
| Crawl progress: bounded response vs SSE (`:64`) | **Open.** Affects BFF route shape. Assumed bounded response for slice 1.                                                                          |
| Frontend approach (`:60`), charting (`:61`)     | **Open, out of scope** — UI phases.                                                                                                               |
| KV vs Durable Object for coalescing             | **Open.** Recommended KV first; DO trigger must be agreed.                                                                                        |
| Cache TTL per tool                              | **Open.** Needs a product answer on acceptable result staleness.                                                                                  |

## Dependencies

- MCP SDK v2 `outputSchema` signature must be validated against installed declarations (`ROADMAP.md:70`).
- KV namespace provisioned before the cache slice.

## Success Criteria

- [ ] Every tool declares an output schema; no `as Record<string, unknown>` remains in `src/server.ts`.
- [ ] Result types are importable by a client from one published module.
- [ ] `MCP_AUTH_TOKEN` appears in no browser-reachable code path or response.
- [ ] Repeated identical dashboard requests within TTL produce one upstream MCP call.
- [ ] Unauthenticated BFF requests are rejected before any MCP call is made.
- [ ] 401/429/503 and tool errors all surface as one envelope with a stable code; 429 carries `retryAfter`.
- [ ] `pnpm test` and `pnpm typecheck` pass, including `/mcp` integration tests.
