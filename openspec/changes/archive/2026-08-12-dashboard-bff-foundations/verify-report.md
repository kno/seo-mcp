# Verify Report — dashboard-bff-foundations, Phase 1 / PR1

Scope: this change ships as 5 chained PRs (`stacked-to-main`). Only Phase 1 (tasks 1.1-1.7, commit
`f896684` on `feat/bff-result-schemas`) is implemented. Phases 2-5 are correctly `[ ]` in `tasks.md` and
are out of scope for this verify pass.

## Verdict: PASS

## Command evidence (executed fresh)

- `pnpm test` → 254/254 passed
- `pnpm typecheck` → clean
- `pnpm format:check` → clean

## Spec compliance — `mcp-result-contract` (3 requirements / 7 scenarios, all in scope for this PR)

- **Output Schema Per Tool**: `outputSchema` present on exactly the five in-scope tools in `src/server.ts`
  (`health`, `crawl_page`, `crawl_site`, `check_links`, `analyze_pagespeed`), each root a `z.object(...)`,
  each derived field-for-field from the real result shape in `src/seo/html.ts`, `src/crawl/site.ts`,
  `src/crawl/links.ts`, `src/pagespeed/types.ts`. Optional-field and nested `LinkProbe` ok/broken/error
  state scenarios are genuinely exercised in `test/schemas/pagespeed.test.ts`, `test/schemas/site.test.ts`,
  `test/schemas/links.test.ts` — not thin coverage.
- **Structured Content Runtime Validation**: the `as Record<string, unknown>` cast is gone from the 2-arg
  `jsonResult(schema, value)` path (`src/server.ts:37-59`); the remaining single occurrence is confined to
  the legacy 1-arg branch used only by the six deferred tools. `test/server.test.ts` proves a
  schema-violating result becomes `isError: true` rather than invalid `structuredContent`.
- **Published Result Types Module**: `src/types/index.ts` uses `export type { ... }` only (verified
  `verbatimModuleSyntax: true` in `tsconfig.json:11`); `src/types/schemas.ts` re-exports runtime schemas;
  `test/types/index.test.ts` proves type identity and zero runtime exports.

## Critical regression check — the six deferred tools

`git diff f896684^ f896684 -- src/server.ts` shows zero diff lines inside the `search_console_query`,
`find_striking_distance_keywords`, `find_low_ctr_opportunities`, `get_keyword_metrics`,
`discover_keywords`, and `cluster_keywords` registration blocks — confirmed by reading the full diff
directly, and independently asserted at runtime in `test/server.test.ts`.

## Scope boundary

`git diff f896684^ f896684 --stat` touches only schema/type/result-type files, `src/server.ts`, test
files, and `tasks.md`. No `bff/` directory, no `wrangler.jsonc` change, no `src/http/*` or `src/security/*`
edit.

## Issues

None CRITICAL, WARNING, or SUGGESTION found.

## Files inspected

`src/server.ts`, `src/types/index.ts`, `src/types/schemas.ts`, `src/schemas/{health,page,site,links,
pagespeed}.ts`, `src/crawl/site.ts`, `src/seo/html.ts`, `test/server.test.ts`, `test/schemas/*.test.ts`,
`test/types/index.test.ts`, `openspec/changes/dashboard-bff-foundations/{proposal.md,design.md,tasks.md,
specs/mcp-result-contract/spec.md}`, `openspec/config.yaml`, `tsconfig.json`.

## Next recommended

`sdd-apply` for Phase 2 (BFF scaffold and access gate). Full-change `sdd-archive` should wait until all
five phases are complete; PR1 is a self-contained, independently revertible slice and may be merged on its
own before Phase 2 starts.

## Risks

None blocking. Two pre-existing open design items remain for later phases (link-check subrequest budget
defect — tracked in its own change; gate-mechanism confirmation — open decision in `design.md`) — neither
affects Phase 1 correctness.

---

# Verify Report — dashboard-bff-foundations, Phase 2 / PR2

Scope: this change ships as 5 chained PRs (`stacked-to-main`). Phase 1 (PR1, commit `f896684`) already
verified PASS. Phase 2 (PR2, commit `96377f1` on `feat/bff-result-schemas`) is now implemented: BFF
scaffold, access gate, error envelope, and the `health` route only. Phases 3-5 are correctly `[ ]` in
`tasks.md` and are out of scope for this pass.

## Verdict: PASS

## Command evidence (executed fresh, this session)

- `pnpm test` -> 284/284 passed (254 Phase 1 baseline + 30 new tests), 30 test files.
- `pnpm typecheck` -> clean (exit 0).
- `pnpm format:check` -> clean.

## Spec compliance summary

`dashboard-access-gate` (3/3 requirements in scope, all PASS): authentication precedes any MCP call
(proven at unit, router-unit, and real bff-integration level against the actual service binding: zero
stub calls unauthenticated/unknown-route, exactly one on authenticated success); timing-safe credential
comparison (reuses verifyTokens from src/http/auth.ts, digestSpy asserts hash-then-compare); dashboard
credential never reaches the browser (session cookie asserted not to contain the raw secret).

