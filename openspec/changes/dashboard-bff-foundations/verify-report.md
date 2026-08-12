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
