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

# Verify Report — dashboard-views, Phase 4 / PR4

Scope: this pass verifies only Phase 4 (tasks 4.1-4.2, commit 62ce3e6 on
feat/dashboard-views-build-wiring) — the broken-links-view: BrokenLinksContainer,
BrokenLinksPanel, ProbeRow, plus the additive Badge/bounds.ts extensions. Phases 1-3
were previously verified PASS (with minor non-blocking carried-forward items, not re-litigated
here). Phases 5-7 are correctly [ ] in tasks.md and out of scope.

## Verdict: PASS WITH WARNINGS

## Command evidence (executed fresh, this session)

- pnpm test -> 70 test files, 620 tests passed, 0 failed — matches the apply session's own
  reported final count exactly (baseline 594 at end of Phase 3, +26 this phase).
- pnpm typecheck -> clean (exit 0; tsc --noEmit && tsc --noEmit -p bff/ui).
- pnpm format:check -> clean (exit 0; prettier --check . — "All matched files use Prettier
  code style!").

## Task completion

tasks.md Phase 4: 4.1-4.2 both [x]. Phases 1-3 remain [x] (previously verified). Phases 5-7
remain [ ], correctly untouched. No unchecked task in the in-scope phase.

## Spec compliance — broken-links-view/spec.md

### Requirement: Broken-Links Check Runs Only on Explicit User Action

Re-read BrokenLinksContainer.tsx fresh: zero useEffect calls exist in the file; the component's
only side-effecting code path is handleCheckLinks, wired exclusively to the button's onClick.
no-polling.test.ts is a real filesystem walk (not a fixed file list, confirmed by reading its
collectSourceFiles implementation) and its "no useEffect body calling requestTool directly"
assertion runs against this file automatically. BrokenLinksContainer.test.tsx's first test asserts
expect(global.fetch).not.toHaveBeenCalled() immediately after render() with zero interaction —
ran it as part of the full suite, passing.

Confirmed this is a genuinely separate container from PageReportContainer, not a hidden
auto-trigger: read both files fresh side by side. PageReportContainer owns its own
state/analysis/controllerRef/requestIdRef and its own <form onSubmit> gesture; nothing in
either file references the other, and BrokenLinksContainer takes only a pageUrl: string prop —
no shared lifecycle, no shared effect, no prop-driven auto-fetch on pageUrl changing. Confirmed.

### Requirement: Checked, OK, Broken, and Errors Counts Are Always Visible

BrokenLinksPanel.tsx renders all four counts unconditionally in one <dl>
(links-checked/links-ok/links-broken/links-errors), never behind a subset conditional.
BrokenLinksContainer.test.tsx's "renders all four counts..." test asserts all four
data-testids with non-zero values (4, 2, 1, 1) are present simultaneously — ran it, passing.

Gap (WARNING, untested edge case, already flagged by the apply agent as a documented
deviation): describeProbeSet(checked, limit) maps checked === 0 to Cardinality.state: "none",
and StateRegion's "none" branch renders a generic "No broken links found." message instead of
rendering BrokenLinksPanel at all — so when checked === 0 the four counts (0, 0, 0, 0)
are NOT rendered as distinct figures. The spec's own "Whenever a LinkCheckResult is rendered..."
requirement text is unconditional and its one covering scenario uses checked: 12, not checked: 0,
so this exact corner case is genuinely untested against the spec's literal wording. This is a
plausible real state (a page with zero discoverable links) and the current behavior is a
defensible design choice (treated as "nothing to check" rather than "a result with zero of
everything"), but it is not proven compliant by any passing test and the requirement text does not
carve out this exception. Not CRITICAL — no spec scenario covers checked: 0 — but blocks a
"proven-compliant on all rendered LinkCheckResult" claim.

### Requirement: Broken and Error States Render Distinctly

ProbeRow.tsx's variantFor() maps "broken" -> Badge variant="broken" (renders status via
data-testid="probe-status") and "error" -> Badge variant="error" (renders error via
data-testid="probe-error") — mutually exclusive per the if/if/return shape, never both
rendered for one probe. ProbeRow.test.tsx and BrokenLinksPanel.test.tsx both assert
badge-broken/badge-error render as distinct data-testids. BrokenLinksContainer.test.tsx's
"renders all four counts..." test additionally asserts both badge-broken and badge-error are
simultaneously present in one rendered list (from RESULT.results containing one of each state) —
ran it, passing, proving both states coexist in the same list without collapsing into one bucket.
Confirmed.

### Requirement: Bounded Probe Set Is Named, Not Implied Exhaustive

describeProbeSet(checked, limit): checked === limit -> state bounded, bound with limitName
maxLinkChecks, limitValue limit; checked strictly below limit -> state complete (no bound
branch). StateRegion's bounded branch renders data-testid bound-indicator naming both the shown
count and limitName/limitValue; the complete branch renders no such element.
BrokenLinksContainer.test.tsx tests both directions: checked 50 (equal to the passed limit of 50)
asserts bound-indicator is present and contains "50"; a separate test using checked 4 (below 50)
asserts screen.queryByTestId("bound-indicator") is absent. Both ran as part of the full suite,
passing. Confirmed both directions are tested, not just the positive case, per the assignment's
explicit ask.

WARNING (drift risk, not a correctness bug): BrokenLinksContainer.tsx calls
describeProbeSet(response.data.checked, 50) — the 50 is a literal duplicated from
src/config.ts's LIMITS.maxLinkChecks: 50 rather than importing the constant. PageReportContainer
and other containers do already cross-import server-side types (src/types), so importing
LIMITS from src/config was a technically available option. If maxLinkChecks is ever
changed server-side, this UI literal will silently drift out of sync and the bound indicator will
report the wrong limit value without any test catching it (no test asserts the UI's 50 traces back
to the config constant).

### Requirement: Upstream Platform Failure Surfaces as an Error, Never as Zero Broken Links

Re-read the assertions directly (not just the test name): BrokenLinksContainer.test.tsx's "shows
the shared error-state contract..." test mocks an error response with code upstream_unavailable
and message "Subrequest ceiling reached" (confirmed upstream_unavailable is a real member of the
BFF's BffErrorCode union in bff/src/errors.ts line 20 and maps to "The upstream service is
temporarily unavailable." in both bff/src/errors.ts line 67 and the UI's bff/ui/src/data/errors.ts
line 88, so this is not a fabricated code). The test asserts screen.findByRole("alert") renders
with matching text "temporarily unavailable", and two explicit negative assertions:
queryByTestId("links-checked") and queryByTestId("links-broken") are both absent. Ran it as
part of the full suite, passing — this is a genuine role=alert plus negative-DOM-assertion pair,
not merely a passing test with a plausible name. Confirmed.

## Exactly-one-fetch / rapid double-click (assignment item 3)

Located and read the specific test: BrokenLinksContainer.test.tsx's last test, named "aborts a
stale in-flight request and issues only one fetch on a rapid double-click". It does simulate two
rapid clicks (two awaited user.click(button) calls with no intervening await-for-completion), and
does use the AbortController plus requestId-staleness pattern (confirmed by reading
handleCheckLinks: controllerRef.current abort() runs on every invocation, and the
requestId !== requestIdRef.current guard discards a stale resolution). However, the assertion is
toHaveBeenCalledTimes(2), not 1 — the test's own name ("issues only one fetch") contradicts its
assertion (asserts two). Read this as intentional, correct behavior for the spec as written: each
click is its own "explicit action" per the spec's "exactly one check_links request MUST be issued
as a direct result of that action" wording, so two clicks correctly produce two requests, with the
first response discarded via the staleness guard rather than the second click's fetch being
suppressed. This is compliant with the letter of the spec (no requirement text asks for
click-level dedup/debounce), but it does not demonstrate "exactly one fetch" in the sense the
assignment's phrasing implied, and there is no dedup/debounce guard protecting this expensive,
subrequest-heavy tool from a genuine accidental double-click firing two full check_links
invocations. SUGGESTION: rename the test to match its actual assertion (e.g. "issues one fetch per
click, aborting the stale one" instead of "issues only one fetch"), and consider whether
check_links — the tool explicitly called out in both this spec and the dashboard-bff spec as the
most subrequest-hungry — warrants an in-flight guard that suppresses a second click while the
first is still pending, rather than firing-and-aborting. Not CRITICAL: no spec scenario requires
this, and firing two full requests on two full clicks does not violate the "exactly one request
per action" wording.

## Regression / scope check

A diff-stat comparison between commits af5952a and 62ce3e6 (PR3 to PR4): 12 files changed, all
under bff/ui/src (atoms, containers, data, molecules, organisms subfolders) plus tasks.md and
verify-report.md. A diff-stat comparison between commit da55a7d and HEAD, scoped to src/http,
src/security, wrangler.jsonc, src/schemas, src/types, and bff/src, returns no output — zero drift
into any frozen file across the entire PR2-to-PR4 range. No Google/Ads/D1 path appears anywhere in
the diff.

Badge.tsx's diff (af5952a to 62ce3e6) is additive-only: +8/-3, and the 3 deletions are a
doc-comment rewording plus the union-type line replaced by itself with two new members appended
(warning, info, unmapped becomes warning, info, unmapped, broken, error) — no existing variant
removed or renamed, Badge's rendering logic (data-testid/data-variant) unchanged. bounds.ts's diff
is a pure addition (describeProbeSet, +27 lines, 0 deletions) — isBounded, Bound, and Cardinality
are untouched. Confirmed additive.

## Issues

CRITICAL: None.

WARNING:

1. describeProbeSet's checked-equals-zero to "none" branch hides all four counts instead of
   rendering them as zeroes; untested against the spec's unconditional "whenever rendered" wording
   (no scenario covers checked: 0).
2. The 50 passed to describeProbeSet in BrokenLinksContainer.tsx is a literal duplicate of
   LIMITS.maxLinkChecks, not an import — a future config change would silently desync the UI's
   bound indicator with no test catching it.

SUGGESTION:

1. Rename the "aborts a stale in-flight request and issues only one fetch on a rapid double-click"
   test to match its actual toHaveBeenCalledTimes(2) assertion; the current name overstates what
   it proves.
2. Consider an in-flight guard (disable the button, or ignore a click while a request is pending)
   for check_links specifically, given both specs single it out as the platform's most
   subrequest-hungry tool.

Carried forward, unchanged (out of PR4's scope, no action required this pass):

- SUGGESTION (PR1): missing /api/* 404 guard test.
- WARNING (PR2): design.md route-contract (POST vs. real GET) and secret-transport
  documentation staleness.

## Files inspected

BrokenLinksContainer.tsx and its test file, BrokenLinksPanel.tsx and its test file, ProbeRow.tsx
and its test file, Badge.tsx and its test file, bounds.ts and its test file, StateRegion.tsx,
PageReportContainer.tsx (comparison), no-polling.test.ts, bff/src/errors.ts, bff/ui/src/data/
errors.ts, src/config.ts (LIMITS.maxLinkChecks, LIMITS.linkCheckSubrequestBudget),
openspec/changes/dashboard-views/tasks.md, openspec/changes/dashboard-views/specs/
broken-links-view/spec.md, openspec/specs/dashboard-bff/spec.md, plus fresh pnpm test, pnpm
typecheck, and pnpm format:check execution and diff-stat regression checks.

## Next recommended

sdd-apply for Phase 5 (Site Crawl) once this PR4 slice is reviewed and merged. PR4 is a
self-contained, independently revertible slice per the work-unit table's stated rollback boundary
(revert the panel, shell falls back to the disabled-view state) and is safe to merge on its own.

## Risks

None blocking. Two WARNINGs are non-blocking correctness/drift risks (untested checked-equals-zero
corner case, hardcoded bound literal) that should be tracked but do not require reverting or
blocking this PR. Carried-forward items from PR1/PR2 remain unaffected by PR4.

# Verify Report — dashboard-views, Phase 5 / PR5

Scope: this pass verifies Phase 5 (tasks 5.1-5.2, commit a767464 on
feat/dashboard-views-build-wiring) — site-crawl-view: CrawlForm, DomainSummaryPanel,
CrawlPolicyPanel, LinkGraphPanel, BarChart, PerPageTable, SiteCrawlContainer. Phases 1-4 were
previously verified PASS/PASS WITH WARNINGS (both PR4 WARNINGs — the hardcoded 50 and the
misleadingly-named test — were fixed in commit 9e11f6b, prior to this PR). Phases 6-7 remain correctly
[ ] in tasks.md and are out of scope.

## Verdict: PASS

## Command evidence (executed fresh, this session)

- pnpm test -> 79 test files, 695 tests passed, 0 failed (matches the apply note's claimed delta of
  +75 over the Phase 4 baseline of 620).
- pnpm typecheck -> tsc --noEmit && tsc --noEmit -p bff/ui, clean, exit 0.
- pnpm format:check -> prettier --check ., clean, exit 0 ("All matched files use Prettier code style!").

## Task completion

tasks.md Phase 5: 5.1-5.2 both [x]. Phases 1-4 remain [x] (unaffected). Phases 6-7: correctly [ ].
No unchecked task in the in-scope phase.

## Spec compliance matrix (site-crawl-view/spec.md, 7 requirements / 19 scenarios)

| Requirement                                                        | Scenarios | Verdict | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------ | --------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bounded Crawl Input Controls                                       | 4/4       | PASS    | CrawlForm.tsx: useState(5)/useState(2) defaults (CrawlForm.test.tsx:7-11); validate() blocks out-of-range and never calls onSubmit (CrawlForm.test.tsx:29-57); isAtMaximum gates a distinct pendingConfirmation step naming "up to 40 seconds" and "shared rate limit bucket", with onSubmit firing only from the separate "Confirm and run crawl" button (CrawlForm.tsx:83-96, tests at CrawlForm.test.tsx:59-103); below-maximum values submit directly on the first click (CrawlForm.test.tsx:13-27).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Domain Summary Panel Reflects the Real Result Shape                | 3/3       | PASS    | DomainSummaryPanel.tsx renders exactly DomainSummary's fields; CategoryRow renders category.count unconditionally (renders 0, DomainSummaryPanel.tsx:80); imagesMissingAlt.{pages,images} both rendered with distinct data-testids (DomainSummaryPanel.tsx:151-157). Covered by DomainSummaryPanel.test.tsx (5 cases, passing).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Crawl Policy Panel Reflects the Real Result Shape                  | 2/2       | PASS    | robotsFound renders one of two mutually exclusive strings (CrawlPolicyPanel.tsx:25-27); disallowedSkipped count + sample + SampleBadge labeling via describeCategory (CrawlPolicyPanel.tsx:53-70). Covered by CrawlPolicyPanel.test.tsx (3 cases, passing).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Internal Link Graph Shows Orphans and Most-Linked Pages            | 2/2       | PASS    | orphanPages.count === 0 renders an explicit "No orphan pages found." distinct from the truncated/empty case (LinkGraphPanel.tsx:34-36); topLinkedPages rendered by BarChart in result order, never re-sorted (BarChart.tsx:35, comment confirms). Covered by LinkGraphPanel.test.tsx/BarChart.test.tsx (6 cases, passing).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Per-Page Table With Drill-Down                                     | 2/2       | PASS    | PerPageTable.tsx renders page.error with no issue count when result is absent (PerPageTable.tsx:40-46); drill-down calls onDrillDown(page.result) directly, no data/client/requestTool import anywhere in the file (confirmed by direct read, grep-confirmed). SiteCrawlContainer.test.tsx's "opens the drill-down..." test asserts global.fetch stays at 1 call after the drill-down click (SiteCrawlContainer.test.tsx:146-163).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Bound-Versus-Empty Distinction Across All Panels                   | 3/3       | PASS    | Every capped field routes through the shared describeCategory/describeCappedList + SampleBadge (bounds.ts, SampleBadge.tsx) — no bespoke one-off labeling found in any panel. describeOutputBytes (bounds.ts:152-174) implements the "at or near maxSiteOutputBytes" (documented as >=95% of cap) AND crawled+failed < requested compound condition, surfaced at the container's StateRegion cardinality level, independent of per-panel SampleBadges (SiteCrawlContainer.tsx:88-101). Covered by SiteCrawlContainer.test.tsx:178+ (output-byte truncation test) and bounds.test.ts.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Long-Running Crawl Shows Progress or an Honest Indeterminate State | 3/3       | PASS    | StateRegion's new optional detail field renders "Crawl in progress... this can take up to ~40 seconds..." (SiteCrawlContainer.tsx:63-67, StateRegion.tsx additive diff). Duplicate-submit-while-in-flight is blocked by real disabled={inFlight} on the submit button (jsdom does not fire click on a disabled button) plus a second if (inFlight) return guard in the handler (SiteCrawlContainer.tsx:52, CrawlForm.tsx:142-144). Covered by SiteCrawlContainer.test.tsx's "blocks a duplicate submit..." test (lines 113-144), which asserts global.fetch stays at exactly 1 call across both the first submit and the blocked second click. No streaming/SSE surface exists yet server-side, so the determinate-progress scenario is not independently exercised — acceptable, since the requirement is conditional ("if the BFF surface... reports incremental progress") and today's surface does not; the seam (readToolResponse/progress.ts) exists and is unit-tested against its own contract. |

All 19 scenarios have a passing covering test or, for the one BFF-surface-conditional scenario
(determinate-progress-via-SSE), a documented and reasonable "not applicable today" status consistent with
the requirement's own conditional wording — not a gap.

## Deliberate-default verification

CrawlForm defaults limit=5/concurrency=2, confirmed as a deliberate documented choice, not an
accidental mismatch with the tool's own defaults (LIMITS.defaultCrawlPages 10, router's concurrency
default 4): proposal.md's Decision 4 table explicitly states "UI defaults crawl_site to limit 5,
concurrency 2; 20/4 is an explicit warned choice" against the rejected alternative "Default to the
server's own 10/4", with the rationale "the cheap path must be the default path; the expensive one must be
chosen knowingly." CrawlForm.tsx's own doc comment cites this reasoning directly.

## Numeric-literal / config-import audit (spot-checked given PR4's precedent defect)

- CrawlForm.tsx imports LIMITS.maxCrawlPages (20) and LIMITS.maxConcurrency (4) from src/config.ts —
  confirmed present at src/config.ts:25-26. The 1 minimums (MIN_LIMIT, MIN_CONCURRENCY) are
  undocumented-in-config literals matching the frozen crawlSiteInputSchema's own hardcoded .min(1) —
  acceptable, same pattern the schema itself uses.
- SiteCrawlContainer.tsx imports LIMITS.maxSiteOutputBytes (256,000) from src/config.ts:22 — confirmed,
  not hardcoded.
- DomainSummaryPanel.tsx (DUPLICATE_GROUP_SAMPLE_CAP = 10, DOMAIN_CATEGORY_SAMPLE_CAP = 25),
  CrawlPolicyPanel.tsx (SITEMAPS_DECLARED_CAP = 20, DISALLOWED_SKIPPED_SAMPLE_CAP = 25),
  LinkGraphPanel.tsx (ORPHAN_PAGES_SAMPLE_CAP = 25, TOP_LINKED_PAGES_CAP = 10): spot-checked each
  against src/crawl/site.ts directly — topLinkedPages: topEntries.slice(0, 10) (line 91), group sample
  urls.slice(0, 10) (line 149), group list cap groups.slice(0, 20) (line 156), category sample
  urls.slice(0, 25) (line 160), sitemapsDeclared: robots.rules.sitemaps.slice(0, 20) (line 254),
  disallowedSkipped.sample: disallowedUrls.slice(0, 25) (line 257). All six literals match exactly and are
  never exported from src/config.ts (grep-confirmed) — the apply note's claim holds up under direct
  verification, and each consuming file carries a comment citing this sourcing.

## Duplicate-submit / drill-down / BarChart verification (load-bearing new behavior)

- SiteCrawlContainer.tsx:110 passes disabled={inFlight} to CrawlForm, which forwards it to both the
  submit button and the confirm button (CrawlForm.tsx:136,142) — genuinely disabled, not a cosmetic
  overlay. SiteCrawlContainer.tsx:52 (if (inFlight) return) is a second, container-owned guard.
  SiteCrawlContainer.test.tsx:113-144 simulates a still-pending fetch via a manually-controlled unresolved
  promise, asserts the button is disabled, clicks it again, and asserts global.fetch call count stays at 1
  — direct, non-optimistic proof.
- PerPageTable.tsx — grep-confirmed zero references to data/client or requestTool anywhere in the
  file; onDrillDown receives page.result (SitePageAnalysis) directly by value. SiteCrawlContainer.tsx
  feeds the drilled-down value straight into OnPageCard/HeadingsPanel/OpenGraphPanel/JsonLdPanel/
  IssuesList (the same Phase-3 presentational organisms) as plain props, with no internal fetch in any of
  them.
- BarChart.tsx — hand-rolled inline SVG; no charting library appears in package.json (searched for
  chart/d3/recharts/victory/visx, none found). Its accessible fallback is a real table (URL +
  inbound-count columns) with the SVG marked aria-hidden="true", verified directly in source and by
  BarChart.test.tsx.

## Design coherence

Three documented deviations from design.md, all WARNING-level (non-spec-breaking) and explicitly reasoned
in the apply note, confirmed by direct source inspection:

1. readToolResponse wraps the parsed-envelope promise requestTool() returns rather than a raw Response
   — consistent with the real data/client.ts contract established in Phase 2, which already fully consumes
   the response. Not a regression; changing that contract was out of this phase's scope.
2. Duplicate-submit blocking is implemented as a global in-flight disable rather than design.md's
   per-input-keyed version. The spec's own scenario ("another crawl_site request for the same site") is
   satisfied by the global version; this is a legitimate simplification, not a spec gap.
3. CategoryCard/StatGroup/SampleList (named in design.md's architecture table) were not built as
   separate components — SampleBadge + describeCategory/describeCappedList are used inline instead.
   Confirmed this does not weaken any binding invariant: every panel still routes through the same shared
   describeCategory/describeCappedList derivation and SampleBadge rendering, so no bespoke one-off
   labeling logic exists anywhere in the PR.

## Regression / scope check

The PR5 commit (a767464) touches only bff/ui/src/** (charts/containers/data/molecules/organisms) plus
openspec/changes/dashboard-views/tasks.md — 23 files, all in scope, zero touches to src/http/_,
src/security/_, root wrangler.jsonc, src/schemas/_, src/types/_, or any bff/src/*.ts file. A diff
does exist against bff/src/router.ts relative to main, but it was confirmed to originate in the PR1
build-wiring commit f752133 (router.ts is absent from the PR5 commit's own file list) and was already
covered by the Phase 1 verify report — not a PR5 regression. StateRegion.tsx's diff for this PR (+11/-2)
is additive-only: the new detail? field is optional and the render falls back to the original generic
text when absent — no existing caller's behavior changes. bounds.ts's diff adds three new exported
functions (describeCategory, describeCappedList, describeOutputBytes) with zero changes to the
pre-existing Bound, Cardinality, isBounded, or describeProbeSet — confirmed additive by direct read.

## Issues

CRITICAL: None.

WARNING: None new. (Design deviations above are non-blocking and explicitly reasoned; no untested
scenario, no hardcoded config literal, no scope drift found in this PR — unlike PR4, which had two real
findings at this stage.)

SUGGESTION:

1. The determinate-progress-via-SSE scenario has no dedicated covering test today because no SSE-capable
   BFF surface for crawl_site exists yet; the readToolResponse seam is unit-tested against its own
   contract only. This is consistent with the requirement's own conditional wording, not a gap, but it is
   worth flagging so a future PR adding real streaming remembers to add the scenario's test at that time.
2. App.tsx still does not wire SiteCrawlContainer into the shell's routing (consistent with Phase 3/4's
   established pattern of container-first, shell-integration-later) — noted for continuity, no action
   required this pass.

Carried forward, unchanged (out of PR5's scope, no action required this pass):

- SUGGESTION (PR1): missing /api/* 404 guard test.
- WARNING (PR2): design.md route-contract (POST vs. real GET) and secret-transport documentation staleness.

## Files inspected

CrawlForm.tsx/CrawlForm.test.tsx, DomainSummaryPanel.tsx, CrawlPolicyPanel.tsx,
LinkGraphPanel.tsx, BarChart.tsx, PerPageTable.tsx, SiteCrawlContainer.tsx/
SiteCrawlContainer.test.tsx, data/bounds.ts, molecules/SampleBadge.tsx, molecules/StateRegion.tsx
diff, src/config.ts (LIMITS), src/crawl/site.ts (literal-cap spot-check), package.json (charting-
library absence), openspec/changes/dashboard-views/{tasks.md,proposal.md,specs/site-crawl-view/spec.md},
plus fresh pnpm test/pnpm typecheck/pnpm format:check execution and commit-diff/stat regression checks.

## Next recommended

sdd-apply for Phase 6 (PageSpeed) once this PR5 slice is reviewed and merged. PR5 is a self-contained,
independently revertible slice per the work-unit table's stated rollback boundary (revert the route/
organisms; Phases 1-4 are unaffected by a full revert) and is safe to merge on its own.

## Risks

None blocking. No CRITICAL or WARNING findings this pass — this is a clean PASS, notable given this PR's
size (the largest in the chain so far) and the extra scrutiny applied to numeric literals after PR4's real
defect.

# Verify Report — dashboard-views, Phase 6 / PR6

Scope: Phase 6 (tasks 6.1-6.2, commit `ef7ac10` on `feat/dashboard-views-build-wiring`) — the `pagespeed-view`
UI, plus an out-of-band security fix to the already-archived `dashboard-bff-foundations` file
`bff/src/router.ts`, made mid-apply after the orchestrator found `analyze_pagespeed`'s optional `apiKey`
traveling as a GET query-string parameter (visible in DevTools' Network tab and access logs). The user
approved fixing it in this same PR. Phases 1-5 remain `[x]` and out of scope for this pass; Phase 7 remains
`[ ]`.

## Verdict: PASS

## Verdict — security fix specifically: PASS

No path was found by which the old insecure (GET query-string) transport of `apiKey` still works. The fix is
complete, narrowly scoped, and independently test-covered at both the router level and the UI transport level.

## Command evidence (executed fresh, this session)

- `pnpm test` -> 756/756 passed, 88 test files (up from the Phase 5 baseline of 695/695; +59 from
  Phase 6 UI components/tests, +2 from the two new router-level security tests in
  `bff/test/router.test.ts` and `bff/test/integration/cache.test.ts` — the apply-progress memory's stated
  754 predates those last 2 tests, added by the later security-fix commit).
- `pnpm typecheck` -> clean, exit 0 (`tsc --noEmit && tsc --noEmit -p bff/ui`).
- `pnpm format:check` -> clean, "All matched files use Prettier code style!".

## Security fix verification (maximum-skepticism pass)

1. `bff/src/router.ts` read in full. Confirmed all four required properties:
   - (a) POST /api/tools/analyze_pagespeed with apiKey in a JSON body is accepted: parseBody() reads
     request.json(), validates against analyzePagespeedInputSchema (same schema as the GET path), and
     dispatches on success.
   - (b) GET /api/tools/analyze_pagespeed?...&apiKey=... is explicitly rejected: url.searchParams.has("apiKey")
     is checked as the FIRST statement inside that route's GET branch, before parseQuery() even runs, and
     returns bffErrorResponse("invalid_input") (400-class) without any dispatch to callTool.
   - (c) GET without apiKey is unaffected — same code path as before, unchanged behavior, verified by
     the passing "accepts an omitted apiKey (optional field)" test.
   - (d) No other route was touched: git diff da55a7d..HEAD -- bff/src/router.ts shows 55 insertions, 0
     deletions, all additive, confined to the analyze_pagespeed-specific comment block, the new
     parseBody() helper, the new POST branch, and the new apiKey-in-query rejection check. health,
     crawl_page, crawl_site, check_links routes are byte-for-byte unchanged.

2. Searched for a residual insecure path. No case-sensitivity gap: URLSearchParams.has("apiKey") is
   an exact string match and the schema itself only ever reads the exact key apiKey (Zod would reject an
   APIKEY field as an unrecognized/missing key under analyzePagespeedInputSchema, since apiKey would
   then be absent — a would-be attacker gains nothing by varying case). No body-reading path exists on the
   GET branch, so there is no way to "smuggle" apiKey into a GET request's body that the route would honor
   — GET requests are also spec-disallowed from carrying a body by the Fetch/HTTP model, and the router
   never attempts to read one for GET. Checked dispatch()'s call order: the apiKey-in-query rejection in
   handleRequest() happens BEFORE dispatch() is ever invoked, so cacheKey() (which hashes args) is
   never even called for a rejected request — no window where the query-string value is hashed, cached, or
   single-flighted before rejection. The bypass-from-cache path (isCacheable returning false for a
   POST+apiKey request) is unrelated to this check and was already covered by the archived change.

3. bff/ui/src/data/client.ts's requestTool() read in full. Confirmed: when opts.secrets is present,
   the function unconditionally takes the POST + JSON-body branch (an early return — there is no
   fallthrough to the GET branch below it for that call). Each SecretCell is .take()n exactly once inside
   the for loop building the body; the returned value is written straight into the local body object and
   never assigned to any other retained variable. SecretCell.take() itself (bff/ui/src/data/secret.ts)
   sets this.#value = undefined on read, so even a caller holding the same cell object cannot recover the
   value a second time — this is structurally enforced, not a convention, and is proven by
   data/secret.test.ts's repeated-take()-returns-undefined case.

4. Router-level tests read directly (bff/test/router.test.ts:341-380):
   - "rejects an apiKey supplied over GET — it must travel over POST instead" — asserts response.status
     is 400 and env.SEO_MCP.fetch was never called. Name matches assertion exactly.
   - "accepts an explicit apiKey over POST and never echoes it back in the response" — sends the POST
     request with apiKey: "secret-key" in the body, asserts response.status === 200, and asserts the
     full serialized response body does not contain the string "secret-key". Name matches assertion
     exactly. Both tests pass.

5. bff/test/integration/cache.test.ts fix verified — the archived-change test file, now touched again
   from this later change:
   - "never caches an analyze_pagespeed request carrying an explicit apiKey" now issues the request as
     POST with a JSON body (not the old GET+query form), and asserts cacheStatus: "bypass" on both of two
     identical calls plus that the upstream stub is actually called twice (never served from cache).
   - A NEW test, "rejects an apiKey supplied over GET even though the route otherwise accepts query-string
     input", exists, issues a real GET request with apiKey in the query string, and asserts
     response.status === 400. Both pass.

No gap was found. The old insecure path (GET + apiKey in query string) is actively rejected at the
earliest possible point in handleRequest(), and the UI transport (requestTool()) has no code path that
would ever send a secret over GET in the first place — the fix closes the hole from both the server and the
client side.

## pagespeed-view UI verification

- Mobile default — PageSpeedForm.tsx's strategy <select> uses defaultValue="mobile" (uncontrolled),
  matching analyzePagespeedInputSchema's z.enum(["mobile", "desktop"]).default("mobile"). Covered by
  PageSpeedForm.test.tsx's default-value assertion and PageSpeedContainer.test.tsx's outgoing-request
  assertion.
- Missing score/metric/field-data renders "unavailable", never 0 — ScoreGauge.tsx, LabMetricsPanel.tsx,
  and FieldDataPanel.tsx all branch on === undefined (not falsy-check), each with a dedicated test proving
  a genuine 0 (e.g. cumulativeLayoutShift: 0) renders as 0, distinct from the absent case. Read and
  confirmed in source and tests.
- Opportunity with no savings still listed — OpportunitiesTable.tsx never filters opportunities; an
  entry with neither savingsMs nor savingsBytes renders its title with Absent in both savings columns.
  Confirmed in source and in OpportunitiesTable.test.tsx's "still lists" case.

- Five secrets-suite properties — PageSpeedContainer.secrets.test.tsx read in full. All five
  (storage, URL, echo, export, cache-key) assert against a real DOM/network flow using a distinctive
  THE_KEY value. Notably, the URL test and the echo test's assertions were UPDATED (as this verify pass
  required checking) to reflect the new secure transport: the URL test asserts window.location.href/.search/.hash
  and every pushState/replaceState call never contain the key, and the echo test now asserts the outgoing
  fetch request URL itself does not contain THE_KEY — this replaces the OLD framing (recorded in the stale
  sdd/dashboard-views/apply-progress Engram memory, written before the security fix landed) that had accepted
  the query string containing the key as an inherent, accepted limitation. The code and tests are now
  internally consistent with the new POST-based transport; the memory artifact is stale on this specific
  point but the actual code/tests are correct.
- SecretCell — bff/ui/src/data/secret.ts read in full. take() nulls #value on every call (not just
  logically deprecating it), so "read once, never persisted" is a structural property of the class, not a
  convention — confirmed via data/secret.test.ts's repeated-call assertions.

## Regression check

git diff da55a7d..HEAD --stat -- bff/src src/http src/security src/schemas src/types wrangler.jsonc
bff/wrangler.jsonc shows exactly one file touched: bff/src/router.ts (+55/-0), the deliberate, documented
exception this PR makes. No drift into src/http/_, src/security/_, root wrangler.jsonc,
src/schemas/_, src/types/_, or any other frozen bff/src/*.ts file. openspec/specs/dashboard-bff/spec.md
was extended additively (new requirement + 3 scenarios only, verified via diff); the archived
openspec/changes/dashboard-bff-foundations/ folder itself was not touched (empty diff).

## Task completion

tasks.md Phase 6: 6.1-6.2 both [x], matching the actual shipped code and tests. Phase 7 correctly [ ].

## Issues

None CRITICAL. None WARNING for this PR's own scope.

- SUGGESTION: the Engram memory sdd/dashboard-views/apply-progress (#2906) still describes the
  pre-fix state of the "Key is not present in the URL" scenario as an accepted deviation with the outgoing
  fetch URL containing the key. That description is now stale relative to the actual code and tests (which
  correctly implement and test the secure POST transport). Recommend updating or superseding that memory
  entry to avoid confusing a future reader who trusts the apply-progress record over the code.
