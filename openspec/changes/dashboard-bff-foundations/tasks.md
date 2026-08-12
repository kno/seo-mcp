# Tasks: Dashboard BFF Foundations

## Review Workload Forecast

| Field                   | Value                           |
| ----------------------- | ------------------------------- |
| Estimated changed lines | 1800-2800                       |
| 400-line budget risk    | High                            |
| Chained PRs recommended | Yes                             |
| Suggested split         | PR1 -> PR2 -> PR3 -> PR4 -> PR5 |
| Delivery strategy       | ask-on-risk                     |
| Chain strategy          | pending (user decision needed)  |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal                                                               | Likely PR | Focused test command                                 | Runtime harness                                 | Rollback boundary                                                  |
| ---- | ------------------------------------------------------------------ | --------- | ---------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------ |
| 1    | Output schemas, cast removal, `src/types`                          | PR1       | `pnpm test -- schemas server`                        | `pnpm typecheck` (cast gone)                    | Revert `src/server.ts` + `src/schemas/*` + `src/types/*` commit    |
| 2    | BFF skeleton, `wrangler.jsonc`, gate, `health` route               | PR2       | `pnpm test -- bff/test/gate bff/test/router`         | `vitest.bff-integration.config.ts` stub-MCP run | Delete `bff/` deployment; PR1 unaffected                           |
| 3    | Remaining 4 routes, mcp-client, timeouts, platform-failure mapping | PR3       | `pnpm test -- bff/test/mcp-client bff/test/timeout`  | Same bff-integration harness                    | Revert PR3 diff; `health` route (PR2) keeps working                |
| 4    | KV cache + single-flight dedupe                                    | PR4       | `pnpm test -- bff/test/cache bff/test/single-flight` | bff-integration KV read/write/TTL scenario      | Drop KV binding from `bff/wrangler.jsonc`; routes still serve live |
| 5    | Usage/headroom source + structured logging                         | PR5       | `pnpm test -- bff/test/usage`                        | N/A - pure accounting, no live upstream needed  | Remove usage route/module; no dependent slice                      |

## Phase 1: Result Schemas & Cast Removal (`mcp-result-contract`) — PR1

- [x] 1.1 RED: schema tests in `test/schemas/*.test.ts` for `health`, `crawl_page`, `crawl_site`, `check_links`, `analyze_pagespeed` fixtures incl. optional-field and nested `LinkProbe` state cases.
- [x] 1.2 GREEN: add `src/schemas/{health,page,site,links,pagespeed}.ts` Zod object schemas; convert result interfaces to `z.infer` aliases in `src/seo/html.ts`, `src/crawl/site.ts`, `src/crawl/links.ts`, `src/pagespeed/types.ts`.
- [x] 1.3 RED: `test/server.test.ts` — tool registration exposes `outputSchema`; non-conforming result becomes `tool_failed`, not silent cast.
- [x] 1.4 GREEN: `src/server.ts` — add `outputSchema` per tool, typed `jsonResult` helper, remove `as Record<string, unknown>`.
- [x] 1.5 RED: `test/types/index.test.ts` — imported type identical to server's, zero runtime import under `verbatimModuleSyntax`.
- [x] 1.6 GREEN: create `src/types/index.ts` (type-only re-exports) and `src/types/schemas.ts` (runtime schema re-exports).
- [x] 1.7 Verify `pnpm typecheck` and `test/integration/**` still pass; structured content round-trips.

## Phase 2: BFF Scaffold & Access Gate (`dashboard-bff`, `dashboard-access-gate`) — PR2

- [x] 2.1 Create `bff/wrangler.jsonc` (service binding `SEO_MCP`, vars, no KV yet); run `wrangler types -c bff/wrangler.jsonc` for `bff/worker-configuration.d.ts`.
- [x] 2.2 Wire `tsconfig.json` (`include` += `bff`), `vitest.config.ts` (unit project += `bff/test/**`), new `vitest.bff-integration.config.ts` with stub-MCP auxiliary worker; add `package.json` scripts `dev:bff`, `deploy:bff`, `types:bff`.
- [x] 2.3 RED: `bff/test/gate.test.ts` — allowed/denied/unavailable outcomes; timing-safe compare; unauthenticated request never reaches the service binding.
- [x] 2.4 GREEN: `bff/src/gate.ts`, `bff/src/session.ts` — `shared-secret-cookie` strategy over `GateStrategy` interface, HMAC session cookie, `POST /auth/session` using imported `verifyTokens`.
- [x] 2.5 RED: `bff/test/errors.test.ts` — code-mapping table (`gate_unauthorized` .. `bff_timeout`) with HTTP status and sanitized message.
- [x] 2.6 GREEN: `bff/src/errors.ts` — `BffError`/`BffOk` types, code table, `Bearer`/auth-header redaction.
- [x] 2.7 RED: `bff/test/router.test.ts` — `GET /api/tools/health` authorizes before any upstream call; unknown tool route returns 404 without a proxied call.
- [x] 2.8 GREEN: `bff/src/router.ts`, `bff/src/index.ts`, `bff/src/mcp-client.ts` (health only) — gate wired before dispatch.
- [x] 2.9 Integration RED+GREEN: `bff/test/integration/gate-ordering.test.ts` against `vitest.bff-integration.config.ts` — asserts stub MCP receives zero calls for unauthenticated/unknown-route requests.
- [x] 2.10 Add `bff/.dev.vars` (git-ignored) and `.gitignore` entry.