`mcp-error-contract` (in-scope dimension PASS): full 11-code table with status/message invariants;
gate-vs-upstream and upstream-vs-upstream and timeout-vs-unavailable distinctness all directly tested;
redactSecrets() unit-tested for Bearer and www-authenticate leakage but not yet wired into a live call
site (expected, deferred to Phase 3 tool_failed/upstream_* wiring).

`dashboard-bff` (only the two properties health can demonstrate, both PASS): token injected only on the
SEO_MCP fetch, absent from response headers/body; one-route-per-tool requirement correctly NOT YET
satisfied (only health routed; four remaining routes are Phase 3); timeouts/usage/platform-failure
scenarios out of scope (Phase 3/5).

## Verification specific to this pass

- bff/wrangler.jsonc services[0].service is "seo-mcp", matching root wrangler.jsonc name "seo-mcp".
- bff/src/gate.ts imports verifyTokens from ../../src/http/auth (confirmed real import, no duplication).
- git status --porcelain --ignored bff/ shows "!! bff/.dev.vars" -- genuinely git-ignored.
- bff/worker-configuration.d.ts carries the genuine wrangler-generated header and matches wrangler.jsonc
  bindings; no evidence of hand-editing.
- gate.test.ts (9), errors.test.ts (11), router.test.ts (7) genuinely cover the
  allowed/denied/unavailable matrix, the full error code table, and gate-before-dispatch ordering from
  every angle -- not thin coverage.
- git diff f896684..96377f1 --stat: every touched path is under bff/, or one of .gitignore, package.json,
  tsconfig.json, vitest.config.ts, vitest.bff-integration.config.ts (new), tasks.md, verify-report.md.
  Zero edits to src/http/_, src/security/_, root wrangler.jsonc, src/schemas/_, src/types/_, any
  Google/Ads file, src/db/_, migrations/_.

## Issues

None CRITICAL. None WARNING.

SUGGESTION: redactSecrets() has no live call site yet in Phase 2 -- flag for Phase 3's apply work so
upstream error text gets routed through it before Phase 3 wires tool_failed/upstream_* codes.

## Next recommended

sdd-apply for Phase 3 (remaining four routes, mcp-client.ts full implementation, timeouts, platform-
failure mapping). PR2 is a self-contained, independently revertible slice and is safe to merge on its own
before Phase 3 starts.

## Risks

None blocking. Carried forward: link-check subrequest-budget defect (separate change), gate-mechanism
confirmation (open design decision, does not block shared-secret-cookie as implemented), and the
documented Phase 2 deviations (plain-JS stub worker, hand-written secret-only Env augmentation,
callHealth skipping the MCP initialize handshake) -- none affect Phase 2 correctness.

---

# Verify Report — dashboard-bff-foundations, Phase 3 / PR3

Scope: this change ships as 5 chained PRs (`stacked-to-main`). Phase 1 (PR1, commit `f896684`) and Phase 2
(PR2, commit `96377f1`) already verified PASS. Phase 3 (PR3, commit `d7872ce` on `feat/bff-result-schemas`)
is now implemented: the four remaining BFF routes (`crawl_page`, `crawl_site`, `check_links`,
`analyze_pagespeed`), the full `mcp-client.ts` implementation, per-tool timeouts, and upstream
platform-failure mapping. Phases 4-5 are correctly `[ ]` in `tasks.md` and are out of scope for this pass.

## Verdict: PASS WITH WARNINGS

## Command evidence (executed fresh, this session)

- `pnpm test` -> 318/318 passed (284 Phase 2 baseline + 34 new tests), 33 test files.
- `pnpm typecheck` -> clean (exit 0).
- `pnpm format:check` -> clean.

## Spec compliance summary

`dashboard-bff` (in-scope requirements now fully demonstrable, all PASS): "One JSON Route Per Tool" — all
five routes now live in `bff/src/router.ts`, each rejecting out-of-bounds input via a normalized
`invalid_input` error before any upstream dispatch (`bff/test/router.test.ts`, 18 tests). "Bounded Handling
of Long-Running Tools" — `bff/src/timeout.ts`'s `withTimeout`/`AbortSignal.timeout(TOOL_TIMEOUT_MS[tool])`
race maps an abort to `bff_timeout`, tested for both the abort path and the normal-completion path
(`bff/test/timeout.test.ts`, 4 tests). "Upstream Platform Failures Surface as Normalized Errors" — the
`check_links` `isError: true` case maps to `tool_failed`, never an empty success, and a bounded partial
success preserves `checked/ok/broken/errors` counts unmodified (`bff/test/mcp-client.test.ts`). "BFF Holds
the Shared MCP Token" — confirmed below (token injection point).

`mcp-error-contract` (in-scope dimension, PASS): `bff_timeout` and `upstream_unavailable` are distinct
string values in the `BffErrorCode` union (`bff/src/errors.ts`), and a single test
(`callTool — upstream transport status mapping > distinguishes bff_timeout from upstream_unavailable for
the same route`) exercises both an abort/timeout case and a real 503 case in the same assertion, confirming
different codes rather than merely asserting one code exists. Transport statuses 401/429/403 also map to
distinct codes with `retryAfter` sourced from the `retry-after` header (default 60) on 429 only.

