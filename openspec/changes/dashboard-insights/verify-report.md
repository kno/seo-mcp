```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:fe1720bc9e9aa98045283340b35150fec5de537633987fd8c9fd52914d6af989
verdict: fail
blockers: 2
critical_findings: 3
requirements: 34/36
scenarios: 83/86
test_command: pnpm test
test_exit_code: 0
test_output_hash: sha256:55a17bfac5871711f3aab08028139451e45456a73c367cc7be9bb58e76b1e55d
build_command: pnpm typecheck
build_exit_code: 0
build_output_hash: sha256:eb51d79a8911bbd5b83d4a1ceb89f1e58120a5a7a75de544caa93756ccaebfcb
```

# Verify Report — dashboard-insights (complete change, PR1–PR11)

**Change**: `dashboard-insights`
**Branch**: `feat/dashboard-views-build-wiring`, commits `ef27eee`..`771c8cc` (11 stacked PRs)
**Mode**: Strict TDD (`state.yaml: strictTdd: true`)
**Artifact store**: `openspec` (hybrid — Engram pointer notes also present)

## Verdict: FAIL (not archive-ready) — 3 untested required scenarios, no functional defect

3 CRITICAL, 8 WARNING, 5 SUGGESTION.

**Read this verdict precisely.** Nothing is broken. The suite is green, the type checker and formatter
are clean, all 89 in-scope tasks are complete, and all five independently-requested security and honesty
properties were re-derived from source and re-executed at runtime — every one held. The verdict is `fail`
for exactly one reason: **three required spec scenarios have no passing covering test**, and this
contract is unambiguous that an untested required scenario is CRITICAL and that incomplete scenario
evidence cannot carry a passing verdict. All three are _coverage_ gaps over implementations that are
present and correct in source (C1, C2 below); the remediation is roughly three assertions in one existing
test file, not a code change. They are deliberately not laundered into warnings to reach a green verdict,
since that is precisely the kind of self-report failure this pass exists to catch.

Every security-critical and honesty-critical claim in the
apply-phase self-report was independently re-derived from source and re-executed at runtime in this
session, and every one held. The warnings are concentrated in **spec-versus-reality drift** — three of
the six delta specs no longer fully describe what shipped, because mechanisms discovered during apply
(the BFF-echoed effective-criteria resolver, `analyze_domain`'s `gscError` classify-and-discard, the
unconditional 250-row caveat) were folded into `proposal.md` and `design.md` in the fourth
reconciliation pass but never back into the spec files. Those specs are what `openspec archive` merges
into the permanent `openspec/specs/` capabilities, so the drift is worth closing before archive.

---

## Command evidence (executed fresh, this session — not read from any prior report)

| Command                                                                                                       | Exit | Result                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                                                                                                   | 0    | **139 test files, 1318 tests, all passed** (12.09 s). Matches the 1318 the apply report claimed.                       |
| `pnpm typecheck`                                                                                              | 0    | Clean. Verified the script genuinely runs both projects: `tsc --noEmit && tsc --noEmit -p bff/ui` (`package.json:21`). |
| `pnpm run format:check`                                                                                       | 0    | `prettier --check .` — "All matched files use Prettier code style!"                                                    |
| `npx vitest run -c vitest.bff-integration.config.ts bff/test/integration/authenticated-domain-report.test.ts` | 0    | **2/2 passed**, re-run in isolation for item 2 below.                                                                  |
| `npx vitest run --project unit` on the three `bff/test/authenticated/` files                                  | 0    | 49/49 passed, re-run in isolation.                                                                                     |

`test_output_hash` and `build_output_hash` in the envelope are SHA-256 digests of the exact captured
stdout+stderr of those two runs.

Working tree is clean apart from `openspec/changes/dashboard-insights/state.yaml`. No coverage tool and
no linter beyond Prettier are configured in `package.json`, so per-file coverage and lint metrics are
reported as unavailable, not as failures.

---

## Task completion

`tasks.md` Phases 1–12: **every task `[x]`**. Verified by direct read — Phases 1 (1.1-1.6), 2 (2.1-2.10),
3 (3.1-3.6), 4 (4.1-4.9), 5 (5.1-5.7), 6 (6.1-6.10), 7 (7.1-7.5), 8 (8.1-8.8), 9 (9.1-9.7),
10 (10.1-10.13), 11 (11.1-11.9), 12 (12.1-12.4).

The seven remaining `[ ]` boxes are `F1`–`F7` under **"Recorded follow-ups (verified, deliberately NOT
tasked here)"**. They are explicitly out of scope by their own section heading and each is corroborated
by a real code fact re-verified here (F1/F2 below, F3 in item 4, F7 in item 1). They are **not**
incomplete tasks. See SUGGESTION S3.

| Metric                                                  | Value |
| ------------------------------------------------------- | ----- |
| Tasks total (in scope)                                  | 89    |
| Tasks complete                                          | 89    |
| Tasks incomplete                                        | 0     |
| Recorded follow-ups (out of scope, unchecked by design) | 7     |

---

## The five independently-confirmed items

### 1. Threat row (f) — `AUTHENTICATED_REGISTRY` contains no `business_*` name — CONFIRMED

Read `bff/src/authenticated/registry.ts` in full. `AUTHENTICATED_REGISTRY` has exactly **13** rows:

