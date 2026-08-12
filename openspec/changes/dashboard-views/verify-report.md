# Verify Report — dashboard-views, Phase 1 / PR1

Scope: this change ships as 7 chained PRs (`stacked-to-main`). Only Phase 1 (tasks 1.1-1.5, commit
`f752133` on `feat/dashboard-views-build-wiring`) is implemented: SPA build wiring and gate-before-assets
ordering. Phases 2-7 are correctly `[ ]` in `tasks.md` and are out of scope for this pass.

## Verdict: PASS WITH WARNINGS

## Command evidence (executed fresh, this session)

- `pnpm test` -> 469/469 passed, 49 test files (461 pre-existing + 8 new in
  `bff/test/integration/asset-gate-ordering.test.ts`).
- `pnpm typecheck` -> clean (exit 0); confirmed the script genuinely runs both projects
  (`"typecheck": "tsc --noEmit && tsc --noEmit -p bff/ui"` in `package.json`).
- `pnpm format:check` -> clean (exit 0).

## Task completion

`tasks.md` Phase 1: 1.1-1.5 all `[x]`. Phases 2-7: all `[ ]`, correctly untouched. No unchecked task in the
in-scope phase.

## Spec / design compliance for this PR

No `dashboard-shell` requirement is implementable yet — Phase 1 ships zero UI components (a placeholder
`main.ts` only), so the shell's error-mapping/state/keyboard/responsive requirements are not yet
demonstrable and are correctly out of scope. This PR instead demonstrates `design.md`'s own
"asset serving cannot precede the gate" decision, which every later view depends on:

- **`assets.run_worker_first: true`** — confirmed present in `bff/wrangler.jsonc:37`, matching the
  design's chosen option verbatim, with a comment citing the same `node_modules/wrangler/config-schema.json`
  verification the design describes.
- **`asset-gate-ordering.test.ts` is a genuine, non-decorative RED/GREEN proof** — re-read the full file.
  It asserts 401 `gate_unauthorized` for unauthenticated `/`, `/index.html`, `/favicon.ico`, an unknown deep
  link, and the hashed JS bundle (5 distinct cases), and 200 for the same paths authenticated (including a
  content-type check on the JS response and an SPA-fallback check on the deep link). The apply session's own
  record (`sdd/dashboard-views/apply-progress`, item 2) documents the actual RED run: 4/5 unauthenticated
  cases returned 200 before `run_worker_first: true` was set (real bypass, not simulated), then GREEN after.
  This session did not re-run that RED regression (it would require reverting the wrangler config), but the
  test's assertions and the apply record's cited counts are internally consistent and the test as currently
  written is the correct shape to catch a regression if the flag were ever removed.
- **The hashed bundle path is discovered dynamically, not hardcoded.** `beforeAll` fetches the real built
  `/` authenticated, regex-matches `<script src="/assets/...\.js">` out of the served `index.html`, and uses
  that path for both the unauthenticated-rejection and authenticated-serving assertions. Confirmed no literal
  `index-<hash>.js` string exists anywhere under `bff/ui` or `bff/test` (only the actual built artifact,
  `bff/ui/dist/index.html`, contains one — expected build output, not source, and correctly gitignored).
- **`/api/*` 404 guard** — `bff/src/router.ts:237-239` returns `404` for any unmatched `/api/`-prefixed
  path before falling through to `env.ASSETS.fetch`. This is a deliberate, commented deviation from
  `design.md`'s literal `/api/*` → `ASSETS.fetch` ordering diagram, justified in both the router's own
  comment and the apply-progress record: an unmatched API path should read as a bad API call, not a page.
  No dedicated test exercises this guard specifically (confirmed by inspection — `router.test.ts`'s
  `fakeEnv()` never sets `ASSETS`, so it cannot reach this branch, and `asset-gate-ordering.test.ts` only
  exercises static/deep-link paths, none under `/api/`) — flagged as a coverage gap below, not a defect.
