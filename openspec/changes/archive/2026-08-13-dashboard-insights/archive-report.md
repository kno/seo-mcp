# Archive Report — dashboard-insights

## Change: dashboard-insights

**Archived:** 2026-08-13
**Archive location:** `openspec/changes/archive/2026-08-13-dashboard-insights/`
**Status:** COMPLETE

## Summary

The authenticated and analytical half of the dashboard: Google Search Console and Google Ads-backed
views, SEO intelligence, and cross-session history comparison. Six new capabilities, 11 stacked PRs
(`ef27eee`..`771c8cc`) plus one verify-driven follow-up fix (`53eeebb`, `e21b723`), landing on top of
22 of the MCP server's 28 registered tools gaining a published `outputSchema`. The remaining six
(`business_*` Google Business Profile tools — three of them live public writes gated only by a
`confirm: true` input) were explicitly excluded from scope by a real user decision mid-session, and
are structurally unreachable through the BFF: the authenticated registry's `schema` field is typed to
the published schema map, so a tool with no `outputSchema` is a typecheck error if anyone tries to add
it, not a silent omission.

This change required a fourth reconciliation pass mid-session after the orchestrator found the MCP
tool surface had grown to 28 tools since the third pass — five more `src/seo/*` intelligence tools and
the six Business Profile tools, neither wave previously accounted for. The reconciliation folded the
five intelligence tools' real shapes into `seo-intelligence-view`, excluded Business Profile
explicitly, resolved every previously-open product decision (cache TTL, GSC date range,
credential-vs-quota distinction, quota wording, charting mechanism) to its recommended value, and
produced an 11-PR stacked task list covering all six capabilities — the original tasks.md had only
tasked 2 of 6.

## What shipped

1. **`authenticated-source-contract`** (PR1-PR3): the pattern every Google-backed view depends on — an
   explicit allowlist registry (typed from the published schema map), a 4-class failure classifier that
   discards raw upstream text by construction, two distinct staleness axes (`resultAge` vs
   `sourceFreshness`), a BFF-side quota ledger independent of the MCP rate-limit bucket, and an
   `authenticated-delayed` cache class split by reporting-lag range-state.
2. **`search-console-view`** (PR4): `search_console_query`'s full UI — controls, results table, bound
   badge, both staleness axes, four distinct error states, export with as-of/bound provenance.
3. **`gsc-insight-views`** (PR5-PR6): opportunities (`find_striking_distance_keywords`,
   `find_low_ctr_opportunities`), snapshot management, and comparison (`compare_search_console`'s
   four-bucket diff) as one view with three in-view tabs.
4. **`keyword-research-view`** (PR7-PR8): `get_keyword_metrics`/`discover_keywords` (Google Ads, second
   independent quota source) plus credential-free `cluster_keywords` — structurally excluded from the
   authenticated registry and routed through the ordinary `dispatch()` path, verified by construction.
   No currency field exists anywhere upstream; a bid never renders without an operator-configured label,
   and a `0` renders hedged, never as confirmed data or confirmed zero.
5. **`seo-intelligence-view`** (PR9-PR10): five `src/seo/*` tools plus `analyze_domain`. Real security
   fix here (threat row g): `analyze_domain`'s `gscError` rides an otherwise-successful 200-OK
   `DomainReport` rather than an `isError` result — the one authenticated tool in the whole chain where
   upstream text rides a success envelope. `classifyDomainReportGscError` strips it and substitutes
   `enrichmentError: { code }` before caching or returning, verified end-to-end with a decoy-credential
   integration test. Also the first cross-view drill-down in the app (a single pending value consumed
   once by a mount-time `useState` initializer, never an effect — no fetch on arrival).
6. **`history-comparison-view`** (PR11): crawl-snapshot schemas and UI composed alongside PR6's
   already-built GSC snapshot history, each family shipping and degrading independently. States plainly,
   because it's true: no retention enforcement exists anywhere in `src/db/*.ts` (snapshots accumulate
   indefinitely), and crawl-snapshot capture is manual only (the one scheduled cron covers GSC alone).

## Verification

