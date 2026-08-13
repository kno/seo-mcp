```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:6f1ed0d297dc87bf2499efcf4720d1f8281e4d95a99077affa348e8c373b4643
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 39/39
scenarios: 93/93
test_command: pnpm test
test_exit_code: 0
test_output_hash: sha256:05351600850ff1d24c676282e20366eb0b54ac56539f549ad0d58f86c0c3a4f0
build_command: pnpm typecheck
build_exit_code: 0
build_output_hash: sha256:eb51d79a8911bbd5b83d4a1ceb89f1e58120a5a7a75de544caa93756ccaebfcb
```

# Verify Report — dashboard-insights (re-verification after fix commit `53eeebb`)

**Change**: `dashboard-insights`
**Branch**: `feat/dashboard-views-build-wiring`, the 11-PR chain `ef27eee` through `771c8cc`, plus follow-up fix `53eeebb`
**Mode**: Strict TDD (`state.yaml: strictTdd: true`)
**Artifact store**: `openspec` (hybrid — Engram pointer notes also present)
**Supersedes**: the prior FAIL report at this same path (`evidence_revision: sha256:fe1720bc`)

## Verdict: PASS WITH WARNINGS — archive-ready

**0 CRITICAL, 6 WARNING, 5 SUGGESTION.** Both prior blocking CRITICAL findings are genuinely closed and were
**mutation-verified in this session** — not merely observed to exist and pass. The dead security assertion is
closed and mutation-verified. The two substantial spec-drift gaps are closed with text that was independently
re-derived from source, not accepted from the commit message.

One of the six smaller "fixes" is a **regression**: the `history-comparison-view` source-line correction
replaced a _correct_ citation with a _less accurate_ one, because the prior report's own factual premise for
that item was wrong. It is a WARNING, not a blocker.

---

## Command evidence (executed fresh this session at HEAD `53eeebb`, working tree clean)