- **`tsconfig` separation** — root `tsconfig.json` explicitly excludes `bff/ui` (`"exclude": ["bff/ui"]`)
  even though its own `include` (`"bff"`) would otherwise recurse into it; `bff/ui/tsconfig.json` uses
  `lib: ["ES2022","DOM","DOM.Iterable"]` and carries no Workers types. `pnpm typecheck`'s two-command chain
  confirmed to run both projects and both passed clean.
- **`bff/ui/dist` is gitignored and not committed** — `.gitignore` contains `bff/ui/dist/`; `git show --stat
f752133` lists no `dist/` path; `git check-ignore -v` confirms the path is ignored.

## Regression / scope check

`git show --stat f752133` (this PR's own commit, isolated) touches exactly: `.gitignore`,
`.prettierignore`, `bff/src/router.ts`, `bff/test/integration/asset-gate-ordering.test.ts`,
`bff/ui/{index.html,public/favicon.ico,src/main.ts,tsconfig.json,vite.config.ts}`,
`bff/worker-configuration.d.ts` (regenerated), `bff/wrangler.jsonc`, `openspec/changes/dashboard-views/
tasks.md`, `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `vitest.config.ts`, `vitest.ui.config.ts`.

Zero drift into `src/http/*`, `src/security/*`, root `wrangler.jsonc`, `src/schemas/*`, `src/types/*`, or
any of the frozen `bff/src/{gate,session,timeout,single-flight,usage,errors,cache,mcp-client}.ts` files —
the only `bff/src/*` file touched is `router.ts`, and its diff is confined to the `/api/*` guard and the
`ASSETS.fetch` fallthrough. No Google/Ads/D1 file appears in the diff stat.

## Issues

None CRITICAL.

WARNING: `design.md`'s "build, typecheck and test wiring" decision states `deploy:bff` "gains a `build:ui`
prerequisite so a deploy can never ship a stale bundle." The shipped `package.json` does not implement
this — `"deploy:bff": "wrangler deploy -c bff/wrangler.jsonc"` has no `build:ui` step before it (only
`pretest` was wired to `build:ui`, which protects `pnpm test` but not `pnpm deploy:bff`). This is a
design-vs-implementation gap, not a spec violation (no spec requirement covers deploy sequencing), but it
is exactly the kind of gap the design called out as load-bearing for correctness (shipping a stale bundle).
Recommend closing this before any real deploy, ideally in Phase 1's own follow-up rather than carrying it
silently into Phase 7.

SUGGESTION: no test exercises the `/api/*` 404 guard directly (`router.test.ts`'s fake env has no
`ASSETS` binding, and `asset-gate-ordering.test.ts` covers only static/deep-link paths). Low risk — the
guard is a simple early-return — but a one-line integration test (`GET /api/tools/does-not-exist`
authenticated → 404, not the SPA shell) would close the gap cheaply and is worth adding alongside Phase 2's
own test additions.

## Files inspected

`bff/wrangler.jsonc`, `bff/src/router.ts`, `bff/test/integration/asset-gate-ordering.test.ts`,
`bff/ui/{vite.config.ts,tsconfig.json}`, `tsconfig.json`, `package.json` (scripts block),
`.gitignore`, `openspec/changes/dashboard-views/{design.md,tasks.md,specs/dashboard-shell/spec.md}`,
`git show --stat f752133`, `git log` (recent commits).

## Next recommended

`sdd-apply` for Phase 2 (Shell). PR1 is a self-contained, independently revertible slice (revert the
`assets` binding and `router.ts` fallthrough; the JSON API keeps serving per the design's own rollback
note) and is safe to merge on its own before Phase 2 starts.

## Risks

None blocking. Carried forward for a future pass: the `deploy:bff`/`build:ui` prerequisite gap (WARNING
above) should be closed before any real deploy of this change, and the missing `/api/*` 404 guard test
(SUGGESTION above) is a cheap addition. Neither affects Phase 1 correctness as implemented — both are
gaps relative to the design's stated intent, not defects in what was shipped.
