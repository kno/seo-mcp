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
