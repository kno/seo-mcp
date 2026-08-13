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

# Verify Report — dashboard-views, Phase 2 / PR2

Scope: PR2 (commit da55a7d on feat/dashboard-views-build-wiring) adds the dashboard shell.
`data/errors.ts`, `data/bounds.ts` (types only), `data/client.ts`, `StateRegion`, atoms
(`Countdown`/`Spinner`/`VisuallyHidden`), `app/App.tsx`, and the `no-polling.test.ts` structural test.
Phases 3-7 are correctly `[ ]` in `tasks.md` and are out of scope for this pass.

## Verdict: PASS WITH WARNINGS

## Command evidence (executed fresh, this session)

- `pnpm test` -> 534/534 passed, 59 test files. (jsdom emits non-fatal `HTMLCanvasElement.getContext` stderr
  warnings from axe-core's color-contrast check during the a11y tests — a known jsdom limitation, not a test
  failure; all affected test files still report passing.)
- `pnpm typecheck` -> `tsc --noEmit && tsc --noEmit -p bff/ui`, clean, exit 0.
- `pnpm format:check` -> `prettier --check .`, clean, exit 0.

## Task completion

`tasks.md` Phase 2: 2.1-2.4 all `[x]`. Phases 3-7: all `[ ]`, correctly untouched. No unchecked task in the
in-scope phase.

## Load-bearing claim 1 — exhaustive error mapping (verified by breaking it)

`bff/ui/src/data/errors.ts` imports `BffErrorCode` directly from `bff/src/errors.ts`
(`import type { BffError, BffErrorCode } from "../../../src/errors"`) — not a locally redefined or
narrower union — and types `ERROR_PRESENTATION: Record<BffErrorCode, ErrorPresentation>` against it. The
real union has 11 codes; `ERROR_PRESENTATION` has exactly 11 matching keys.

Verified directly, not asserted: removed the `bff_timeout` entry from `ERROR_PRESENTATION` and ran
`pnpm exec tsc --noEmit -p bff/ui`:

```
bff/ui/src/data/errors.ts(41,14): error TS2741: Property 'bff_timeout' is missing in type '{...}'
but required in type 'Record<BffErrorCode, ErrorPresentation>'.
```

Restored the file and re-ran the same command: clean, exit 0. `presentFor()` degrades any runtime `code`
absent from the table (including a value outside the current union — a defensive `in`-style lookup, not
direct indexing) to an explicit unmapped state naming the raw `code` and `message`, never rendering
empty/success. The design's authenticated-source codes (`upstream_unauthorized` disabled-permanent,
`upstream_rate_limited` disabled-until-elapsed) are present and mapped, not deferred to the unmapped
fallback, satisfying the spec's "authenticated-source failure classes are separately actionable" scenario.

**Verdict on this claim: confirmed exactly as stated by the apply session.**

## Load-bearing claim 2 — no-polling structural test (verified with throwaway violations)

`bff/ui/src/no-polling.test.ts` scans real files under `bff/ui/src` via `readdirSync`/`readFileSync`
(`SRC_ROOT = join(__dirname)`), not a fixture — confirmed by its own first assertion
(`expect(files).toContain(join(SRC_ROOT, "data", "client.ts"))`).

Two throwaway violations were written directly into the tree and reverted after observing failure:

1. `bff/ui/src/organisms/ScratchViolation.tsx` with a `useEffect(() => { requestTool(...) }, [])` body ->
   the check "has no useEffect body that calls requestTool directly" FAILED as expected
   (`expected true to be false`).
2. Same file replaced with `window.addEventListener("focus", () => { requestTool(...) })` (no `useEffect`,
   a direct top-level focus-refetch pattern) -> the separate "registers no focus/blur event listener"
   check FAILED as expected.

Both scratch files were deleted immediately after capturing the failure; the working tree was confirmed
clean afterward, and the no-polling suite reports 22/22 passing again with them removed.

The `focus`/`blur` exclusion is scoped correctly: `FOCUS_LISTENER_PATTERN` matches only the
`addEventListener("focus"|"blur", ...)` registration shape, not the bare word `focus`. `StateRegion.tsx`
calls `headingRef.current?.focus()` (a DOM method call, not an event-listener registration) and this does
not trip the pattern — confirmed by regex inspection and by the passing suite. No file under `bff/ui/src`
registers `addEventListener` at all (confirmed by a source scan excluding test files), so the exclusion
logic has no real focus-triggered refetch to hide.