`sdd-verify`'s first pass over the full chain returned **FAIL**: 2 blocking CRITICAL findings (both
missing test coverage over correct, already-shipped implementations — no functional defect) plus 8
WARNING findings concentrated in spec-versus-reality drift (three real mechanisms discovered during
apply — the effective-criteria resolver, the unconditional 250-row caveat, `gscError`
classify-and-discard — plus the security-critical allowlist guarantee itself, had never been written
into the delta specs `openspec archive` merges into the permanent capability text).

A follow-up fix commit closed both CRITICALs (two tests added, mutation-tested by the re-verify pass —
the production conditionals were broken and confirmed the new tests fail), fixed a dead security
assertion, and amended the delta specs with the missing requirements. Re-verification (mutation-tested,
independent of the fix's own self-report) returned **PASS WITH WARNINGS — archive-ready**: 0 CRITICAL,
6 WARNING, 5 SUGGESTION, all non-blocking. One of the fix's own smaller citation corrections was itself
found to be a regression (reverted a correct citation to an incorrect one) — caught by the re-verify
pass and corrected by the orchestrator directly before this archive.

Final state: 1321 tests passing, `pnpm typecheck` and `pnpm run format:check` clean, all 89 in-scope
tasks complete. Full detail in `verify-report.md` in this folder.

## Capabilities

All six are NEW (verified: each delta spec's requirement count matches its corresponding merged
capability spec exactly before this archive proceeded):

- `openspec/specs/authenticated-source-contract/spec.md` — 6 requirements
- `openspec/specs/search-console-view/spec.md` — 7 requirements
- `openspec/specs/gsc-insight-views/spec.md` — 7 requirements
- `openspec/specs/keyword-research-view/spec.md` — 5 requirements
- `openspec/specs/seo-intelligence-view/spec.md` — 8 requirements
- `openspec/specs/history-comparison-view/spec.md` — 6 requirements

Seven capabilities were MODIFIED but applied directly to their already-merged `openspec/specs/` files
during the PR chain itself (this session's established practice for amending an already-archived
capability, rather than a separate archive-time merge step): `mcp-result-contract`, `dashboard-bff`,
`bff-result-cache`, `mcp-error-contract`, `dashboard-shell`, `quota-visibility`, `result-export`. No
further action was needed for these at archive time — confirmed already in place.

## Archive integrity

Moved via `git mv openspec/changes/dashboard-insights openspec/changes/archive/2026-08-13-dashboard-insights`
— git recorded every file as a 100% rename, not a copy. Before the move, each of the six delta spec
files' `### Requirement` count was diffed against its newly-created `openspec/specs/` counterpart and
confirmed identical (6/6, 7/7, 7/7, 5/5, 8/8, 6/6). `state.yaml`'s `phases` were updated to `apply: done`,
`verify: done`, `archive: done` before the move. `verify-report.md` (375 lines) moved byte-for-byte
alongside `proposal.md`/`design.md`/`tasks.md`.

## Dependency status

`dashboard-bff-foundations` (archived `2026-08-12`) and `dashboard-views` (archived `2026-08-13`) both
required and confirmed archived before this change's apply phase began.

## Follow-ups recorded, deliberately not tasked here

- F1: no DELETE/expiry/age-based cleanup exists in `src/db/gsc-store.ts`/`crawl-store.ts` — snapshots
  accumulate indefinitely, contradicting `ROADMAP.md`'s stated 90-day retention decision.
- F2: no scheduled path exists for `snapshot_crawl` (`src/scheduled.ts` covers GSC only).
- F3: `src/google/ads.ts` has no currency field anywhere, and `normalizeMetric`'s `Number(v) || 0`
  collapses absent-vs-zero irrecoverably.
- F4: server-side error codes to eventually replace BFF-side text classification.
- F5: a real `criteria` echo on the five `src/seo/*` intelligence tools, so the BFF's resolver could
  retire.
- F6: `src/google/auth.ts`'s module-level token cache is safe under one identity, a cross-tenant leak
  risk the moment a second identity exists.
- F7: a future SDD change for the six `business_*` Google Business Profile tools, including the
  confirmation/undo design three live public write tools require.

## Recommendation

✅ Archive complete. `dashboard-insights` and its five sibling views are live on `main`. The six
`business_*` tools remain fully unspecified and unreachable through the BFF — F7 is the natural next
SDD change for that surface, whenever the user chooses to take it on.