| Command                                                                        | Exit  | Result                                                                                                                                                       |
| ------------------------------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm test`                                                                    | 0     | **139 test files, 1321 tests, all passed** (11.98 s). Prior pass: 1318. The +3 are exactly the three new tests the fix commit claims.                        |
| `pnpm typecheck`                                                               | 0     | Clean over both TypeScript projects (root, then the `bff/ui` project). Output hash is byte-identical to the prior pass's — deterministic, and corroborating. |
| `pnpm run format:check`                                                        | 0     | Prettier check — "All matched files use Prettier code style!"                                                                                                |
| Vitest, `GscInsightsContainer.test.tsx` in isolation                           | 0 / 1 | Run twice under deliberate mutations — see the mutation table below.                                                                                         |
| Vitest, `authenticated-domain-report.test.ts` under the bff-integration config | 0 / 1 | Run under a deliberate mutation — see below.                                                                                                                 |

The working tree is clean: every mutation applied below was reverted, and the revert was verified.

---

## Independent re-derivation of each claimed fix

Nothing in this section was accepted from the commit message. Each claim was re-derived from source, and every
new assertion was proven capable of failing by deliberately breaking the production code it covers.

### Mutation testing — the three new tests and the repaired assertion are all genuinely live

| #   | Mutation applied to production code                                                                                                                                                                                                                            | Expected to break               | Observed                                                                                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `domain-report.ts:73` — add a `leaked` field carrying the last space-delimited token of `gscError` to the returned payload. This leaks **only** the decoy token, **not** the substring `invalid_grant`, so it can be caught only by the assertion W1 repaired. | W1's decoy-credential assertion | **FAILED at `authenticated-domain-report.test.ts:48`** — expected the response body not to contain `DECOY_REFRESH_TOKEN_xyz789`. The previously-dead assertion is now the sole detector of a decoy-only leak, and it fires. |
| 2   | `GscInsightsContainer.tsx:297` — the onboarding threshold changed from `< 2` to `< 0`, so onboarding never triggers                                                                                                                                            | C1's two new tests              | **2 failed / 13 passed.** Both new tests failed looking for `snapshot-onboarding`; the printed DOM shows the Compare button rendered instead.                                                                               |
| 3   | `GscInsightsContainer.tsx:262` — the explicit-pair guard changed to `if (false)`, silently dropping the pair and falling back to the server default                                                                                                            | C2's new test                   | **1 failed / 14 passed** — expected the outgoing compare URL to contain `baseSnapshotId=1`.                                                                                                                                 |

### C1 — "Comparison Entry Point Requires Two Snapshots To Exist First" — CLOSED

Two tests added at `GscInsightsContainer.test.tsx:498-556`. They map to a real conditional, verified by reading
`GscInsightsContainer.tsx:296-388`: `needsOnboarding` is true only when a snapshot list has been fetched and
holds fewer than two entries, and the JSX renders `data-testid="snapshot-onboarding"` with a nested
zero-count ternary selecting between the zero-snapshot and one-snapshot copy, otherwise rendering the Compare
button.

Both tests drive the container through a real `list_search_console_snapshots` fetch (`count: 0`, then
`count: 1` with one real snapshot), assert the onboarding element's **copy** — distinguishing the zero case from
the one case, so they also pin the inner ternary, not just the outer guard — and assert the Compare button is
**absent**, which is the spec's actual requirement (replaced, not disabled). Non-tautological: mutation 2
breaks both.

### C2 — "An explicit snapshot pair overrides the two-most-recent default" — CLOSED

One test at `GscInsightsContainer.test.tsx:579-643`. It uses a purpose-built three-snapshot fixture
(`SNAPSHOTS_THREE`, ids 3/2/1 most-recent-first) so that the explicitly-selected pair (**#1 base, #3 current**)
is provably _not_ the two-most-recent default (#2, #3) — the fixture design is what makes the test
discriminating rather than accidentally-passing.

It then clicks the real `SnapshotListPanel` radios, clicks the Compare button **by its name**
("compare snapshot #1 vs #3", which itself requires the container's label-switching state at
`GscInsightsContainer.tsx:383-385` to have updated), waits for `diff-endpoints`, and inspects the **actual
outgoing request URL** captured by the fetch mock:

- the URL must contain `baseSnapshotId=1`
- the URL must contain `currentSnapshotId=3`
- the URL must NOT contain `baseSnapshotId=2` — the explicit negative for silent substitution

This reaches the real conditional at `GscInsightsContainer.tsx:262-265`. Non-tautological: mutation 3 breaks it.

### W1 — dead decoy constant — CLOSED, and now the load-bearing detector

`stub-mcp-worker.js` read directly: it defines `DECOY_CREDENTIAL` as `DECOY_REFRESH_TOKEN_xyz789` (`:434`) and
injects it into the `analyze_domain` success payload's `gscError` at `:500`, inside the text
"OAuth token exchange failed: invalid_grant" followed by that decoy.
`authenticated-domain-report.test.ts:23` now declares exactly that string. The sibling
`authenticated-search-console.test.ts` already used the correct value; the two files now agree.

Crucially, mutation 1 proves the assertion is not merely _correct_ but _necessary_: a leak that carries the
credential without the `invalid_grant` prefix is caught **only** by this assertion. Before the fix such a leak
would have shipped silently.

### W2 — `seo-intelligence-view` spec drift — CLOSED, and the new text is factually accurate

Two requirements added (+4 scenarios) and one amended. Every factual claim in the new text was re-derived:

| Spec claim                                                                                                  | Source re-read                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Verdict                                                       |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| The BFF resolves effective criteria via `resolveEffectiveCriteria`, marked `basis: "request"`               | `bff/src/authenticated/criteria.ts` — the `EffectiveCriteria` type pins `basis` to the literal `"request"`; the resolver fills every omitted field from its `DEFAULTS` map                                                                                                                                                                                                                                                                                                                                                                                                                               | Accurate                                                      |
| "Every default mirrors the exact fallback the corresponding `src/seo/` function uses"                       | Checked all five, field by field: `find_seo_opportunities` limit 10 equals `LIMITS.maxOpportunities` (`intelligence.ts:97`); `find_keyword_cannibalization` minImpressions 10 and limit 50 equal `maxCannibalizationGroups` (`intelligence.ts:39-40`); `map_keywords_to_pages` limit 100 equals `maxKeywordPages`, topQueriesPerPage 10 (`keyword-pages.ts:30-31`); `find_content_gaps` minPosition 21, minImpressions 10, limit 100 equals `maxContentGaps` (`keyword-pages.ts:81-83`); `analyze_domain` opportunityLimit 10, forwarded as `findSeoOpportunities`' own limit (`domain-report.ts:66-71`) | Accurate — all five exact                                     |
| "hardcoded `maxGscRows` pull of at most 250, from `src/config.ts`"                                          | `src/config.ts:38` sets `maxGscRows: 250`; it is used as the `rowLimit` at `intelligence.ts:180`, `intelligence.ts:220`, `keyword-pages.ts:135` and `keyword-pages.ts:177`                                                                                                                                                                                                                                                                                                                                                                                                                               | Accurate                                                      |
| "`GSC_PULL_CAVEAT` is exported as a single shared string so no view can drift"                              | `criteria.ts:63`; the **only** consumer is `EffectiveCriteriaPanel.tsx` (`:1` import, `:42` render), a single component used for all five tools                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Accurate — structurally single-sourced                        |
| "The view never receives the raw `gscError`, so state (c) MUST be implemented as `enrichmentError` present" | `DomainReportPanel.tsx:32,39,65,69,76` takes an optional `enrichmentError` prop and has **no** `gscError` prop at all; the three-state ternary at `:65` selects failed / succeeded / not-requested from `enrichmentError` and `search` only                                                                                                                                                                                                                                                                                                                                                              | Accurate — the spec now matches the shipped component exactly |

This is a substantive correction, not cosmetic: the old scenario text told an implementer to check `gscError`,
a field that provably does not exist by the time a response reaches the browser.

### W6 — the allowlist requirement — CLOSED, and the "structural" claim is real

The new requirement's load-bearing claim is that the exclusion is a **compile-time** property. Verified in
`bff/src/authenticated/registry.ts:135`, where `PublishedSchema` is declared as an indexed access over the
published schema map's own value types, and `:139`, where the route definition's field is
`schema: PublishedSchema`. That is exactly the union of the published schema map, so a row for a tool with no
published `outputSchema` cannot typecheck.

The spec's three scenarios map to real evidence: `registry.test.ts:27` (no key starts with `business_`) and
`registry.test.ts:35` (all six `business_*` names rejected before any upstream call); the 404 path at
`bff/test/integration/authenticated-search-console.test.ts:141`; and the type constraint above plus
`pnpm typecheck` exit 0.

### W3, W7, W8 — CLOSED

- **W3**: the dangling forward reference now points at `history-comparison-view`'s "Snapshot Retention Is
  Unbounded, Not a Rolling Window" requirement. That requirement exists at
  `history-comparison-view/spec.md:74` — verified directly, so the cross-reference resolves after archive
  splits the files.
- **W7**: the provisional-view scenario is now a hypothetical. There are **zero** remaining occurrences of
  `find_striking_distance_keywords` in `authenticated-source-contract/spec.md` — no residue.
- **W8**: retitled to "A missing currency label surfaces an explicit configuration-needed state", which now
  matches its own GIVEN/WHEN/THEN and the shipped `KeywordMetricsTable` behavior.

### W9 — HALF CLOSED, HALF REGRESSED (see WARNING W-A)

- `search-console-view/spec.md` — **correct now.** Spot-checked every citation against `src/server.ts`: the
  `search_console_query` registration begins at line **240**; `siteUrl` spans **246-251**; `startDate` is
  **252**; `endDate` is **253**; `dimensions` spans **254-265**; the 1-to-250 `rowLimit` is **266**. All five
  new coordinates are exact.
- `history-comparison-view/spec.md:64` — **regressed.** Detailed as W-A below.

---

## Task completion

| Metric                                  | Value |
| --------------------------------------- | ----- |
| Checked `[x]` boxes in `tasks.md`       | 94    |
| Unchecked `[ ]` boxes                   | 7     |
| Unchecked boxes that are in-scope tasks | **0** |

All 7 unchecked boxes are `F1` through `F7` under the heading "Recorded follow-ups (verified, deliberately NOT
tasked here)" (`tasks.md:273-285`). Phases 1 through 12 are entirely `[x]`. (Note: the prior report stated 89
in-scope tasks; the actual checked-box count is 94. Nothing turns on it — the incomplete count is 0 either way.)

`state.yaml` now reads `apply: done` (was `pending`), which is consistent with the tasks file.

---

## Per-capability compliance

Totals moved because the fix commit **added** spec content: +3 requirements and +7 scenarios.

| Capability                      | Requirements | Scenarios | Status                                                                                                                                               |
| ------------------------------- | ------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authenticated-source-contract` | 6/6          | 22/22     | PASS WITH WARNINGS — W-B (1 compile-time scenario has no negative test). 3 process scenarios remain process-verified, unchanged from the prior pass. |
| `search-console-view`           | 7/7          | 16/16     | PASS — fully covered; citations now exact.                                                                                                           |
| `gsc-insight-views`             | 7/7          | 15/15     | **PASS — C1 and C2 closed and mutation-verified.** Was 5/7 and 12/15.                                                                                |
| `keyword-research-view`         | 5/5          | 9/9       | PASS — W8 title corrected.                                                                                                                           |
| `seo-intelligence-view`         | 8/8          | 19/19     | PASS WITH WARNINGS — W-C (1 cross-view scenario covered only by distributed evidence), W10 (partial drill-down coverage, carried).                   |
| `history-comparison-view`       | 6/6          | 12/12     | PASS WITH WARNINGS — W-A (citation regression; the spec's behavioral text itself is correct).                                                        |
| **Total**                       | **39/39**    | **93/93** |                                                                                                                                                      |

### `gsc-insight-views` — the two previously-failing requirements

| Requirement                                             | Evidence                                                                                                                                                                      | Result                       |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Comparison Entry Point Requires Two Snapshots First (2) | `GscInsightsContainer.test.tsx:498-556` — zero-snapshot and one-snapshot onboarding copy asserted separately, Compare button asserted absent in both. Mutation 2 breaks both. | **COMPLIANT** (was UNTESTED) |
| Period-Over-Period States Both Snapshots (3)            | the first two scenarios unchanged; the explicit-pair scenario now covered by `GscInsightsContainer.test.tsx:585-642`, asserting the real outgoing URL. Mutation 3 breaks it.  | **COMPLIANT** (was UNTESTED) |

The other five requirements are unchanged from the prior pass and remain COMPLIANT.

### `authenticated-source-contract` — new requirement

| Scenario                                                     | Evidence                                                                                                                                              | Result                                               |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| No `business_*` tool is reachable through the BFF            | `registry.test.ts:27` (no key starts with `business_`), `:35` (all six rejected before upstream), `:154` (a 13-row total pin) — 23 tests, all passing | COMPLIANT                                            |
| An unschemad write tool cannot be added without a type error | the `PublishedSchema` union at `registry.ts:135` and the `schema` field at `:139`; `pnpm typecheck` exit 0                                            | COMPLIANT (compile-time; no negative test — **W-B**) |
| A write tool's route returns 404, not a dispatched write     | `bff/test/integration/authenticated-search-console.test.ts:141`                                                                                       | COMPLIANT                                            |

### `seo-intelligence-view` — new requirements

| Scenario                                                         | Evidence                                                                                                                                                                                                                                                         | Result                                       |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| An omitted criteria field still renders its real effective value | `criteria.test.ts` (8 tests) proves the resolver returns the tool's own default for every omitted field across all five tools; `EffectiveCriteriaPanel.test.tsx:6-12` proves the panel renders that value marked `basis: request`                                | COMPLIANT                                    |
| BFF-echoed criteria never confused with tool-echoed criteria     | Distributed: `EffectiveCriteriaPanel.test.tsx` pins `effective-criteria-panel` and `criteria-basis`; `GscInsightsContainer.test.tsx:123` pins the separate `opportunity-criteria` element. Distinct components, distinct views, distinct testids, distinct types | COMPLIANT via distributed evidence — **W-C** |
| 250-row caveat renders for a small, apparently-complete result   | `EffectiveCriteriaPanel.test.tsx:14-19` — the panel takes **no** count or limit input at all, so the caveat is structurally unconditional inside it                                                                                                              | COMPLIANT                                    |
| 250-row caveat identical across all five tools                   | a single exported `GSC_PULL_CAVEAT` with exactly one consumer; `criteria.test.ts:70-74` pins it non-empty and containing "250"                                                                                                                                   | COMPLIANT                                    |

The amended `analyze_domain` GSC-enrichment requirement remains COMPLIANT — `DomainReportPanel.test.tsx`
(three distinct states) plus the mutation-verified integration decoy sweep.

---

## Design coherence

Unchanged from the prior pass, with two rows upgraded:

| `design.md` decision                                                          | Followed? | Notes                                                                                                                                    |
| ----------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Effective request criteria are echoed by the BFF                              | Yes       | `criteria.ts` plus an `effectiveCriteria` resolver on all five rows (`registry.test.ts:178`). **Now reflected in the spec — W2 closed.** |
| The authenticated registry is an allowlist, and Business Profile is not in it | Yes       | **Now reflected in the spec — W6 closed.**                                                                                               |
| The nested `history` and `charts` UI file layout                              | Deviation | Unchanged: built at the flat `containers/` and `organisms/` layout, declared inline in task 11.8. Breaks no spec.                        |

All other rows are unchanged and were re-confirmed by the prior pass's source reads; nothing in `53eeebb`
touches production code.

---

## Strict TDD compliance

| Check                            | Result | Details                                                                                                                                                                        |
| -------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TDD evidence reported            | Pass   | `apply-progress` (Engram `#2925`, 9 revisions) documents RED then GREEN per phase.                                                                                             |
| All tasks have tests             | Pass   | 43 new test files; every phase's RED task names an existing file.                                                                                                              |
| RED confirmed (test files exist) | Pass   | All 43 present on disk.                                                                                                                                                        |
| GREEN confirmed (tests pass)     | Pass   | 1321/1321 at exit 0, executed this session.                                                                                                                                    |
| Triangulation adequate           | Pass   | Improved by this commit: C1 now ships both the zero and one-snapshot cases; C2 ships both the positive (`baseSnapshotId=1`) and the explicit negative (no `baseSnapshotId=2`). |
| Safety net for modified files    | Pass   | `53eeebb` touches no production code — only tests and specs. Full suite green before and after.                                                                                |

### Test layer distribution (this change's new test files)

| Layer                                                                               | Files  | Tool                                          |
| ----------------------------------------------------------------------------------- | ------ | --------------------------------------------- |
| Unit — schema, classifier, registry, freshness, ledger, criteria, bounds, organisms | 26     | vitest and @testing-library/react             |
| Integration — MCP round-trip (`test/integration/`)                                  | 5      | vitest against real server registration       |
| Integration — BFF over a stub Worker (`bff/test/integration/`)                      | 5      | vitest-pool-workers plus `stub-mcp-worker.js` |
| Integration — container and a11y                                                    | 7      | @testing-library/react plus axe               |
| **Total**                                                                           | **43** |                                               |

### Assertion quality

- **Tautologies**: zero. **Ghost loops**: zero. **Smoke-test-only**: none. **Orphan empty-collection
  assertions**: none. **Mock-heavy tests**: none over the 2x threshold.
- **Dead assertions: zero** — the single one found in the prior pass (W1) is closed and was proven live by
  mutation 1.
- The three new tests were each proven capable of failing against a deliberate production-code break. This is
  stronger evidence than the prior pass held for any assertion in the change.

**Assertion quality: all assertions verify real behavior.**

### Quality metrics

**Linter**: not available — Prettier only, no ESLint or equivalent configured.
**Type checker**: clean — `pnpm typecheck` exit 0 over both TypeScript projects.
**Coverage**: not available — no coverage script and no vitest coverage dependency (S5).

---

## Issues Found

### CRITICAL

**None.** Both prior blockers (C1, C2) are closed and mutation-verified.

### WARNING

**W-A (NEW — a regression introduced by the fix commit) — the `history-comparison-view` citation "correction"
made the citation less accurate.**
`history-comparison-view/spec.md:64` was changed from `test/integration/scheduled.test.ts` to
`test/scheduled.test.ts`. **The original citation was correct.** Both files exist — the prior report's premise
("the real path is `test/scheduled.test.ts`") was simply wrong, and this commit faithfully implemented that
wrong premise.

The sentence being cited claims `runScheduledSnapshots` "captures one `snapshot_search_console`-equivalent
write per site listed in `GSC_SNAPSHOT_PROPERTIES`, on a scheduled trigger". Only
`test/integration/scheduled.test.ts:44-78` exercises that: its test is named "stores one snapshot per
configured property", and it asserts `summary.attempted` is 1, `summary.stored` is 1, and the resulting
`gsc_snapshots` D1 row. By contrast, `test/scheduled.test.ts:41-56`'s `runScheduledSnapshots` block covers
**only** the two negative early returns (`no-db`, `no-properties`) and never captures anything at all. Both
files run in the suite — one row under the `integration` project (1 test) and one under the `unit` project
(6 tests) — which is exactly why the prior pass, reading only the `unit` project rows, mistook one for the
other.

Fix: revert that one line to `test/integration/scheduled.test.ts`, or cite both. Non-blocking: the spec's
substantive claim (no scheduled crawl-snapshot path exists) is independently confirmed and unaffected.

**W-B (NEW) — the new allowlist requirement's compile-time scenario has no negative test.**
"An unschemad write tool cannot be added to the registry without a type error" is enforced structurally
(`PublishedSchema` at `registry.ts:135`, applied at `:139`) and `pnpm typecheck` proves the current registry
satisfies it, but nothing proves a _bad_ row would fail — that needs an expect-type style negative fixture,
which this repo has no tooling for. Counted compliant on the same basis the prior pass counted the
provisional-view process scenarios. Worth a deliberate type-error fixture eventually.

**W-C (NEW) — the "two criteria mechanisms are never confused" scenario is covered only by distributed
evidence.** No single test renders a `seo-intelligence-view` result and a `gsc-insight-views` opportunity
result together. It is counted compliant because the merged state is structurally unreachable — two different
components (`EffectiveCriteriaPanel` versus the `opportunity-criteria` block), in two different views, with two
different prop types (an `EffectiveCriteria` carrying `basis` versus a bare numeric record), each independently
runtime-tested with distinct testids. Recorded so the reasoning is auditable rather than assumed.

**W-D (NEW) — `SeoIntelligenceContainer.tsx:145` guards `EffectiveCriteriaPanel` behind a truthiness check.**
The newly-added spec requirement says the 250-row caveat renders "unconditionally". It does so in practice
because all five registry rows carry an `effectiveCriteria` resolver (`registry.test.ts:178`), but the spec's
word "unconditionally" is now a stronger promise than the component's local structure. This was SUGGESTION S2
in the prior pass; it is promoted to WARNING only because the spec now makes it a MUST.

**W10 (carried, unchanged) — two `seo-intelligence-view` drill-down surfaces are implemented but untested.**
`PageKeywordsPanel.tsx` and `ContentGapsPanel.tsx` each render a `DrillDownLink`, and neither organism has a
test file (confirmed again this session — there is no `PageKeywordsPanel.test.tsx` and no
`ContentGapsPanel.test.tsx`). Two of the four sources named by "A page-referencing finding opens the page
report" remain runtime-unproven.

**W-E (process) — a verify report's own citations are evidence and must be re-derived, not carried forward.**
W-A exists solely because the prior report's citation claim was accepted at face value by the fix commit. This
report's competing claim was checked directly: both paths were listed on disk, both files' `describe` blocks
were read, and both project rows were located in the suite output.

### SUGGESTION

**S1** — `registry.test.ts` proves `cluster_keywords`'s absence explicitly (`:148-150`) but proves
`snapshot_crawl`, `list_crawl_snapshots` and `compare_crawls`'s absence only implicitly, via the 13-row total.
Naming them would make PR11's deliberate exclusion self-documenting.

**S2** — The three new C1/C2 tests re-declare a `SNAPSHOTS_THREE` fixture and a local restore hook alongside
the file's existing `SNAPSHOTS`. Harmless duplication, but the file now carries five near-identical
fetch-save-and-restore blocks.

**S3** — Follow-ups F1 through F7 remain unchecked `[ ]` boxes. A mechanical archive check that counts
unchecked boxes will flag seven. Consider a distinct marker or a separate follow-ups file.

**S4** — `SeoIntelligenceContainer.tsx` remains the largest container and the only new view whose container has
an a11y test but no behavioral container test; tab switching, shared-selector persistence and per-tab error
routing are unproven end to end for that view.

**S5** — No coverage tooling configured (no coverage script, no vitest coverage dependency), so per-changed-file
line and branch coverage is unavailable. Not a failure.

---

## Verdict

**PASS WITH WARNINGS — archive-ready.**

Both blocking findings are closed, and closed _substantively_: each new test was proven to fail against a
deliberate break of the exact production conditional it claims to cover, so none of them is tautological or
accidentally-passing. The repaired security assertion is not merely correct now — mutation 1 showed it is the
**only** detector of a credential-only leak, so the repair closed a real (if redundantly-covered) hole.

The two high-value spec gaps (W2, W6) are closed with text that was re-derived from source field by field: all
five criteria default sets match their `src/seo/` fallbacks exactly, `maxGscRows` really is 250 and really is
unrecorded in every output, `GSC_PULL_CAVEAT` really is single-sourced, `DomainReportPanel` really has no
`gscError` prop, and `PublishedSchema` really is the published-schema union that makes the allowlist a
compile-time guarantee. None of these is a cosmetic keyword insertion.

Nothing blocks archive. The one regression (W-A) is a single wrong file path in a spec citation; it should be
reverted before archive, since these specs merge into the permanent capability specs, but it misstates no
behavior and breaks no test.

**Recommended next step: `sdd-archive`.** Optionally revert the one-line W-A citation first (30 seconds, no
test impact). W-B, W-C, W-D, W10 and S1 through S5 are polish and can ride as follow-ups.