**Verdict on this claim: confirmed. The test genuinely scans live source and genuinely fails on both a
`useEffect`-mediated and a direct event-listener-mediated violation.**

## Load-bearing claim 3 — gesture-gated token (verified with a compile-time counter-example)

`UserIntent = { readonly [brand]: "user-intent" }` where `brand` is a `unique symbol` declared privately in
`client.ts` and never exported — a plain object literal (`{}`) cannot satisfy this structurally because it
lacks the private brand property. `userIntent(event)` throws at runtime for any `event.type` outside
`{"click", "submit"}` (confirmed by reading the `USER_GESTURE_EVENT_TYPES` set and the throw branch).

Verified with a scratch counter-example, not asserted: wrote a scratch file calling
`requestTool("crawl_site", { url: "..." }, {}, { signal })` (a plain `{}` where `UserIntent` is expected) and
ran `pnpm exec tsc --noEmit -p bff/ui`:

```
bff/ui/src/data/scratch-counterexample.ts(4,61): error TS2345: Argument of type '{}' is not assignable to
parameter of type 'UserIntent'.
  Property '[brand]' is missing in type '{}' but required in type 'UserIntent'.
```

Deleted the scratch file immediately after capturing this; the data directory was confirmed clean
afterward. This matches the apply-progress record's own captured evidence exactly (same error, same file
shape). Honest limitation, consistent with the design and the apply record: an explicit unsafe cast
(`{} as UserIntent`) still compiles — the type system only blocks an _accidental_ construction, not a
deliberate escape hatch — which is exactly why the independent structural test (claim 2 above) exists as a
backstop that does not depend on the type system at all.

**Verdict on this claim: confirmed exactly as stated.**

## Design deviation — route contract (WARNING, does not break spec)

`design.md`'s Error Presentation section illustrates `requestTool` calling `POST /api/tools/{tool}`.
`data/client.ts` instead issues `GET /api/tools/{tool}?...` with `?refresh=1` for cache bypass. Read
`bff/src/router.ts` directly to confirm: it dispatches purely on `GET` (any other method returns 404) and
every tool route parses `URLSearchParams` via `parseQuery()`, never a JSON body. `client.ts`'s
implementation matches the real, frozen route contract; the design's illustration is stale. No spec
requirement or scenario names the HTTP method, so this is a design document staleness issue, not a spec
violation — but `design.md` should be corrected so a future reader does not build against the illustrated
shape.

Separately, and out of this PR's scope but worth flagging forward: `analyzePagespeedInputSchema` places
`apiKey` on the query string (frozen from `dashboard-bff-foundations`), while `design.md`'s Secret Handling
section states transport is "the POST body only." That contradiction sits entirely in Phase 6
(`pagespeed-view` / secret handling, not yet started) and requires no action on this PR, but the reviewer of
Phase 6 should resolve it before secret-handling claims are verified there.

## StateRegion distinctness (confirmed, not just via color/icon)

Read `StateRegion.tsx` directly. All four states render with distinct text content and distinct ARIA
semantics, not merely distinct styling:

- loading: `role="status"`, text `"Loading {label}…"`
- error: `role="alert"`, presentation title + description text, plus a `Countdown` only when
  `retry.kind === "disabled-until-elapsed"`
- empty (`cardinality.state === "none"`): plain paragraph `"No {label} found."`, no `role="status"` or
  `role="alert"`
- bounded: `data-testid="bound-indicator"` paragraph naming `shown`/`limitValue`/`limitName`, distinct from
  both the empty message and any error text

`StateRegion.test.tsx` asserts these mutual exclusions directly (e.g. the empty-state test asserts
`queryByRole("status")` and `queryByTestId("bound-indicator")` are both absent). `StateRegion.a11y.test.tsx`
renders all five states (loading/empty/bounded/error-with-countdown/populated) through real
`@testing-library/react` `render()` and real `axe-core` via `vitest-axe`'s `axe(container)`, asserting
`violations` equals `[]` — confirmed this is not a stub: `axe` is imported from the `vitest-axe` package
(which wraps the real `axe-core` dependency also listed in `package.json`), and `test-setup.ts`'s own
comment explains why the custom `toHaveNoViolations` matcher was dropped in favor of the direct
`(await axe(container)).violations` assertion (an upstream `vitest-axe`/`vitest` 3.x type-declaration
mismatch) — a typed, real assertion with identical runtime coverage, not a placeholder.

## Regression / scope check

