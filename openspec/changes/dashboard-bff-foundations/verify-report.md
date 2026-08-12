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