- `search-console` (11): `search_console_query`, `find_striking_distance_keywords`,
  `find_low_ctr_opportunities`, `snapshot_search_console`, `list_search_console_snapshots`,
  `compare_search_console`, `find_seo_opportunities`, `find_keyword_cannibalization`,
  `map_keywords_to_pages`, `find_content_gaps`, `analyze_domain`
- `google-ads` (2): `get_keyword_metrics`, `discover_keywords`

No `business_*` name appears. The exclusion is **structural, not incidental**: the `schema` field is typed
as the union of every schema re-exported from `src/types/schemas.ts` (the published schema map), so a row
can only ever carry a published schema literal. The six Business Profile tools publish no `outputSchema`,
so adding one is a typecheck error, not a silent success.

Repo-wide grep for `business_` under `bff/src` and `bff/ui/src` returns **only doc comments** (five
matches, all in `registry.ts` and `router.ts` explaining the exclusion) — zero route paths, zero registry
rows, zero navigation entries, zero UI references.

Runtime proof re-executed: `bff/test/authenticated/registry.test.ts` (23 tests) asserts no key starts with
`business_`, that all six names return `isAuthenticatedTool === false` and
`getAuthenticatedRoute === undefined`, and pins the **exact total at 13** — a future addition of any kind
fails the suite. `bff/test/integration/authenticated-search-console.test.ts:138` proves
`/api/tools/business_reply_review` returns 404 without dispatching upstream.

**`cluster_keywords` / `snapshot_crawl` / `list_crawl_snapshots` / `compare_crawls` are genuinely absent**
from the registry — confirmed by reading the object literal, not by trusting the doc comment.
`registry.test.ts:148` asserts `cluster_keywords`'s absence explicitly.

**They still require the session gate.** Confirmed from `bff/src/router.ts`: `authenticate(request, env)`
runs at the top of the request handler, with **only** `POST /auth/session` ahead of it. An `unavailable`
outcome yields `gate_unavailable`, a `denied` outcome yields `gate_unauthorized`. Every `/api/tools/*`
path — authenticated-source or ordinary `dispatch()` — is behind that call. The apply report's claim that
"authenticated means two different things in this codebase" is accurate, and the gate is the outer of the
two.

### 2. Threat row (g) — `analyze_domain`'s `gscError` classify-and-discard — CONFIRMED, TEST RE-EXECUTED

`bff/src/authenticated/domain-report.ts` function `classifyDomainReportGscError` destructures `gscError`
out of the report, passes it to `classifyUpstreamFailure` exactly once, and returns the remaining fields
plus a new `enrichmentError: { code }`. The raw string is not present in the rest-spread, not in the
return value, and not referenced after that line. It is wired as `transformSuccess` on the
`analyze_domain` registry row; `registry.test.ts:182` asserts **no other route** has a `transformSuccess`
hook.

`bff/test/integration/authenticated-domain-report.test.ts` re-executed in isolation — **2/2 passed**.
Against the live stub worker (`gscProperty=simulate-domain-enrichment-failure.example`, which injects
the text "OAuth token exchange failed: invalid_grant DECOY_REFRESH_TOKEN_xyz789" at
`stub-mcp-worker.js:500`), the raw response body:

- does **not** contain `invalid_grant` (a real substring of the injected text — this is the load-bearing
  leak assertion)
- has `data.gscError` undefined
- has `data.enrichmentError` equal to `{ code: "upstream_credential_failure" }`
- still carries `data.crawl`

The emitted log line was also inspected in the run output — a `bff.upstream` event carrying only the tool
name, a hashed cache key, and `status: "ok"` — no credential material.

The unit test `bff/test/authenticated/domain-report.test.ts` (6 tests, re-executed) constructs its own
decoy inputs and asserts the serialized result excludes them across all four classes (not-configured,
credential, quota, unrecognized-fallback).

**One defect found in the integration test itself — see WARNING W1.** It does not invalidate the proof
(the `invalid_grant` assertion carries it), but one of its two leak assertions is dead.

### 3. Honesty — retention unbounded, crawl capture manual-only (tasks 11.3 / 11.4) — CONFIRMED

The underlying facts, re-derived directly:

- A recursive grep of `src/db/` for `DELETE`, `delete`, `expir`, `cleanup` and `retention` returns
  **zero matches**. No deletion, expiry, or age-based cleanup exists in `gsc-store.ts` or
  `crawl-store.ts`. `ROADMAP.md`'s "rolling 90-day retention in D1" is unimplemented (F1).
- `src/scheduled.ts` read in full: `runScheduledSnapshots` iterates
  `parseProperties(env.GSC_SNAPSHOT_PROPERTIES)` and calls `searchConsoleQuery` then `storeGscSnapshot`.
  It imports nothing from `crawl-store` and never calls `crawlSite`. There is no scheduled crawl-snapshot
  path (F2).

The copy in `bff/ui/src/containers/HistoryContainer.tsx` matches those facts exactly:

- Both snapshot lists (GSC and crawl) are headed "(unbounded and accumulating — the listing cap below
  shows only how many recent snapshots are displayed, never how long they are kept)".
- Crawl section: "Crawl snapshots are captured MANUALLY ONLY — there is no scheduled crawl-snapshot job.
  Nothing here accumulates on its own; a person must explicitly capture a snapshot below."