Comparing PR1 (build-wiring) against PR2 (this PR) in isolation shows changes confined to files under
`bff/ui/src/**`, `bff/ui/{index.html,tsconfig.json,vite.config.ts}`, `bff/ui/test-setup.ts`,
`bff/ui/src/main.tsx` (replacing Phase 1's placeholder `main.ts`, deleted), `vitest.ui.config.ts`,
`package.json`, `pnpm-lock.yaml`, and `openspec/changes/dashboard-views/tasks.md`. Zero drift into
`src/http/*`, `src/security/*`, root `wrangler.jsonc`, `src/schemas/*`, `src/types/*`, or any frozen
`bff/src/*.ts` file — a targeted comparison scoped to exactly those paths returns no changes. No
Google/Ads/D1 path appears anywhere in the PR1-to-HEAD change list.

Authored-line note (informational, not a gate failure): PR2's diff is 2204 insertions / 19 deletions across
28 files, of which 899 lines are `pnpm-lock.yaml`; the remaining ~1324 authored lines exceed the 400-line
review budget. `tasks.md`'s own Review Workload Forecast already flagged this change's total scope as
"High" 400-line risk and confirmed a `stacked-to-main` chain strategy with the user — PR2 is one slice of
that already-approved chain, not an unplanned overrun.

## Previously-flagged PR1 items — status

- WARNING (PR1, `deploy:bff`/`build:ui` prerequisite gap): **resolved**. `package.json` now defines
  `"predeploy:bff": "pnpm build:ui"`, so `pnpm deploy:bff` can no longer ship a stale bundle.
- SUGGESTION (PR1, missing `/api/*` 404 guard test): **still open**, unchanged this PR. Out of PR2's scope
  (no `router.ts` change this PR); carried forward.

## Issues

None CRITICAL.

WARNING: `design.md`'s Error Presentation section illustrates a `POST /api/tools/{tool}` contract that the
real, frozen router uses as `GET` with query parameters. `client.ts`'s implementation is correct against the
real contract; `design.md` itself should be corrected to avoid misleading a future reader.

WARNING (forward-looking, not blocking PR2): `design.md`'s Secret Handling section states apiKey transport
is "the POST body only," but the frozen route places `apiKey` on the query string. This must be resolved
before Phase 6 (pagespeed-view / secret handling) verification, not before this PR.

SUGGESTION (carried from PR1): no test exercises the `/api/*` 404 guard directly. Unchanged this PR.

## Files inspected

`bff/ui/src/data/{errors.ts,client.ts,bounds.ts}`, `bff/src/errors.ts`, `bff/src/router.ts`,
`bff/ui/src/no-polling.test.ts`, `bff/ui/src/molecules/{StateRegion.tsx,StateRegion.test.tsx,
StateRegion.a11y.test.tsx}`, `bff/ui/test-setup.ts`, `openspec/changes/dashboard-views/
{design.md,tasks.md,specs/dashboard-shell/spec.md}`, `package.json` (scripts block), the apply-progress
record for this change, plus fresh command execution and the three break-it-to-prove-it experiments above
(all scratch artifacts removed, confirmed clean afterward).

## Next recommended

`sdd-apply` for Phase 3 (Page Report). PR2 is a self-contained, independently revertible slice per the
design's stated rollback boundary (revert `app/`, `data/`, `atoms/`; the shell renders a disabled-view state
for a reverted view rather than a broken route) and is safe to merge on its own before Phase 3 starts.

## Risks

None blocking. Carried forward: the `/api/*` 404 guard test gap (SUGGESTION, unchanged) and the
`design.md` route-contract/secret-transport documentation staleness (WARNINGs above) — neither is a defect
in what PR2 shipped, and the secret-transport contradiction has zero effect until Phase 6 begins.

# Verify Report — dashboard-views, Phase 3 / PR3

Scope: PR3 (commit `af5952a` on `feat/dashboard-views-build-wiring`) adds `page-report-view`:
`OnPageCard`, `HeadingsPanel`, `OpenGraphPanel`, `JsonLdPanel`, `IssuesList`, `PageReportContainer`, and
supporting atoms (`Absent`, `Badge`). This PR's implementation was produced by an apply session that was
interrupted mid-flight; on resume, two real bugs were found and fixed before commit (see below). Phases
4-7 remain correctly `[ ]` in `tasks.md` and are out of scope for this pass.

## Verdict: PASS

## Command evidence (executed fresh, this session)