## Phase 3: Remaining Routes, Timeouts, Platform Failures — PR3

- [x] 3.1 RED: `bff/test/router.test.ts` cases for `crawl_page`, `crawl_site` (`limit` 1-20, `concurrency` 1-4 validation), `check_links`, `analyze_pagespeed` (`apiKey` optional) input validation.
- [x] 3.2 GREEN: extend `bff/src/router.ts` with the four remaining routes; Zod input schemas per route.
- [x] 3.3 RED: `bff/test/mcp-client.test.ts` — token injected only on the service-binding fetch; structuredContent re-validated against shared schema; malformed reply -> `upstream_protocol`.
- [x] 3.4 GREEN: `bff/src/mcp-client.ts` full implementation, `VALIDATE_UPSTREAM_RESULTS` flag.
- [x] 3.5 RED: `bff/test/timeout.test.ts` — per-tool `TOOL_TIMEOUT_MS` race maps `AbortError` to `bff_timeout`; normal-latency call completes.
- [x] 3.6 GREEN: `bff/src/timeout.ts` using `AbortSignal.timeout`.
- [x] 3.7 RED: `bff/test/mcp-client.test.ts` (platform-failure case) — `check_links` subrequest-ceiling failure surfaces as normalized error, never empty success; bounded `checked/ok/broken/errors` counts preserved.
- [x] 3.8 GREEN: map upstream 401/429/503/403 statuses to `upstream_*` codes with `retryAfter` from header.
- [x] 3.9 Integration RED+GREEN: `bff/test/integration/routes.test.ts` — stub MCP asserts `Authorization` header per route; 401/429/503 mapping exercised without the real limiter.

## Phase 4: Result Cache & Single-Flight (`bff-result-cache`) — PR4

- [x] 4.1 Add `kv_namespaces` binding to `bff/wrangler.jsonc`; regenerate `Env` via `wrangler types -c bff/wrangler.jsonc`.
- [x] 4.2 RED: `bff/test/cache.test.ts` — cache key `v1:{tool}:{sha256(canonicalJson(...))}`; `analyze_pagespeed` with `apiKey` never cached; TTL clamp `[60, 86400]`; expired entry is a miss.
- [x] 4.3 GREEN: `bff/src/cache.ts` — get/put, key normalization, TTL clamping, `?refresh=1`/`no-cache` bypass (still writes).
- [x] 4.4 RED: `bff/test/cache.test.ts` — KV binding absent or throwing yields `cacheStatus: "unavailable"` and a direct upstream call, never fail-closed.
- [x] 4.5 GREEN: wrap cache reads/writes with try/catch fallback in `bff/src/router.ts`.
- [x] 4.6 RED: `bff/test/single-flight.test.ts` — leader/follower coalescing with a fake client; entries deleted in `finally`; cross-isolate case documented as best-effort (no assertion of coalescing).
- [x] 4.7 GREEN: `bff/src/single-flight.ts` — module-level `Map<string, Promise<Result>>` keyed by content hash only.
- [x] 4.8 Integration RED+GREEN: `bff/test/integration/cache.test.ts` — real KV read/write/TTL under `isolatedStorage`; repeated identical request served without a second upstream call.

## Phase 5: Usage/Headroom Source & Observability — PR5

- [x] 5.1 RED: `bff/test/usage.test.ts` — reports own observed call volume and window, marked as an estimate, never an authoritative remaining count; cached responses carry `resultAge`.
- [x] 5.2 GREEN: `bff/src/usage.ts` and a read-only route exposing the accounting; wire `resultAge` into `BffOk`.
- [x] 5.3 GREEN: structured `{"event":"bff.upstream","tool","keyHash","status"}` logging in `mcp-client.ts` for the DO-trigger thresholds (1% 429s / 5% duplicate-key calls per 10s over 24h).
- [x] 5.4 Verify full suite: `pnpm test`, `pnpm typecheck`, `pnpm format:check`; confirm no drift in `wrangler.jsonc`, `src/http/*`, `src/security/*`.

## Key Learnings

1. Design already resolved the `outputSchema` SDK signature; tasks only need to wire it, not re-validate it.
2. Five slices align 1:1 with the design's migration plan, keeping each PR independently revertable.
3. The gate ships in the same PR as the first route per design, never deferred to a later slice.