## Verification specific to this pass

- **Token injection point**: `Authorization`/`Bearer` appears in exactly one production code path —
  `bff/src/mcp-client.ts:102` (`authorization: \`Bearer ${dependencies.token}\``), on the
`dependencies.seoMcp.fetch(new Request(...))`call to the service binding. The only other occurrences in`bff/src/`are`bff/src/errors.ts`'s `BEARER_PATTERN`redaction regex (never itself constructing a header)
and a comment in`mcp-client.ts`. No other file in `bff/`constructs an`Authorization`header. Confirmed
by`grep -rn "Authorization\|Bearer" bff/src/`.
- **Input validation matches the real tool schemas**: compared `bff/src/router.ts`'s four new Zod schemas
  against `src/server.ts`'s real `inputSchema` per tool (`src/server.ts:92-182`, re-read fresh this
  session). `crawl_page` (`url` only), `check_links` (`url` only), `analyze_pagespeed` (`url`, `strategy`
  enum `mobile`/`desktop` default `mobile`, optional `apiKey`) match field-for-field. `crawl_site`'s `limit`
  (`min(1).max(20).default(10)`) and `concurrency` (`min(1).max(4).default(4)`) bounds match the real tool
  schema exactly — no silent mismatch that would accept a BFF request the tool would reject, or vice versa.