- `pnpm test` -> 594/594 passed, 67 test files (534 baseline from PR2 + 60 new this PR). jsdom still emits
  the same non-fatal `HTMLCanvasElement.getContext` stderr warnings from axe-core's color-contrast check
  during the pre-existing a11y tests — a known jsdom limitation carried from PR2, not a new failure or a
  PR3 regression.
- `pnpm typecheck` -> `tsc --noEmit && tsc --noEmit -p bff/ui`, clean, exit 0.
- `pnpm format:check` -> `prettier --check .`, clean, exit 0.

## Task completion

`tasks.md` Phase 3: 3.1-3.2 both `[x]`. Phases 4-7: all `[ ]`, correctly untouched. No unchecked task in
the in-scope phase.

## Fix 1 — test-fixture bug (`PageReportContainer.test.tsx`), verified real and complete

Read `PageReportContainer.test.tsx` directly. `SAMPLE_ANALYSIS.h1` is `["Welcome"]`, distinct from
`title: "Example"` — confirmed the old collision (`h1: ["Example"]` matching `title: "Example"`) is gone,
with an explicit code comment recording why the value was chosen. Ran the fixture's own test
("fetches only after an explicit form submission and renders the report") three consecutive times via
`pnpm vitest run --project ui -t "fetches only after an explicit form submission"` — passed all three runs,
no flakiness observed. **Confirmed real and complete.**

## Fix 2 — `workers-ambient.d.ts`, reproduced directly (not just read)

Temporarily removed `bff/ui/src/workers-ambient.d.ts` and re-ran `pnpm typecheck`: it failed with exactly
the errors the commit message describes —

```
src/config.ts(3,22): error TS2304: Cannot find name 'RateLimit'.
src/config.ts(14,8): error TS2552: Cannot find name 'D1Database'. Did you mean 'IDBDatabase'?
src/seo/html.ts(303,27): error TS2304: Cannot find name 'HTMLRewriter'.
src/seo/html.ts(304-332): 9x error TS7006 implicit 'any' on HTMLRewriter callback params
```

Restored the file (`git checkout -- bff/ui/src/workers-ambient.d.ts`) and re-ran `pnpm typecheck`: clean,
exit 0, `git status --short` confirmed no residual diff. This is a genuine reproduction, not a read-only
inference.

Read the file's declarations: exactly three ambient globals — `HTMLRewriter` (class, `on`/`transform`
methods only), `D1Database` (index-signature interface), `RateLimit` (index-signature interface). No
`fetch`, `Request`, or `Response` declaration anywhere in the file, and no reference to
`@cloudflare/workers-types` as a package — confirmed by reading the file's own content and its
doc-comment, which explicitly states the reasoning for scoping to only these three DOM-equivalent-free
globals. This does not reintroduce the `fetch`/`Response` collision `bff/ui/tsconfig.json`'s separate DOM-only
lib exists to avoid. **Confirmed real, complete, and narrowly scoped as claimed.**

## Issue code coverage — `IssuesList.tsx`'s `ISSUE_TITLES` vs. `src/seo/analyze.ts`

Re-read `src/seo/analyze.ts`'s `detectSeoIssues` fresh (not from memory). It emits exactly 13 distinct
`code` literals: `missing_title`, `title_length`, `missing_description`, `description_length`,
`missing_h1`, `multiple_h1`, `missing_canonical`, `missing_lang`, `images_missing_alt`, `noindex`,
`invalid_jsonld`, `missing_open_graph`, `thin_content`.

`IssuesList.tsx`'s `ISSUE_TITLES` table has exactly 13 keys, and a field-by-field comparison shows every
key matches one of the 13 codes above exactly — no typos, no extra/missing entries, no renamed code.
`IssuesList.test.tsx` has one dedicated test per code (13 tests), plus a severity-distinction test, an
empty-state test, and an unrecognized-code test — 16 test cases total, all passing.

Unmapped-code fallback path verified as a real branch, not just read: `future_unknown_code` test renders
`screen.getByText("future_unknown_code")` (raw code), the raw message, and asserts
`getByTestId("badge-warning")` (its own reported severity, not a reclassification) plus
`getByTestId("issue-unmapped")` (the distinct unmapped marker) — all present in the passing suite output.
**Confirmed: exactly 13 codes mapped, unmapped path renders visibly rather than dropping.**

## Absence handling — `OnPageCard` / `Absent`