- The GSC section is correspondingly hedged rather than overclaimed: "GSC snapshots MAY accumulate
  automatically via a scheduled job, but ONLY when the operator has configured `GSC_SNAPSHOT_PROPERTIES`
  — this is not guaranteed for every property." That matches the real no-properties early return in
  `runScheduledSnapshots`.

No rolling-90-day claim exists anywhere: grepping `90` across `bff/ui/src/containers` and
`bff/ui/src/organisms` returns only unrelated PageSpeed scores, a customer-ID fixture, and the two
`HistoryContainer.test.tsx` assertions that _forbid_ it. `HistoryContainer.test.tsx` asserts the absence
of both a 90-day pattern and "retention window", both before any fetch and after a snapshot list renders.

### 4. Currency and hedged-zero honesty (tasks 8.2 / 8.3) — CONFIRMED

`bff/ui/src/organisms/KeywordMetricsTable.tsx` has exactly two renderers:

- `renderBidValue(value, currencyLabel)` returns the literal string "Currency not configured" when
  `currencyLabel` is `undefined`; otherwise it returns "0 LABEL (or not reported)" for a zero, and
  `value.toFixed(2)` followed by the label for a non-zero.
- `renderMetricValue(value)` returns "0 (or not reported)" for a zero, otherwise the plain number.

There is **no code path that emits a bare bid number**: the undefined-label branch returns early with a
text state, and a page-level `role="alert"` panel (`data-testid="ads-currency-not-configured"`) explains
why. A `0` is hedged in both the bid and the volume renderer — never "confirmed zero", never "no data".

The label's provenance is operator config, not payload: `bff/src/router.ts:580-583` reads
`env.ADS_BID_CURRENCY_LABEL` and emits it **only** for a `source === "google-ads"` route and **only** when
it is a non-empty string — omitted entirely (never an empty string) otherwise, so the view distinguishes
"unset" from "set to empty" by field presence alone. `bff/wrangler.jsonc:85` supplies the default "USD".
`KeywordMetric` genuinely carries no currency field (`src/google/ads.ts:9-16`, F3), so there is nothing in
the payload the view could have read instead.

Runtime proof: `KeywordResearchContainer.test.tsx` — "renders every bid value with the
operator-configured currency label", "shows an explicit configuration-needed state instead of a bare bid
value when no currency label is configured", "labels a 0 avgMonthlySearches/bid as hedged, never as a bare
confirmed zero".

### 5. Classification completeness — CONFIRMED, both sets exact-matched against real guards

`bff/src/authenticated/classify.ts` uses `Array.includes(text)` — **exact** string match — so byte drift in
any guard silently degrades to `tool_failed`. Every literal was therefore matched character-for-character
against its real thrower:

| Classifier constant               | Literal                                      | Real thrower                                                                 | Match |
| --------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------- | ----- |
| `NOT_CONFIGURED_TEXTS[0]`         | Google credentials are not configured        | `src/google/auth.ts:19`                                                      | yes   |
| `NOT_CONFIGURED_TEXTS[1]`         | Google Ads developer token is not configured | `src/google/ads.ts:62`                                                       | yes   |
| `NOT_CONFIGURED_TEXTS[2]`         | Google Ads customer ID is not configured     | `src/google/ads.ts:67`                                                       | yes   |
| `D1_NOT_CONFIGURED_TEXT`          | D1 storage is not configured                 | `src/server.ts:620, 666, 694, 742, 776, 804` (all six guards byte-identical) | yes   |
| `INSUFFICIENT_SNAPSHOTS_TEXTS[0]` | Need at least two snapshots to compare       | `src/server.ts:705`                                                          | yes   |
| `INSUFFICIENT_SNAPSHOTS_TEXTS[1]` | Need at least two crawl snapshots to compare | `src/server.ts:815`                                                          | yes   |

**Both** Google Ads guards are covered — `src/google/ads.ts` contains exactly two "is not configured"
throws and both are in the set, so the mid-chain gap found and fixed during PR8 is closed with no residue.
**Both** insufficient-snapshot variants (GSC and crawl) are covered, and the D1 guard text is confirmed
byte-identical across both families, which is why only one literal was needed there.

The unmatched-default behavior is correct in both classifiers: `tool_failed`, which the error table treats
as non-retryable and operator-facing — a classification miss can never degrade into a retry loop against a
broken credential or an exhausted quota. `bff/test/authenticated/classify.test.ts` (20 tests) exercises
all classes plus the fallbacks.

---

## Per-capability compliance