- **structuredContent re-validation**: `bff/src/router.ts` imports the five schemas directly from
  `../../src/schemas/{health,page,site,links,pagespeed}.ts` (Phase 1's published module) and passes them as
  the `schema` parameter into `callTool`; `mcp-client.ts` itself never imports or defines a second, parallel
  schema — it only receives `schema: z.ZodType<T>` as a caller-supplied argument. `bff/test/mcp-client.test.ts`
  directly exercises the mismatch case
  (`callTool — structuredContent re-validation > maps a structuredContent shape that fails the shared schema
to result_invalid`), asserting the resulting `{ ok: false, code: "result_invalid" }`, not just the happy
  path. A companion test confirms `validateUpstreamResults: false` skips re-validation and trusts the
  payload as-is.
- **Timeout vs. upstream-unavailable distinctness**: confirmed both in the type union (`bff/src/errors.ts`'s
  `BffErrorCode`, `bff_timeout` and `upstream_unavailable` are separate string literals) and at runtime — see
  the single combined test cited above under `mcp-error-contract`.
- **Platform-failure preservation for check_links**: `bff/test/mcp-client.test.ts`'s
  `callTool — platform-failure mapping (check_links)` block tests the `isError: true` path (maps to
  `tool_failed`, never empty success) and a bounded partial-success path (`checked: 12, ok: 10, broken: 2,
errors: 0` preserved unmodified through `callTool`). Reporting honestly: neither this unit test nor
  `bff/test/integration/routes.test.ts` exercises the actual Cloudflare subrequest-ceiling platform failure
  itself — that specific Workers-runtime limit cannot be simulated by the stub MCP worker, which only returns
  canned JSON-RPC frames. What IS genuinely covered is the code path the design says must handle that
  failure once it reaches the BFF as an `isError: true` tool result (which is how a caught platform-limit
  exception would surface per `src/server.ts`'s `errorResult` pattern). This is a legitimate, disclosed test
  gap, not a false claim of full coverage.
- **Regression check**: `git diff 96377f1..HEAD --stat` touches only `bff/src/{mcp-client,router,timeout}.ts`,
  `bff/test/{mcp-client,router,timeout}.test.ts`, `bff/test/integration/{routes,stub-mcp-worker}`,
  `bff/worker-configuration.d.ts`, `bff/wrangler.jsonc` (one added `vars` line), and
  `openspec/changes/dashboard-bff-foundations/{tasks.md,verify-report.md}`. Zero drift into `src/http/*`,
  `src/security/*`, root `wrangler.jsonc`, `src/schemas/*`, `src/types/*`, `bff/src/gate.ts`,
  `bff/src/session.ts` (both Phase 2 files unchanged — confirmed absent from the diff stat), or any
  Google/Ads/D1 file.
- **Test coverage honesty check**: `bff/test/mcp-client.test.ts` (14 tests), `bff/test/timeout.test.ts`
  (4 tests), and `bff/test/integration/routes.test.ts` (5 tests) were read in full. All are genuine,
  scenario-specific assertions (exact expected result objects, header value assertions, distinct-code
  assertions) — not placeholder or trivially-true coverage.

## Issues

None CRITICAL.

WARNING (carried forward from Phase 2, still unresolved): Phase 2's verify report flagged
`redactSecrets()` as having no live call site and recommended wiring it into Phase 3's `tool_failed`/
`upstream_*` message construction. This did not happen — `bff/src/errors.ts`'s `ERROR_TABLE` still uses a
fixed generic message per code (e.g. `tool_failed` -> "The requested tool call failed.") rather than
forwarding and redacting the upstream tool's own error text, and `mcp-client.ts` only re-exports
`redactSecrets` without calling it. This is a **design deviation, not a spec violation**: the
`mcp-error-contract` spec only requires that no secret leak into the message, and a fixed generic message
trivially satisfies that (it is in fact stricter than the design's originally described behavior). Flag for
Phase 4/5 or a follow-up: either wire `redactSecrets` into a real forwarding call site as design.md
describes, or update design.md to reflect the simpler fixed-message behavior actually shipped, since the
current state is a documented-but-unimplemented design decision.

SUGGESTION: none new this pass.

## Files inspected

`bff/src/mcp-client.ts`, `bff/src/router.ts`, `bff/src/errors.ts`, `bff/src/timeout.ts`, `src/server.ts`,
`bff/test/mcp-client.test.ts`, `bff/test/timeout.test.ts`, `bff/test/integration/routes.test.ts`,
`openspec/changes/dashboard-bff-foundations/{design.md,tasks.md,specs/dashboard-bff/spec.md,
specs/mcp-error-contract/spec.md}`.

## Next recommended

`sdd-apply` for Phase 4 (KV result cache and single-flight dedupe). PR3 is a self-contained, independently
revertible slice (revert the PR3 diff; Phase 2's `health` route, gate, and session cookie logic are
unaffected) and is safe to merge on its own before Phase 4 starts.

## Risks

None blocking. Carried forward: link-check subrequest-budget defect (separate change), gate-mechanism
confirmation (open design decision), and the unresolved `redactSecrets()` wiring gap (WARNING above) — none
affect Phase 3 correctness as implemented, since the spec's actual secret-leak requirement is satisfied by
the fixed generic messages currently in use.

---

# Verify Report — dashboard-bff-foundations, Phase 4 / PR4

Scope: this change ships as 5 chained PRs (`stacked-to-main`). Phase 1 (PR1, `f896684`), Phase 2 (PR2,
`96377f1`), and Phase 3 (PR3, `d7872ce`) already verified PASS / PASS WITH WARNINGS. Phase 4 (PR4, commit
`c185340` on `feat/bff-result-schemas`) is now implemented: KV-backed result cache and isolate-local
single-flight dedupe. Phase 5 is correctly `[ ]` in `tasks.md` and is out of scope for this pass.

## Verdict: PASS WITH WARNINGS

## Command evidence (executed fresh, this session)

- `pnpm test` -> 437/437 passed (46 test files).
- `pnpm typecheck` -> clean (exit 0).
- `pnpm format:check` -> clean (exit 0).

## Spec compliance — `bff-result-cache` (3 requirements / 6 scenarios, all in scope for this PR)

- **KV-Backed Result Cache With Configurable TTL** (PASS): `bff/src/cache.ts`'s `CACHE_TTL_SECONDS` is a
  per-tool map (not a single hardcoded value), every value clamped to `[60, 86400]` via `clampTtlSeconds`.
  "Repeated identical request within TTL served from cache" and "expired entry triggers a fresh call" are
  both proven at the real-KV integration level (`bff/test/integration/cache.test.ts`, real `RESULT_CACHE`
  binding via `SELF.fetch`, asserting the stub upstream call counter stays at 1 across a repeated request)
  and the expiry path is proven at the unit level against a fake KV whose stored `expiresAt` has already
  elapsed (`bff/test/cache.test.ts` -- "treats an entry past its own expiresAt as a miss").
- **Best-Effort Single-Flight Dedupe** (PASS): `bff/src/single-flight.ts`'s module-level
  `Map<string, Promise<T>>` is genuinely exercised for both the leader/follower coalescing case (one real
  call for two concurrent identical keys) and the non-coalescing case (different keys each get their own
  call) in `bff/test/single-flight.test.ts`. Cross-isolate coalescing is correctly NOT asserted -- the test
  file's closing comment explicitly documents this as an accepted best-effort limitation, matching the
  spec's "MAY independently invoke" scenario wording exactly.
- **Cache Failure Does Not Block Requests** (PASS, with a coverage-precision WARNING below): confirmed by
  direct code inspection -- `getCached`/`putCached` wrap every KV `get`/`put` call in try/catch and return
  `{status:"unavailable"}` / resolve silently on throw; `dispatch()` in `router.ts` treats `"unavailable"`
  identically to `"miss"` (same `withSingleFlight(key, callUpstream)` call, no branching), so a throwing KV
  structurally cannot fail the request. "KV binding is not configured" is proven end-to-end: every one of
  the several dozen tests in `bff/test/router.test.ts` uses a `fakeEnv()` that never sets `RESULT_CACHE`
  (left `undefined`), and each one asserts the tool is still invoked and a successful response returned.

## Verification specific to this pass (re-read fresh, not trusting the apply report)

1. **Cache key stability** -- confirmed genuinely order-independent. `canonicalJson` (`bff/src/cache.ts:61-75`)
   recursively sorts object keys before `JSON.stringify`; `bff/test/cache.test.ts` directly asserts
   `canonicalJson({a:1,b:2}) === canonicalJson({b:2,a:1})`, including a nested-object variant, and
   `cacheKey("crawl_site", {url,limit})` produces the identical hash regardless of field order.
2. **apiKey exclusion, gating both paths** -- `isCacheable(tool, inputs)` (`bff/src/cache.ts:98-105`) checks
   specifically for `analyze_pagespeed` + a non-empty string `apiKey`. `router.ts:108-115`'s `dispatch()`
   checks `isCacheable` BEFORE computing `cacheKey` or calling `withSingleFlight` -- an apiKey-bearing request
   takes an early-return branch that calls `callUpstream()` directly, so it is excluded from single-flight as
   well as the cache, not merely from the cache. This is proven at the real integration level, not just a
   unit test on `isCacheable` in isolation: `bff/test/integration/cache.test.ts`'s `"never caches an
analyze_pagespeed request carrying an explicit apiKey"` sends the SAME apiKey-bearing request twice and
   asserts the upstream call counter increments both times (`before + 1`, then `before + 2`) with
   `cacheStatus: "bypass"` on both -- i.e., upstream is hit every time, never served from a coalesced or
   cached result.
3. **KV-failure tolerance** -- `bff/src/cache.ts` wraps every `kv.get`/`kv.put` in try/catch
   (`getCached:145-157`, `putCached:181-185`), confirmed by reading the implementation directly.
   `bff/test/cache.test.ts`'s `"is unavailable when the KV get() throws"` and `"does not throw when the KV
put() throws"` exercise a `throwingKv()` fake and assert the outcome is `{status:"unavailable"}` /
   resolves without throwing -- genuine, not thin. However: this throwing-KV exercise stops at the isolated
   `cache.ts` function level. No test anywhere in the suite (unit, `router.test.ts`, or
   `bff/test/integration/cache.test.ts`) drives a throwing `RESULT_CACHE` binding through the actual
   `dispatch`/`handleRequest` path and asserts the end-to-end JSON response carries `cacheStatus:
"unavailable"` with a successful upstream-backed result. `router.test.ts`'s `fakeEnv()` never sets
   `RESULT_CACHE` at all (always `undefined`, not a throwing mock), so every one of its tests exercises only
   the "absent binding" half of this requirement, not "present but throwing." Since `dispatch()` branches
   identically on `"unavailable"` and `"miss"` (no special-casing), this is a low-severity coverage gap, not
   a logic defect -- flagged as WARNING below.
4. **Single-flight cleanup on failure** -- `single-flight.ts:29-33`'s `finally` block genuinely deletes the
   map entry (`inFlight.delete(key)`), not merely present as boilerplate. Directly confirmed by reading the
   block. `bff/test/single-flight.test.ts` exercises exactly the requested scenario: `"allows a fresh leader
for the same key after a prior failure cleared it"` -- a first `withSingleFlight` call that throws,
   followed by a second call for the identical key that succeeds normally (not stuck awaiting the dead
   promise). A companion test also confirms the leader's rejection propagates to a concurrently-waiting
   follower rather than hanging.
5. **TTL clamp** -- every `CACHE_TTL_SECONDS` value (60, 3600, 3600, 1800, 21600) is within `[60, 86400]`, and
   the clamp itself is exercised directly from both directions: `"clamps a value below the minimum up to
60"` (input `1`), `"clamps a value above the maximum down to 86400"` (input `1_000_000`), plus a dedicated
   `putCached`-level test asserting `kv.put` is called with `expirationTtl: MIN_TTL_SECONDS` when a 5-second
   TTL is requested -- not just that the chosen defaults happen to already be in range.
6. **Refresh bypass still writes** -- confirmed by reading `router.ts:120-141`: `shouldBypassCacheRead` only
   gates the `getCached` read call; the `withSingleFlight`/`putCached` write path below runs unconditionally
   whenever the upstream call succeeds, regardless of whether the read was bypassed. Proven end-to-end in
   `bff/test/integration/cache.test.ts`'s `"bypasses the cache read with ?refresh=1 but still repopulates
it"`: a `?refresh=1` request forces a second real upstream call even though a cached entry already exists,
   and a subsequent plain request is then served `"hit"` from the refreshed entry without a third upstream
   call.
7. **Test coverage honesty** -- `bff/test/cache.test.ts` (23 tests), `bff/test/single-flight.test.ts` (6
   tests), and `bff/test/integration/cache.test.ts` (4 tests) were read in full. All are genuine,
   scenario-specific assertions against real or realistically-faked KV behavior -- not placeholder or
   trivially-true coverage. The one identified gap is item 3 above.

## Regression / scope check

- `git show --stat c185340` (this PR's own commit, isolated from other commits merged into this branch in
  the interim) touches exactly: `bff/src/{cache,router,single-flight}.ts`, `bff/test/{cache,single-flight}
.test.ts`, `bff/test/integration/{cache,stub-mcp-worker}`, `bff/worker-configuration.d.ts`,
  `bff/wrangler.jsonc` (9-line KV binding addition, placeholder ID with a comment directing a real
  `wrangler kv namespace create` before production deploy), and `tasks.md`.
- Confirmed via `git diff fe7888b..HEAD` restricted to `bff/src/gate.ts bff/src/session.ts bff/src/timeout.ts
src/http/ src/security/ wrangler.jsonc src/schemas/ src/types/` -> zero lines. All Phase 2/3 frozen files
  and root-level config/schema/type files are untouched.
- Two commits unrelated to this PR (`2f8d5dc` docs reconciliation, plus the broader `DASHBOARD_ROADMAP.md`/
  `dashboard-insights` diffs visible in a naive `fe7888b..HEAD` diff) belong to separate planning work merged
  into this branch between Phase 3 and Phase 4 -- not part of PR4's own commit. Isolating `git show --stat
c185340` confirms PR4 itself carries none of that drift.

## Issues

None CRITICAL.

WARNING: the "KV read fails transiently" scenario (spec `bff-result-cache`, third requirement) is proven
genuinely at the isolated `cache.ts` function level (`getCached`/`putCached` against a throwing fake KV) but
never end-to-end through `dispatch`/`handleRequest` with an actual throwing `RESULT_CACHE` binding -- every
`router.test.ts` test instead exercises the "binding absent" half of the same requirement (`RESULT_CACHE`
left `undefined` in `fakeEnv()`), and the real-KV integration suite never injects a throwing binding either.
Code inspection shows `dispatch()` cannot distinguish `"unavailable"` from `"miss"` (identical downstream
code path), so this is very unlikely to hide a real defect, but it is a genuine coverage gap relative to
task 4.4's own stated intent ("KV binding absent OR throwing yields cacheStatus: 'unavailable' ... never
fail-closed"). Recommend a follow-up test (`fakeEnv({ RESULT_CACHE: throwingKv() })` through
`handleRequest`, or an integration-level throwing KV double) before or shortly after Phase 5 -- not blocking
this PR's merge.

SUGGESTION: none new this pass. Carried forward (non-blocking, not this PR's concern): Phase 2/3's
`redactSecrets()` still has no live call site.

## Files inspected

`bff/src/cache.ts`, `bff/src/single-flight.ts`, `bff/src/router.ts`, `bff/test/cache.test.ts`,
`bff/test/single-flight.test.ts`, `bff/test/router.test.ts`, `bff/test/integration/cache.test.ts`,
`bff/wrangler.jsonc`, `openspec/changes/dashboard-bff-foundations/{design.md,tasks.md,
specs/bff-result-cache/spec.md}`.

## Next recommended

`sdd-apply` for Phase 5 (usage/headroom observability). PR4 is a self-contained, independently revertible
slice (revert the PR4 diff; Phase 3's four tool routes, timeouts, and platform-failure mapping are
unaffected -- they simply lose caching/dedupe, not correctness) and is safe to merge on its own before Phase
5 starts.

## Risks

None blocking. Carried forward: link-check subrequest-budget defect (separate change), gate-mechanism
confirmation (open design decision), and the unresolved `redactSecrets()` wiring gap -- none affect Phase 4
correctness. New this pass: the throwing-KV end-to-end coverage gap (WARNING above) -- low risk given the
identical code path for "absent" and "throwing," but should be closed with an explicit test before this
becomes a load-bearing assumption for later phases (e.g. Phase 5's observability work reading cache-status
signals).

---

# Verify Report — dashboard-bff-foundations, Phase 5 / PR5 (final)

Scope: this change ships as 5 chained PRs (`stacked-to-main`). Phase 1 (PR1, `f896684`), Phase 2 (PR2,
`96377f1`), Phase 3 (PR3, `d7872ce`), and Phase 4 (PR4, `c185340`) already verified PASS / PASS WITH
WARNINGS. Phase 5 (PR5, commit `c5ada29` on `feat/bff-result-schemas`) is now implemented: the read-only
usage/headroom source route and structured `bff.upstream` logging. This is the LAST phase — all 38 tasks
(1.1 through 5.4) are `[x]` in `tasks.md`. This pass also performs a holistic check across all 5 specs now
that every phase is complete.

## Verdict: PASS WITH WARNINGS

## Task completion

`grep -c '\[x\]' tasks.md` returns 38; `grep -c '\[ \]' tasks.md` returns 0. All tasks complete, no pending
work.

## Command evidence (executed fresh, this session)

- `pnpm test` -> 444/444 passed (47 test files; 437 Phase 1-4 baseline + 7 new in `bff/test/usage.test.ts`).
- `pnpm typecheck` -> clean (exit 0).
- `pnpm format:check` -> clean (exit 0).

## Spec compliance — `dashboard-bff`'s "Read-Only Usage and Headroom Source" (2 scenarios, in scope for PR5)

- **Headroom is reported as an estimate** (PASS): `bff/src/usage.ts`'s `UsageSnapshot` interface declares
  `estimate: true` as a TypeScript **literal type**, not `boolean` — confirmed by direct read of the
  interface (`usage.ts:43-49`). This means the field cannot silently become `false` at runtime; the type
  system itself enforces the spec's "MUST NOT present derived headroom as an authoritative upstream figure"
  clause, not merely a docstring promise. `bff/test/usage.test.ts` exercises this through both the isolated
  module (`estimate` always `true`, paired with a non-empty explanatory `note`) AND end-to-end through
  `handleRequest` for the real `GET /api/usage` route: one test asserts 401 for an unauthenticated request,
  a second asserts 200 with `estimate: true` in the JSON body for an authenticated request — a genuine
  route-level test, not just a call into `usage.ts` directly.
- **Served result carries its age** (PASS): `resultAge` is computed in `bff/src/cache.ts`'s `getCached`
  (`Math.floor((Date.now() - entry.storedAt) / 1000)`, `cache.ts:150-154`) — from the cache entry's own
  stored timestamp (`storedAt`, set at `putCached` time in Phase 4), never from request-start time. No new
  code was needed for this half since Phase 4 already wired it correctly end-to-end into `router.ts`'s
  `toolResponse` and Phase 4's own `bff/test/integration/cache.test.ts` already asserts `resultAge >= 0` on
  a cache hit. Re-derived and confirmed directly from `cache.ts`, not trusted from the apply report.

## keyHash identity (re-traced across `router.ts` and `mcp-client.ts`)

`router.ts:106` computes `const key = await cacheKey(toolName, args)` unconditionally, before the
`isCacheable` branch. That same `key` value is passed as `keyHash: key` into the `callTool` dependencies
object on both the cacheable path (`callUpstream`, line 108-116) and the non-cacheable bypass path (same
`callUpstream` closure, invoked at line 124). In `mcp-client.ts`, the outer `callTool` wrapper passes
`dependencies.keyHash` straight into `logUpstreamEvent(...)` without any independent hashing — confirmed by
reading `mcp-client.ts:127-141` directly: `keyHash` in the log line is the literal same value `cacheKey()`
produced for that call, threaded through, never recomputed. Live stdout during the full test run (captured
above) shows the log line's `keyHash` matching the exact `v1:{tool}:{sha256hex}` shape `cacheKey()`
produces.

## Full-change task completion

Confirmed directly against `tasks.md`, not the apply report: 38 tasks marked `[x]`, 0 marked `[ ]`.

## Holistic spec compliance across all 5 specs (17 requirements total, first pass where all can be checked together)

- **`mcp-result-contract`** (3 requirements) — satisfied by Phase 1 (PR1): output schemas, cast removal,
  published types module. Re-confirmed unchanged this pass (PR5's commit diff stat shows zero touch to
  `src/schemas/*`, `src/types/*`, `src/server.ts`).
- **`dashboard-bff`** (5 requirements) — Token-holding and One-Route-Per-Tool by Phase 2/3; Bounded
  Handling of Long-Running Tools and Upstream Platform Failures by Phase 3; Read-Only Usage and Headroom
  Source by Phase 5 (this pass, confirmed above). All 5 now demonstrated.
- **`dashboard-access-gate`** (3 requirements) — satisfied by Phase 2 (PR2): auth precedes any MCP call,
  timing-safe comparison, credential never reaches the browser. Unchanged this pass.
- **`bff-result-cache`** (3 requirements) — satisfied by Phase 4 (PR4): KV-backed cache with TTL, best-
  effort single-flight dedupe, cache failure does not block requests (with the coverage-precision WARNING
  below). Unchanged this pass — PR5 only reordered `cacheKey()`'s call site, still covered by the full
  existing cache test suite (all still passing).
- **`mcp-error-contract`** (3 requirements) — the code-mapping table and gate/upstream/timeout distinctness
  by Phase 2/3. PR5 adds the `status` field to the structured `bff.upstream` log line, reusing the same
  `BffErrorCode` values already established — no new requirement surface, no regression.

All 17 requirements across all 5 specs are now satisfied by some phase's implementation, confirmed by
fresh code inspection this session, not solely by re-reading prior verify reports.

## The two carried-forward WARNINGs — re-checked fresh, both still present

1. **`redactSecrets()` has no live call site.** Searching `redactSecrets` across `bff/src/` and
   `bff/test/` shows: defined in `errors.ts:116`, imported and re-exported (unchanged, comment-only) in
   `mcp-client.ts:47,218`, and exercised only by its own unit tests in `errors.test.ts`. No production call
   site anywhere. Unchanged by Phase 5 — this phase's log-line wiring never touches the redaction/message-
   forwarding path (the structured `bff.upstream` log line carries only `tool`/`keyHash`/`status`, never
   free-text upstream error content, so there was no natural point of contact). Not incidentally resolved.
2. **KV-failure path lacks an end-to-end router-level test.** Searching for `RESULT_CACHE` usage in
   `router.test.ts` and for `throwingKv`/a throwing binding anywhere outside `cache.test.ts` confirms:
   `throwingKv()` is defined and used only in `bff/test/cache.test.ts` (isolated `cache.ts` function level),
   never threaded through `handleRequest`/`dispatch` in `router.test.ts` or the real-KV integration suite.
   Unchanged by Phase 5 — PR5 touched `router.ts` only to reorder `cacheKey()` computation and pass
   `keyHash`, not the KV get/put failure paths. Not incidentally resolved.

Both WARNINGs remain exactly as previously described; PR5 neither fixed nor worsened either.

## Regression check — PR5's own commit scope

The PR5 commit (isolated from the chain) touches exactly: `bff/src/mcp-client.ts`, `bff/src/router.ts`,
`bff/src/usage.ts` (new), `bff/test/usage.test.ts` (new), and
`openspec/changes/dashboard-bff-foundations/tasks.md`. Zero drift into `src/http/*`, `src/security/*`,
root `wrangler.jsonc`, `src/schemas/*`, `src/types/*`, `bff/src/gate.ts`, `bff/src/session.ts`,
`bff/src/timeout.ts`, `bff/src/single-flight.ts` — all frozen files from earlier phases are confirmed
absent from this commit's diff stat.

## Issues

None CRITICAL.

WARNING (carried forward, unresolved, non-blocking — item 1 above): `redactSecrets()` still has no
live call site; `mcp-error-contract`'s actual secret-leak requirement remains satisfied by the fixed
generic per-code messages currently in use, so this is a documented design-vs-implementation gap, not a
spec violation.

WARNING (carried forward, unresolved, non-blocking — item 2 above): the KV-failure ("binding present
but throwing") path is proven only at the isolated `cache.ts` function level, never end-to-end through
`dispatch`/`handleRequest`. Since `dispatch()` cannot distinguish `"unavailable"` from `"miss"` (identical
downstream code path, confirmed again this pass), this is very unlikely to hide a real defect, but remains
a genuine coverage gap relative to task 4.4's own stated intent.

SUGGESTION: none new this pass.

## Files inspected

`bff/src/usage.ts`, `bff/src/router.ts`, `bff/src/mcp-client.ts`, `bff/src/cache.ts`, `bff/src/errors.ts`,
`bff/test/usage.test.ts`, `bff/test/cache.test.ts`, `bff/test/router.test.ts`,
`openspec/changes/dashboard-bff-foundations/{design.md,tasks.md,verify-report.md,
specs/{dashboard-bff,mcp-result-contract,dashboard-access-gate,bff-result-cache,mcp-error-contract}/spec.md}`.

## Next recommended

`sdd-archive`. This is the final phase; all 38 tasks are complete, all 17 requirements across the 5 specs
are demonstrated with passing runtime evidence, and the only open items are two low-severity, well-
understood, non-blocking WARNINGs (both pre-existing, both unaffected by Phase 5, both documented as
deliberate deferrals rather than defects).

## Risks

None blocking archive. Carried forward: link-check subrequest-budget defect (tracked in a separate
change), gate-mechanism confirmation (open design decision, does not affect the shared-secret-cookie
implementation as shipped), the `redactSecrets()` wiring gap, and the KV-failure end-to-end coverage gap.
Recommend a lightweight follow-up change to either wire `redactSecrets()` into a real call site or update
`design.md` to reflect the simpler fixed-message behavior actually shipped, and to add one
`handleRequest`-level test with a throwing `RESULT_CACHE` binding. Neither blocks archiving
`dashboard-bff-foundations` as complete.

## Overall change verdict — dashboard-bff-foundations (all 5 phases)

| Phase                                             | PR  | Commit    | Verdict            |
| ------------------------------------------------- | --- | --------- | ------------------ |
| 1 — Result Schemas & Cast Removal                 | PR1 | `f896684` | PASS               |
| 2 — BFF Scaffold & Access Gate                    | PR2 | `96377f1` | PASS               |
| 3 — Remaining Routes, Timeouts, Platform Failures | PR3 | `d7872ce` | PASS WITH WARNINGS |
| 4 — Result Cache & Single-Flight                  | PR4 | `c185340` | PASS WITH WARNINGS |
| 5 — Usage/Headroom Source & Observability         | PR5 | `c5ada29` | PASS WITH WARNINGS |

**Full-change verdict: PASS WITH WARNINGS — READY FOR ARCHIVE.**

All 38 tasks complete. All 17 requirements across the 5 specs (`mcp-result-contract`, `dashboard-bff`,
`dashboard-access-gate`, `bff-result-cache`, `mcp-error-contract`) are satisfied with passing runtime
evidence, verified fresh in this session rather than trusted from prior reports. `pnpm test` 444/444,
`pnpm typecheck` clean, `pnpm format:check` clean, on the actual current worktree state. Two WARNINGs
persist unchanged across PR3, PR4, and PR5 (`redactSecrets()` unused; KV-failure path untested
end-to-end) — both are low-severity, well-understood, non-blocking coverage/design-documentation gaps, not
spec violations or logic defects, and do not warrant blocking `sdd-archive`. Recommend opening a small
follow-up change to close both before they become load-bearing assumptions for a future dashboard-bff
change.