`Absent.tsx` renders a fixed `"{label}: not present"` (or bare `"Not present"`) string via
`data-testid="absent"`, never a blank string or a value derived from props beyond the label. `OnPageCard.tsx`
uses `canonical ?? <Absent label="canonical" />`, `robots ?? <Absent label="robots" />`,
`lang ?? <Absent label="lang" />` — nullish-coalescing on each of the three legitimately-optional
`PageSignals` fields, matching the spec's field list exactly (not `title`/`description`, which are always
present). `OnPageCard.test.tsx` asserts the not-present indicator's text content matches `/not present/i`
and explicitly asserts the canonical field's text does NOT match a fabricated `https?://` value.
**Confirmed.**

## Open Graph / JSON-LD invalid-block handling

`JsonLdPanel.tsx` renders `jsonLd.types` verbatim as a list and, only when `jsonLd.invalid > 0`, an
additional, separate paragraph naming the invalid count — it never subtracts from or adds to `types`.
For the spec's exact scenario (`blocks: 2, types: ["Article"], invalid: 1`),
`JsonLdPanel.test.tsx`'s second test asserts `getByTestId("jsonld-invalid")` has text content `"1"`, `"Article"`
is present, and — the critical negative assertion — `getAllByText("Article")` has length exactly 1 (never
2), directly encoding the spec's "MUST NOT report 2 valid types" language. `OpenGraphPanel.tsx` renders an
explicit "No Open Graph metadata present." paragraph for an empty map, confirmed by its own passing test.
**Confirmed.**

## Failure-not-empty — `PageReportContainer`

Re-read the container's `handleSubmit`: on `"error" in result`, it calls
`setState({ phase: "error", error: result.error })` and returns immediately — `analysis` is never set (it
was already reset to `null` at the top of `handleSubmit`), so the `{analysis && (...)}` block guarding
`OnPageCard`/`HeadingsPanel`/`OpenGraphPanel`/`JsonLdPanel`/`IssuesList` never renders on a failure path.
The container's own third test mocks a `crawl_page` failure (`upstream_unavailable`) and asserts
`getByRole("alert")` with `/temporarily unavailable/i` text, plus two explicit negative assertions:
`queryByTestId("onpage-canonical")` and `queryByText(/no issues detected/i)` are both absent. This directly
proves the failure path renders the shared error contract, not an empty-looking success.
**Confirmed.**

## Regression / scope check

`git diff --stat da55a7d af5952a -- src/http src/security wrangler.jsonc src/schemas src/types bff/src`
returns no output — zero drift into any frozen file across PR2→PR3. A targeted diff of root `src/` (excluding
`bff/ui`) between the same two commits is also empty — this PR touches only `bff/ui/src/{atoms,organisms,
containers}/**` and `bff/ui/src/workers-ambient.d.ts` (confirmed by `git show --stat af5952a`, 17 files, all
under `bff/ui/`). No Google/Ads/D1 path appears anywhere in the diff.

## Issues

None CRITICAL. None WARNING for this PR's own scope.

Carried forward, unchanged (out of PR3's scope, no action required this pass):

- SUGGESTION (PR1): missing `/api/*` 404 guard test.
- WARNING (PR2): `design.md` route-contract (`POST` vs. real `GET`) and secret-transport
  (query string vs. "POST body only") documentation staleness — the secret-transport item remains
  relevant only starting at Phase 6.

## Files inspected

`bff/ui/src/organisms/{OnPageCard,HeadingsPanel,OpenGraphPanel,JsonLdPanel,IssuesList}.tsx` and their
`.test.tsx` files, `bff/ui/src/atoms/{Absent,Badge}.tsx` and their `.test.tsx` files,
`bff/ui/src/containers/PageReportContainer.tsx` and `.test.tsx`, `bff/ui/src/workers-ambient.d.ts`,
`src/seo/analyze.ts` (re-read fresh), `openspec/changes/dashboard-views/{tasks.md,
specs/page-report-view/spec.md}`, `git show --stat af5952a`, plus fresh command execution and the two
break-it-to-prove-it reproductions above (workers-ambient.d.ts removal/restoration confirmed clean
afterward via `git status --short`).

## Next recommended

`sdd-apply` for Phase 4 (Broken Links). PR3 is a self-contained, independently revertible slice per the
work-unit table's stated rollback boundary (revert `organisms/OnPageCard` etc.) and is safe to merge on its
own before Phase 4 starts.

## Risks

None blocking. Carried forward unchanged: the `/api/*` 404 guard test gap (SUGGESTION) and the
`design.md` route-contract/secret-transport documentation staleness (WARNINGs) — neither originates in or
is affected by PR3.