| Capability                      | Requirements | Scenarios | Status                                                                                                                                                                                                                                                                                               |
| ------------------------------- | ------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authenticated-source-contract` | 5/5          | 19/19     | PASS — the 3 uncovered scenarios belong to the _process_ requirement (counted complete: verified by direct artifact inspection, the only evidence a process requirement admits) "A Provisional View MUST NOT Ship Before Its Tool's Real Output Schema Is Reconciled", which has no runtime surface. |
| `search-console-view`           | 7/7          | 16/16     | PASS — fully covered.                                                                                                                                                                                                                                                                                |
| `gsc-insight-views`             | 5/7          | 12/15     | **FAIL** — C1 (2 untested scenarios), C2 (1 untested scenario).                                                                                                                                                                                                                                      |
| `keyword-research-view`         | 5/5          | 9/9       | PASS WITH WARNINGS — W8 (spec wording, not code).                                                                                                                                                                                                                                                    |
| `seo-intelligence-view`         | 6/6          | 15/15     | PASS WITH WARNINGS — W2 (spec drift), W10 (partial drill-down coverage).                                                                                                                                                                                                                             |
| `history-comparison-view`       | 6/6          | 12/12     | PASS — fully covered.                                                                                                                                                                                                                                                                                |
| **Total**                       | **34/36**    | **83/86** |                                                                                                                                                                                                                                                                                                      |

### `authenticated-source-contract` (5 requirements / 19 scenarios)

| Requirement                                                      | Evidence                                                                                                                                                                                                                                                                                                                      | Result                                         |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| No Google or MCP Credential Reaches the Browser (4)              | `bff/test/authenticated/containment.test.ts` — structural scan of every `bff/src/**/*.ts` plus `env.d.ts` and `wrangler.jsonc` for six credential identifiers, guarded by a non-empty file-list assertion; `authenticated-search-console.test.ts` decoy sweep; `export/json.test.ts` and `export/csv.test.ts` no-secret tests | COMPLIANT                                      |
| Two Distinct Staleness Axes Presented Separately (3)             | `bff/test/authenticated/freshness.test.ts`; `SourceFreshnessBadge.test.tsx`; `SearchConsoleContainer.test.tsx` "renders two distinct staleness elements, neither containing the other's figure"                                                                                                                               | COMPLIANT                                      |
| Upstream Quota Accounted Independently of the MCP Bucket (4)     | `quota-ledger.test.ts`; `AdsQuotaBadge.test.tsx`; `KeywordResearchContainer.test.tsx` "second, distinct google-ads quota badge"; `SearchConsoleContainer.test.tsx` quota-disables-resubmit                                                                                                                                    | COMPLIANT                                      |
| Credential Failure Distinguishable From Quota and From Empty (5) | `classify.test.ts` (20 tests); `authenticated-search-console.test.ts`; `SearchConsoleContainer.test.tsx` distinct-title assertion for all three states                                                                                                                                                                        | COMPLIANT                                      |
| A Provisional View MUST NOT Ship Before Reconciliation (3)       | Process requirement, no runtime surface. Partially enforced structurally by the typed registry gate (a tool without a published `outputSchema` cannot be registered at all). Procedurally satisfied: `state.yaml` records four reconciliation passes, each landing before the corresponding view PR.                          | PARTIAL — process-verified, not runtime-tested |

### `search-console-view` (7 requirements / 16 scenarios)

All seven covered by `SearchConsoleForm.test.tsx` (8 tests), `SearchConsoleTable.test.tsx` (4),
`SearchConsoleContainer.test.tsx` (12), `SearchConsoleContainer.a11y.test.tsx`, `export/json.test.ts` and
`export/csv.test.ts`. Highlights: an exact-input-set assertion (no invented control), client-side
`YYYY-MM-DD` rejection, `rowLimit` 1..250 clamp, a bound badge at exactly 250 with none below, a zero-row
empty state distinct from all three error states, no-polling ("issues no request on mount" plus
stale-request abort), and an export carrying the as-of note, bound provenance, and no credential.
COMPLIANT

### `gsc-insight-views` (7 requirements / 15 scenarios)

| Requirement                                                 | Evidence                                                                                                                                                                                                                                                                                                                                       | Result        |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Shared Property and Date-Range Selection (2)                | `GscInsightsContainer.test.tsx` persist-across-tool-switch, blocks-on-empty-property                                                                                                                                                                                                                                                           | COMPLIANT     |
| Applied Criteria Shown Alongside Results (1)                | same file — server-echoed criteria including defaults                                                                                                                                                                                                                                                                                          | COMPLIANT     |
| Ranked Opportunity Sets Label Their Own Bound (3)           | bound at `rowCount === criteria.limit`, none below, zero distinct from unfetched, plus `opportunity-exhaustiveness-caveat` asserted present even at the bound                                                                                                                                                                                  | COMPLIANT     |
| Period-Over-Period States Both Snapshots (3)                | both ids, labels and date ranges after list-and-compare; insufficient-snapshots as its own state. **"An explicit snapshot pair overrides the two-most-recent default" has no covering test**                                                                                                                                                   | UNTESTED (C2) |
| Content-Decay Direction Unambiguous Across Four Buckets (3) | all four buckets with distinct classes and null-side labels; per-bucket `maxDiffRows` labelling                                                                                                                                                                                                                                                | COMPLIANT     |
| Comparison Entry Point Requires Two Snapshots First (2)     | **Implemented** at `GscInsightsContainer.tsx:296-372` — `needsOnboarding` is true only once a list has been fetched and holds fewer than two snapshots, it replaces the Compare button entirely rather than disabling it, and it distinguishes the zero-snapshot from the one-snapshot copy — but **no test references `snapshot-onboarding`** | UNTESTED (C1) |
| Reporting Lag Applies to Every GSC-Backed Tool (1)          | two distinct as-of markers for the base and current periods                                                                                                                                                                                                                                                                                    | COMPLIANT     |

### `keyword-research-view` (5 requirements / 9 scenarios)

All five covered by `KeywordResearchContainer.test.tsx` (10 tests) plus
`KeywordResearchContainer.a11y.test.tsx` (4). Ships with metrics alone, currency label always present,
hedged zero, cluster members listed individually, `cluster_keywords` carrying no quota or freshness badge
and never blocked by Ads state, and Ads-not-configured distinct from a zero-keyword empty result. The
two-quota-source split is real at the BFF layer: `source: "google-ads"` with its own `AUTH_SOURCE_BUDGET`
and `AUTH_SOURCE_TTL_SECONDS` key and a `lagDays: 0` override, asserted in `registry.test.ts:142`.
COMPLIANT — see W8 for a wording issue in the spec, not the code.

### `seo-intelligence-view` (6 requirements / 15 scenarios)

| Requirement                                                        | Evidence                                                                                                                                                                                                                                                            | Result        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Every Recommendation Traceable to Its Evidence (2)                 | `SeoOpportunitiesPanel.test.tsx` — type and recommendation together, distinct badge classes per type                                                                                                                                                                | COMPLIANT     |
| Impact, Effort and Priority Score All Shown (3)                    | same file — all three render together, `effort` as a coarse label, no invented 0-100 scale. No sort control exists; the tool already returns priority-sorted output and all three fields render unconditionally, so the sort scenario is satisfied by construction. | COMPLIANT     |
| Cannibalization Findings Name Competing Pages Within the Bound (2) | `CannibalizationPanel.test.tsx` — page, clicks, impressions and position per entry, bounded label when `pages.length < pageCount`, no label when complete                                                                                                           | COMPLIANT     |
| Internal-Linking Recommendations Remain Unbuilt (2)                | `SeoOpportunitiesPanel.test.tsx` "never presents striking_distance's recommendation as link-graph-aware"; the second scenario is a negative satisfied by absence                                                                                                    | COMPLIANT     |
| `analyze_domain`'s GSC Enrichment Has Three Distinct States (3)    | `DomainReportPanel.test.tsx` — not-requested, succeeded and classified-failure all distinct, with the failure never collapsing into not-requested; plus the integration decoy sweep                                                                                 | COMPLIANT     |
| Drill-Down Into Existing Page and Site Views (3)                   | opportunity and cannibalization drill-downs tested; a `page: null` cannibalization opportunity omits the affordance; crawl drill-down into `site-crawl-view` tested. **`PageKeywordsPanel` and `ContentGapsPanel` drill-downs are implemented but untested**        | PARTIAL (W10) |

### `history-comparison-view` (6 requirements / 12 scenarios)

All six covered by `HistoryContainer.test.tsx` (17 assertions across the retention, manual-capture,
onboarding, per-family independence, diff-direction and D1-classification groups) plus
`HistoryContainer.a11y.test.tsx`. Both sub-families' onboarding states are directly asserted
(`gsc-history-onboarding`, `crawl-history-onboarding`), including the negative case — the crawl onboarding
element is asserted absent once two snapshots exist. COMPLIANT

---

## Design coherence

| `design.md` decision                                                                      | Followed? | Notes                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credential containment is structural, not procedural                                      | Yes       | `containment.test.ts` is a regression fence over `bff/src`, `env.d.ts` and `wrangler.jsonc`; the six Ads and OAuth identifiers appear in neither source nor config. `classify.ts`'s doc comment deliberately avoids naming the Ads env vars so the fence stays green — a nice detail that shows the fence is understood, not worked around. |
| Two staleness axes separated by type, not by discipline                                   | Yes       | `AuthenticatedOk<T>` makes `sourceFreshness` **required**, and `router.ts` recomputes it at request time even on a cache hit.                                                                                                                                                                                                               |
| A caching class for upstream-delayed data                                                 | Yes       | `authenticated-delayed` class with `closed`/`open` TTL by range state and a `?refresh=1` bypass.                                                                                                                                                                                                                                            |
| BFF-side upstream quota ledger                                                            | Yes       | `q1:{source}:{windowStart}` via `ctx.waitUntil`, `basis: "bff-observed"`; a KV failure degrades the estimate to `unavailable` rather than closing the request.                                                                                                                                                                              |
| Classify failures at the BFF now; server-side codes as a follow-up                        | Yes       | `classify.ts`; F4 records the follow-up.                                                                                                                                                                                                                                                                                                    |
| The authenticated registry is an allowlist, and Business Profile is not in it             | Yes       | Item 1 above.                                                                                                                                                                                                                                                                                                                               |
| `analyze_domain`'s `gscError` is classified like a failure though it arrives as a success | Yes       | Item 2 above; `forceOpenTtl: true` on a classified failure is honored by the router's cache-TTL branch.                                                                                                                                                                                                                                     |
| Effective request criteria are echoed by the BFF                                          | Yes       | `bff/src/authenticated/criteria.ts` plus an `effectiveCriteria` resolver on all five intelligence rows (`registry.test.ts:178` asserts each is defined). **Not reflected in the spec — W2.**                                                                                                                                                |
| Hand-rolled SVG charting, no charting library                                             | Yes       | No charting dependency in `package.json`.                                                                                                                                                                                                                                                                                                   |
| `bff/ui/history/*` and `bff/ui/src/charts/*` file layout                                  | Deviation | Built at the established flat `containers/` and `organisms/` layout instead. Declared inline in task 11.8 with its rationale — the nested tree is not a convention anywhere in this codebase — and consistent with all ten prior view PRs. Breaks no spec.                                                                                  |

---

## Strict TDD compliance

| Check                                     | Result | Details                                                                                                                                                                                                                                                                        |
| ----------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TDD evidence reported                     | Pass   | `apply-progress` (Engram `#2925`, topic `sdd/dashboard-insights/apply-progress`, 9 revisions) documents RED then GREEN per phase.                                                                                                                                              |
| All tasks have tests                      | Pass   | 43 new test files across `test/schemas/`, `test/integration/`, `bff/test/` and `bff/ui/src/`. Every phase's RED task names a file that exists.                                                                                                                                 |
| RED confirmed (test files exist)          | Pass   | All 43 verified present on disk.                                                                                                                                                                                                                                               |
| GREEN confirmed (tests pass on execution) | Pass   | 1318/1318 at exit 0 in this session — executed, not read from the apply report.                                                                                                                                                                                                |
| Triangulation adequate                    | Pass   | Bound requirements consistently ship both the positive and the negative case: `rowCount === 250` **and** below-cap; `count === effectiveLimit` **and** below; `pages.length < pageCount` **and** complete; per-bucket `maxDiffRows` labelling only the bucket that reached it. |
| Safety net for modified files             | Pass   | The `z.infer` alias refactors in `src/google/*`, `src/db/*` and `src/seo/*` kept logic byte-unchanged, and the pre-existing suites for those modules stayed green.                                                                                                             |

### Test layer distribution (this change's 43 new files)

| Layer                                                                               | Files  | Tool                                                     |
| ----------------------------------------------------------------------------------- | ------ | -------------------------------------------------------- |
| Unit — schema, classifier, registry, freshness, ledger, criteria, bounds, organisms | 26     | vitest / @testing-library/react                          |
| Integration — MCP round-trip (`test/integration/`)                                  | 5      | vitest against real server registration                  |
| Integration — BFF over a stub Worker (`bff/test/integration/`)                      | 5      | `@cloudflare/vitest-pool-workers` + `stub-mcp-worker.js` |
| Integration — container and a11y (`*.test.tsx`, `*.a11y.test.tsx`)                  | 7      | @testing-library/react + axe                             |
| **Total**                                                                           | **43** |                                                          |

All five new views carry an a11y and keyboard-reachability suite — `SearchConsole`, `GscInsights`,
`KeywordResearch`, `SeoIntelligence`, `History` — satisfying every phase's PROOF task.

### Assertion quality audit

Swept all 43 new test files:

- **Tautologies** (`expect(true).toBe(true)`, `expect(1).toBe(1)`, bare `toBeTruthy()`): **zero**.
- **Ghost loops** (assertions inside a loop over a possibly-empty collection): **zero**. The one
  structural loop, in `containment.test.ts`, is explicitly guarded by a non-empty file-list assertion
  before iterating — the exact failure mode a structural scan is prone to, and it was anticipated.
- **Smoke-test-only** (`render()` plus `toBeInTheDocument()` with no behavioral assertion): none found.
  Every `toBeInTheDocument()` in the new container tests is paired with a value, count,
  class-distinction, or absence assertion.
- **Orphan empty-collection assertions**: none. Every negative `queryBy` assertion has a companion
  positive case in the same file.
- **Mock-heavy tests**: none exceed the 2x mocks-to-assertions ratio; the container tests use a single
  `global.fetch` stub with real component rendering rather than mocking components.

**One dead assertion found — W1.** That is the only assertion-quality defect in the change; the
two CRITICAL findings are missing tests, not bad ones.

### Quality metrics

**Linter**: not available — Prettier only, no ESLint or equivalent configured.
**Type checker**: clean — `pnpm typecheck` exit 0 over both `tsconfig` projects.
**Coverage**: not available — no coverage script and no `@vitest/coverage-*` dependency (SUGGESTION S5).

---

## Issues Found

### CRITICAL

All three are untested required scenarios, not functional defects. Each names an implementation that is
present and correct in source; what is missing is the runtime proof this contract requires before a
scenario counts as compliant.

**C1 — `gsc-insight-views`: "Comparison Entry Point Requires Two Snapshots To Exist First" — both
scenarios UNTESTED.**
`GscInsightsContainer.tsx:296-372` implements the requirement, and slightly better than the spec demands:
`needsOnboarding` (true only once a snapshot list has been fetched and holds fewer than two entries)
replaces the Compare button entirely rather than merely disabling it, and it renders distinct copy for
the zero-snapshot and the one-snapshot cases. But **no test anywhere references
`data-testid="snapshot-onboarding"`**, so neither "A site with no snapshots shows a capture-first
onboarding state" nor "A site with exactly one snapshot still shows the capture-more state" has runtime
evidence.

Mitigating context, which is why this is a coverage CRITICAL rather than a behavioral one: the
byte-equivalent logic in `HistoryContainer.tsx:305` **is** runtime-tested via `gsc-history-onboarding`,
including its negative case. Remediation: two assertions in `GscInsightsContainer.test.tsx` — stub
`list_search_console_snapshots` with zero and then one snapshot, and assert the onboarding element plus
the absence of the Compare button.

**C2 — `gsc-insight-views`: "An explicit snapshot pair overrides the two-most-recent default" — UNTESTED.**
No test selects an explicit base and current snapshot through `SnapshotListPanel` and asserts both ids
reach the compare request. The wiring exists — `onSelectBase` and `onSelectCurrent` feed container state,
and the Compare button's label switches from "two most recent snapshots" to a named pair once both are
set — so the path is real, but the scenario's THEN ("MUST send both IDs explicitly and MUST NOT silently
substitute the two-most-recent default") is unproven. Remediation: one assertion in the same file.

### WARNING

**W1 — Dead decoy assertion in the threat-row-(g) integration test.**
`bff/test/integration/authenticated-domain-report.test.ts:23` declares its decoy as
`"Bearer decoy-token-xyz"`, but the stub worker injects `DECOY_REFRESH_TOKEN_xyz789`
(`stub-mcp-worker.js:434, 500`). The string "Bearer decoy-token-xyz" exists nowhere outside the two
`domain-report` test files, so that test's `not.toContain(DECOY_CREDENTIAL)` assertion **can never
fail** — it would pass even if the entire raw `gscError` leaked into the body.

Why this is a WARNING and not a CRITICAL: the same test's `not.toContain("invalid_grant")` **is** a real
substring of the injected message and does carry the proof, alongside the `gscError` undefined check and
the `enrichmentError` equality. The sibling `authenticated-search-console.test.ts:27` uses the correct
constant. So the leak is genuinely detected — one of two redundant detectors is simply inert. Fix: change
line 23 to `DECOY_REFRESH_TOKEN_xyz789`, or import the constant from a shared fixture, and re-run.

**W2 — `seo-intelligence-view/spec.md` has drifted stale: three shipped mechanisms are absent from it.**
The file contains **zero** occurrences of `250`, `criteria`, `effective`, or `enrichmentError`. Missing
relative to what actually shipped:

1. The **BFF-echoed effective-criteria resolver** (`basis: "request"`, tasks 10.1 and 10.2,
   `bff/src/authenticated/criteria.ts`, `EffectiveCriteriaPanel`) — the second mechanism the fourth
   reconciliation pass identified as necessary precisely _because_ these five tools echo no `criteria`
   field of their own.
2. The **unconditional "derived from at most 250 Search Console rows" caveat** (task 10.3) — which must
   be stated unconditionally exactly because no output field records the hardcoded `rowLimit: maxGscRows`
   pull, so it can never be inferred from a response.
3. The **`gscError` classify-and-discard** contract. The spec's "GSC Enrichment Has Three Distinct
   States" requirement still frames state (c) as "`gscError` is present and `search` is absent" — true of
   the **tool** result, but the **view** never sees `gscError`; the BFF strips it and substitutes
   `enrichmentError: { code }`. The requirement gestures at this by reference ("MUST route that failure
   through the failure-classification requirements `authenticated-source-contract` defines"), which is
   why this is a WARNING rather than a flat contradiction — but a reader of the merged capability spec
   would not learn that the raw field is stripped, which is the entire security property.

All three live in `design.md` (the "effective request criteria are echoed by the BFF" and
"`analyze_domain`'s `gscError` is classified like a failure" decisions, lines 216-261) and in `tasks.md`
(10.1-10.3, 10.9-10.10) — but `openspec archive` merges the **spec** deltas into `openspec/specs/`, not
the design. Recommend three added requirements before archive.

**W3 — Dangling forward reference in `gsc-insight-views/spec.md`.**
Line 32 reads "see the 'Snapshot Retention Is Unbounded, Not a Rolling Window' requirement **below**", but
that requirement is not in this file — it lives in `history-comparison-view/spec.md:74`. After archive the
two become separate capability specs, so the cross-reference will point nowhere. Should read "see
`history-comparison-view`'s ... requirement".

_(The working draft's W4 and W5 were promoted to CRITICAL C1 and C2 above.)_

**W6 — The change's most security-critical structural guarantee has no spec requirement.**
The allowlist property — no `business_*` write tool is reachable through the BFF, by construction — is
implemented, structurally enforced by the type system, and covered by 23 unit tests plus an integration
404 test, but `authenticated-source-contract/spec.md` contains **no requirement** stating it. Its Purpose
paragraph says "These requirements are read-only: no requirement in this file describes or permits a write
path to the MCP", which is a scoping note, not a testable MUST. `design.md`'s threat matrix row (f) and
`state.yaml`'s SCOPE DECISION carry the property; the spec does not. After archive, the permanent
capability spec would omit exactly the property a future contributor most needs to not break — and the
three live public write tools (`business_reply_review`, `business_update_info`, `business_create_post`)
are still one registry row away. Recommend an explicit "The Authenticated Registry Is an Explicit
Allowlist" requirement with a scenario asserting no write tool is reachable by omission.

**W7 — Stale factual premise in `authenticated-source-contract/spec.md`'s provisional-view scenarios.**
Line 198: "GIVEN a view is specified for `find_striking_distance_keywords`, **which does not yet exist as a
registered MCP tool**". It exists, is registered, publishes an `outputSchema` (PR5), and has a live
registry row and BFF route (PR6). The requirement itself remains valid and useful; only the illustrative
premise is now false. Should be reworded as an explicit hypothetical, or re-pointed at something that
genuinely does not exist yet — for instance a link-graph-aware recommendation tool, per
`seo-intelligence-view`'s still-open PROVISIONAL requirement.

**W8 — `keyword-research-view` scenario title overstates its own body, and the implementation follows the
body.** The scenario is titled "Submission is blocked until a currency label is configured", but its
GIVEN/WHEN/THEN says only "WHEN the view would otherwise render a bid value THEN it MUST show an explicit
configuration-needed state". The implementation satisfies the body — `KeywordMetricsTable` renders the
alert plus a per-cell "Currency not configured" — and does **not** block submission. That is defensible
(the non-bid columns remain useful, and the metrics call is not wasted), but the title is misleading and
will read as an unmet requirement to anyone scanning the archived capability spec. Retitle to match the
body, or amend the body if blocking was actually intended.

**W9 — Stale source citations across the spec files.** Spot-checked and confirmed drifted:
`search-console-view/spec.md:15` cites `src/server.ts:126-153` for the `search_console_query`
registration, but PR1's task 1.5 already relocated it to `:215-256`; `history-comparison-view/spec.md:64`
cites `test/integration/scheduled.test.ts`, whereas the real path is `test/scheduled.test.ts` (confirmed
in the suite output, which reports it under the `unit` project). Every _substantive_ claim sampled around
these citations still holds — only the coordinates moved. Low risk on its own, but these specs make a
point of citing sources line-by-line, and a wrong coordinate quietly undermines that practice.

**W10 — Two `seo-intelligence-view` drill-down surfaces are implemented but untested.**
`PageKeywordsPanel.tsx:20` and `ContentGapsPanel.tsx:31` each render a `DrillDownLink`, satisfying task
10.11 in source, but neither organism has a test file. The scenario "A page-referencing finding opens the
page report" names four sources — content gaps, keyword-to-page mappings, cannibalization group pages, and
non-null-`page` opportunities — and only the latter two are runtime-proven.

### SUGGESTION

**S1** — `registry.test.ts` proves `cluster_keywords`'s absence explicitly but proves
`snapshot_crawl` / `list_crawl_snapshots` / `compare_crawls`'s absence only implicitly, via the
`toHaveLength(13)` total. Naming them alongside `cluster_keywords` would make PR11's deliberate exclusion
self-documenting in the test rather than only in a doc comment.

**S2** — `SeoIntelligenceContainer.tsx` renders `EffectiveCriteriaPanel` behind a truthiness guard on
`criteria`, so the "unconditional" 250-row caveat is structurally conditional. It is unconditional in
practice because all five registry rows carry an `effectiveCriteria` resolver (asserted in
`registry.test.ts:178`), but the guarantee is distributed across two modules rather than being local to
the component that promises it.

**S3** — Follow-ups F1 through F7 sit as unchecked `[ ]` boxes in `tasks.md`. Their section heading makes
the intent unambiguous to a human reader, but a mechanical archive check that counts unchecked boxes will
flag seven. Consider a distinct marker or a separate `follow-ups.md`.

**S4** — `SeoIntelligenceContainer.tsx` is the largest container in the codebase (24.6 KB) and the only new
view whose container has an a11y test but no behavioral container test; its behavior is proven at the
organism layer instead. That is a legitimate structure, but it means no test exercises tab switching,
shared-selector persistence, or per-tab error routing for this view end to end.

**S5** — No coverage tooling is configured (no `coverage` script, no `@vitest/coverage-*` dependency), so
per-changed-file line and branch coverage could not be reported. Not a failure — simply unavailable.

---

## Verdict

**FAIL — not archive-ready, but not broken either.**

What is green: all 89 in-scope tasks complete; 1318/1318 tests, `pnpm typecheck` and
`pnpm run format:check` all clean on fresh execution in this session; all five independently-requested
security and honesty properties re-derived from source and re-executed at runtime, every one holding;
zero tautologies, zero ghost loops, zero smoke-only tests across 43 new test files. The apply-phase
self-report proved accurate on every claim checked, including the exact 1318 test count.

What blocks archive: three required spec scenarios in `gsc-insight-views` have no passing covering test
(C1, C2). The implementations behind them are present and correct in source — this is a coverage gap, not
a defect — but this contract treats an untested required scenario as CRITICAL, and incomplete scenario
evidence cannot carry a passing verdict.

**Recommended next step: `sdd-apply` for one small follow-up PR**, in this order:

1. **C1, C2** (blocking) — roughly three assertions in `GscInsightsContainer.test.tsx`. No production
   code needs to change.
2. **W2, W6** (highest non-blocking value) — the two spec gaps that would otherwise become _permanent_
   capability text at archive: three missing `seo-intelligence-view` requirements, and the entirely
   unspecified allowlist guarantee.
3. **W1** — a one-line fix to a dead security assertion.
4. **W3, W7, W8, W9** — cheap spec corrections (dangling reference, stale premise, misleading scenario
   title, drifted line citations).
5. **W10, S1-S5** — optional polish.

After that follow-up, re-running this verification should yield 36/36 requirements, 86/86 scenarios, and
a clean pass.
