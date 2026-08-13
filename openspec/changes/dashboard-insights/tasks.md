# Tasks: Dashboard Insights (authenticated and analytical views)

Reconciled through the **fourth** pass; all decisions closed. Covers all six capabilities. The six
`business_*` Google Business Profile tools are **out of scope by explicit user decision** and appear in no
task, route, registry row or navigation entry below — a future SDD change owns them.

## Review Workload Forecast

| Field                   | Value                                    |
| ----------------------- | ---------------------------------------- |
| Estimated changed lines | ~3,200-4,000 total; ~250-400 per PR      |
| Review budget           | 800 lines/PR (`openspec/config.yaml`)    |
| 400-line budget risk    | High                                     |
| Chained PRs recommended | Yes                                      |
| Suggested split         | PR1 → … → PR11, stacked, merged in order |
| Delivery strategy       | ask-on-risk                              |
| Chain strategy          | stacked-to-main                          |
| Test command            | `pnpm test`                              |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

**Why 11 PRs, not 5.** Only 5 of 28 registered tools declare an `outputSchema`; the typed registry gate means
every view needs its family's schemas first (18 tools, 7 new schema modules). Schema slices and view slices
are separately revertable and separately reviewable, so each family ships as a pair.

### Suggested Work Units

| Unit | Goal                                  | PR   | Focused test command                       | Runtime harness                        | Rollback boundary                                  |
| ---- | ------------------------------------- | ---- | ------------------------------------------ | -------------------------------------- | -------------------------------------------------- |
| 1    | GSC output schema + published type    | PR1  | `pnpm test -- search-console`              | `test/integration/` MCP round-trip     | Drop `outputSchema`; additive, hosts unaffected    |
| 2    | Authenticated route class (allowlist) | PR2  | `pnpm test -- authenticated classify`      | `bff/test/integration/` stub MCP       | Remove `bff/src/authenticated/*`; no route exposed |
| 3    | Quota ledger + delayed cache class    | PR3  | `pnpm test -- quota-ledger cache`          | `bff/test/integration/` KV             | Drop files; PR2 degrades to `unavailable` estimate |
| 4    | `search-console-view` UI              | PR4  | `pnpm test -- search-console-view`         | `bff/test/integration/` full route     | Shell disabled-view state                          |
| 5    | Opportunity + GSC-snapshot schemas    | PR5  | `pnpm test -- opportunities gsc-snapshots` | `test/integration/` MCP round-trip     | Drop schema modules + `outputSchema` fields        |
| 6    | `gsc-insight-views` UI (all 5 tools)  | PR6  | `pnpm test -- gsc-insights`                | `bff/test/integration/` stub MCP       | Shell disabled-view state                          |
| 7    | Keyword schemas (3 tools)             | PR7  | `pnpm test -- keywords`                    | `test/integration/` MCP round-trip     | Drop schema module + `outputSchema` fields         |
| 8    | `keyword-research-view` UI            | PR8  | `pnpm test -- keyword-research`            | `bff/test/integration/` stub MCP + Ads | Shell disabled-view state                          |
| 9    | Intelligence + domain-report schemas  | PR9  | `pnpm test -- intelligence domain-report`  | `test/integration/` MCP round-trip     | Drop schema modules + `outputSchema` fields        |
| 10   | `seo-intelligence-view` UI            | PR10 | `pnpm test -- seo-intelligence`            | `bff/test/integration/` stub MCP       | Shell disabled-view state                          |
| 11   | Crawl-snapshot schemas + history view | PR11 | `pnpm test -- crawl-snapshots history`     | `bff/test/integration/` stub MCP + D1  | Shell disabled-view state per sub-family           |

Each PR is RED → GREEN → PROOF. RED = failing behavior test first. GREEN = smallest implementation.
PROOF = `pnpm test` green plus the unit's focused command and runtime harness.

## Phase 1: GSC output schema (PR1) — `search-console-view`, `mcp-result-contract`

- [x] 1.1 RED `test/schemas/search-console.test.ts`: accepts a real fixture; rejects a 251-row payload;
      rejects an unknown dimension; `rowCount` has no max
- [x] 1.2 GREEN `src/schemas/search-console.ts`: `gscDimensionSchema`, `gscRowSchema`,
      `gscQueryResultSchema` (object root, `rows.max(LIMITS.maxGscRows)`)
- [x] 1.3 GREEN `src/google/search-console.ts`: `GscRow`/`GscQueryResult` become `z.infer` aliases in place;
      logic byte-unchanged
- [x] 1.4 GREEN `src/types/index.ts`, `src/types/schemas.ts`: publish types + schema
- [x] 1.5 GREEN `src/server.ts:215-256`: `outputSchema: gscQueryResultSchema`, `jsonResult(schema, value)`
      form — **higher-risk MCP tool surface**
- [x] 1.6 PROOF `test/integration/`: registration exposes `outputSchema`; `structuredContent` round-trips;
      `pnpm test` green

## Phase 2: Authenticated route class (PR2) — `authenticated-source-contract`

- [ ] 2.1 RED `bff/test/authenticated/containment.test.ts`: no Google credential binding exists anywhere in
      `bff/` (threat row b)
- [ ] 2.2 RED registry allowlist: no `business_*` name is present; a request naming one is rejected before
      any upstream call (threat row f)
- [ ] 2.3 RED freshness: `asOf = min(endDate, today − GSC_REPORTING_LAG_DAYS)`, `lagDays`,
      `basis: "assumed"`; default range = last 28 days
- [ ] 2.4 GREEN `bff/src/authenticated/freshness.ts`: `SourceFreshness`, `AuthenticatedOk<T>` with
      **required** `sourceFreshness`
- [ ] 2.5 RED classifier: exact `"Google credentials are not configured"`; OAuth `invalid_grant`/
      `invalid_client`/`unauthorized_client`; `quota`/`rateLimitExceeded`/`userRateLimitExceeded`;
      unmatched → non-retryable (threat row d)
- [ ] 2.6 GREEN `bff/src/authenticated/classify.ts`: 4-class classifier that **discards** upstream text
- [ ] 2.7 GREEN `bff/src/errors.ts`: `upstream_source_not_configured` (503),
      `upstream_credential_failure` (502, no retry), `upstream_source_quota` (429, no `retryAfter`)
- [ ] 2.8 RED integration: unauthenticated request to every authenticated route reaches neither Google nor
      the ledger (threat row a); stub-env decoy credentials absent from body/header/cache/export/log
- [ ] 2.9 GREEN `bff/src/authenticated/registry.ts` (typed from the published schema map) +
      `bff/src/router.ts`: wire `search_console_query`, timeout `27_000`
- [ ] 2.10 PROOF `pnpm test -- authenticated classify` and full `pnpm test` green

## Phase 3: Quota ledger + delayed cache class (PR3) — `authenticated-source-contract`, `quota-visibility`

- [ ] 3.1 RED ledger: increments on upstream **attempt**, never on success-only, never on a cache hit, never
      on a gate rejection or invalid input
- [ ] 3.2 RED KV absent/throwing serves a live result with an `unavailable` estimate, not a closed failure
      (threat row e)
- [ ] 3.3 GREEN `bff/src/authenticated/quota-ledger.ts`: `q1:{source}:{windowStart}` counter via
      `ctx.waitUntil`, `basis: "bff-observed"`, wording "at least N calls used in this window"
- [ ] 3.4 RED cache TTL by range-state: `closed` → hours (clamp ceiling), `open` → short, zero-row result
      cached at `open`, `?refresh=1` bypass, no timer/focus revalidation
- [ ] 3.5 GREEN `bff/src/cache.ts` + `bff/wrangler.jsonc`: `authenticated-delayed` class,
      `AUTH_SOURCE_TTL_SECONDS`, `AUTH_SOURCE_BUDGET`, `GSC_REPORTING_LAG_DAYS`
- [ ] 3.6 PROOF `pnpm test -- quota-ledger cache`; `wrangler types` regenerated after the binding change

## Phase 4: `search-console-view` UI (PR4) — `search-console-view`

- [ ] 4.1 RED controls match the real input schema exactly: free-text `siteUrl`, `YYYY-MM-DD` dates,
      dimension multi-select over the six enum values, `rowLimit` 1-250; default range last 28 days
- [ ] 4.2 RED table renders `keys`, `clicks`, `impressions`, `ctr`, `position` for the selected dimensions
- [ ] 4.3 RED bound badge at `rowCount === 250` naming `maxGscRows`; `0` renders the empty state;
      `1..249` renders neither
- [ ] 4.4 RED two staleness elements with distinct accessible names and **no element containing both**
      figures; `basis` rendered as estimated vs. reported
- [ ] 4.5 RED four distinct states: empty, not-configured, credential-failure (no retry affordance),
      quota (disabled resubmit, unknown duration)
- [ ] 4.6 RED no timer, interval, focus or visibility handler issues a request
- [ ] 4.7 RED export carries as-of date + bound provenance and no credential literal
- [ ] 4.8 GREEN `bff/ui/search-console/*`: controls, table, bound badge, freshness display, export
- [ ] 4.9 PROOF automated a11y check passes; keyboard-only navigation reaches every control; `pnpm test`

## Phase 5: Opportunity + GSC-snapshot schemas (PR5) — `gsc-insight-views`, `mcp-result-contract`

- [ ] 5.1 RED `test/schemas/opportunities.test.ts`: `OpportunityResult` incl. `criteria:
Record<string, number>`; rejects a payload exceeding `limit`
- [ ] 5.2 GREEN `src/schemas/opportunities.ts` + `z.infer` aliases in `src/google/opportunities.ts`
- [ ] 5.3 RED `test/schemas/gsc-snapshots.test.ts`: `StoredSnapshot`, `GscDiff` four buckets,
      `GscDiffRow` with nullable `base`/`current`, `GscMetrics`
- [ ] 5.4 GREEN `src/schemas/gsc-snapshots.ts` + aliases in `src/db/gsc-store.ts`, `src/seo/gsc-diff.ts`
- [ ] 5.5 GREEN `src/server.ts`: `outputSchema` on `find_striking_distance_keywords`,
      `find_low_ctr_opportunities`, `snapshot_search_console`, `list_search_console_snapshots`,
      `compare_search_console` — **higher-risk MCP tool surface**, additive only
- [ ] 5.6 GREEN publish all five types/schemas from `src/types/*`
- [ ] 5.7 PROOF `test/integration/`: all five registrations expose `outputSchema` and round-trip

## Phase 6: `gsc-insight-views` UI (PR6) — `gsc-insight-views`

- [ ] 6.1 RED shared property + date-range selector persists across tool switch; blocks submit on empty
      property
- [ ] 6.2 RED applied `criteria` (including server defaults the tool echoes) rendered alongside every result
- [ ] 6.3 RED bound label at `rowCount === criteria.limit`; never claims exhaustiveness; a zero-row result is
      distinct from an unfetched one
- [ ] 6.4 RED comparison names both endpoints explicitly (base and current snapshot id, label, date range)
- [ ] 6.5 RED each of the four decay buckets (`decayed`, `improved`, `lost`, `gained`) is rendered with an
      unambiguous direction; `base: null` and `current: null` rows are labelled as new/lost, not as zero
- [ ] 6.6 RED each bucket independently labels its own bound at `length === LIMITS.maxDiffRows`
- [ ] 6.7 RED fewer-than-two-snapshots is a distinct actionable state (the tool errors, "Need at least two
      snapshots to compare"); D1-not-configured is a distinct state, not an empty diff
- [ ] 6.8 RED reporting lag renders for every GSC-backed tool in the view, including the comparison's
      baseline period
- [ ] 6.9 GREEN registry rows for the five tools + `bff/ui/gsc-insights/*` reusing the Phase 4 freshness and
      bound components
- [ ] 6.10 PROOF a11y + keyboard pass; `pnpm test -- gsc-insights`

## Phase 7: Keyword schemas (PR7) — `keyword-research-view`, `mcp-result-contract`

- [ ] 7.1 RED `test/schemas/keywords.test.ts`: `{ customerId, count, keywords: KeywordMetric[] }` for both
      Ads tools; `KeywordMetric` bids are bare numbers with **no** currency field
- [ ] 7.2 RED `ClusterResult`: `count`, `intents`, `clusters[{ label, keywords }]`,
      `keywords[{ keyword, intent, tokens }]`
- [ ] 7.3 GREEN `src/schemas/keywords.ts` + `z.infer` aliases in `src/google/ads.ts`, `src/seo/keywords.ts`
- [ ] 7.4 GREEN `src/server.ts`: `outputSchema` on `get_keyword_metrics`, `discover_keywords`,
      `cluster_keywords`; publish types
- [ ] 7.5 PROOF `test/integration/` round-trip for all three registrations

## Phase 8: `keyword-research-view` UI (PR8) — `keyword-research-view`

- [ ] 8.1 RED the view renders with `get_keyword_metrics` alone; `discover_keywords` and `cluster_keywords`
      are additive, not prerequisites
- [ ] 8.2 RED no monetary value renders without a currency label; the label comes from operator config, never
      from the tool payload (no currency field exists)
- [ ] 8.3 RED a `0` bid/volume renders with a hedged label — absent and zero are indistinguishable at the
      source (`normalizeMetric`), so the view MUST NOT assert "no data" or "exactly zero"
- [ ] 8.4 RED clusters are inspectable: every `KeywordCluster.keywords` member is listed, no opaque grouping
- [ ] 8.5 RED a second `google-ads` quota indicator, textually distinct from the Search Console one and from
      the MCP bucket; `cluster_keywords` touches neither (no credential, no quota)
- [ ] 8.6 RED missing Ads developer token renders `upstream_source_not_configured`, distinct from empty
- [ ] 8.7 GREEN registry rows (`google-ads` source for two tools, credential-free for clustering) +
      `bff/ui/keyword-research/*`
- [ ] 8.8 PROOF a11y + keyboard pass; `pnpm test -- keyword-research`

## Phase 9: Intelligence + domain-report schemas (PR9) — `seo-intelligence-view`, `mcp-result-contract`

- [ ] 9.1 RED `test/schemas/intelligence.test.ts`: `Opportunity` (`type` enum of three, nullable `page`,
      nullable `currentPosition`, `impact`/`effort`/`priorityScore` unbounded), `CannibalGroup`/`CannibalPage`
- [ ] 9.2 RED `PageKeywords`/`PageQuery` and `ContentGap`; each wrapper is
      `{ siteUrl, startDate, endDate, count, <array> }` with **no `criteria` field** — assert its absence so
      a later tool-side addition is a visible schema change
- [ ] 9.3 GREEN `src/schemas/intelligence.ts` + `z.infer` aliases in `src/seo/intelligence.ts`,
      `src/seo/keyword-pages.ts`
- [ ] 9.4 RED `test/schemas/domain-report.test.ts`: `DomainReport` with `crawl` reusing
      `siteCrawlResultSchema`'s `summary`/`crawlPolicy`/`linkGraph`; `search` and `gscError` both optional and
      **never both present**
- [ ] 9.5 GREEN `src/schemas/domain-report.ts` + alias in `src/seo/domain-report.ts`
- [ ] 9.6 GREEN `src/server.ts`: `outputSchema` on `find_keyword_cannibalization` (348-373),
      `find_seo_opportunities` (375-399), `map_keywords_to_pages` (401-426), `find_content_gaps` (428-461),
      `analyze_domain` (774-829); publish types
- [ ] 9.7 PROOF `test/integration/` round-trip for all five registrations

## Phase 10: `seo-intelligence-view` UI (PR10) — `seo-intelligence-view`

- [ ] 10.1 RED BFF echoes **effective** request criteria (omitted inputs resolved against the documented
      default table: limit 10/50/100/100, `minPosition` 21, `minImpressions` 10, `topQueriesPerPage` 10) with
      `basis: "request"`, textually distinct from a tool-reported `criteria`
- [ ] 10.2 RED bound label at `count === effectiveLimit` for a request that **omitted** the limit; no label
      below it (threat row h)
- [ ] 10.3 RED the "derived from at most 250 Search Console rows" caveat renders unconditionally for all
      five tools — never inferred from a field, because none exists
- [ ] 10.4 RED every opportunity renders `type` **and** `recommendation`; different `type` values are visibly
      distinct; no "unexplained recommendation" fallback exists
- [ ] 10.5 RED `impact`, `effort` and `priorityScore` all render together, including when sorted by
      `priorityScore`; `effort` is not presented as fine-grained or on an invented 0-100 scale
- [ ] 10.6 RED every `CannibalGroup.pages` entry renders URL + clicks + impressions + position; when
      `pages.length < pageCount` the subset is labelled as bounded
- [ ] 10.7 RED the generic `striking_distance` "internal links" string is **not** presented as link-graph
      aware; no relationship to `linkGraph`/`orphanPages`/`topLinkedPages` is fabricated
- [ ] 10.8 RED `analyze_domain`'s three enrichment states render distinctly: not requested / `search`
      present / classified enrichment failure — (a) never renders like (c)
- [ ] 10.9 RED nested `gscError` is classified and its raw text discarded: a decoy credential in the
      enrichment failure message appears in no response body, cache value, export or log line, and the
      envelope carries a code instead of the original string (threat row g)
- [ ] 10.10 GREEN `bff/src/authenticated/criteria.ts` (effective-criteria resolver) + `gscError`
      classification in the `analyze_domain` route; enrichment-failed reports cached at the `open` TTL
- [ ] 10.11 RED/GREEN drill-down: page-referencing findings open `page-report-view`; `analyze_domain`'s
      `crawl` opens `site-crawl-view`; a `cannibalization` opportunity (`page: null`) offers **no** page
      drill-down
- [ ] 10.12 GREEN `bff/ui/seo-intelligence/*` reusing Phase 4 freshness and bound components
- [ ] 10.13 PROOF a11y + keyboard pass; `pnpm test -- seo-intelligence`

## Phase 11: Crawl-snapshot schemas + `history-comparison-view` (PR11) — `history-comparison-view`

- [ ] 11.1 RED `test/schemas/crawl-snapshots.test.ts`: `StoredCrawlSnapshot`, `CrawlDiff`
      (`newPages`, `removedPages`, `newIssues`, `resolvedIssues`, `issueCountDeltas`),
      `CrawlPageIssueChange`
- [ ] 11.2 GREEN `src/schemas/crawl-snapshots.ts` + aliases in `src/db/crawl-store.ts`,
      `src/seo/crawl-diff.ts`; `outputSchema` on `snapshot_crawl`, `list_crawl_snapshots`, `compare_crawls`;
      publish types
- [ ] 11.3 RED retention is presented as **unbounded and accumulating**; the list `limit` (1-50, default 20)
      is labelled a listing cap, never a retention window; no rolling-90-day claim anywhere
- [ ] 11.4 RED crawl-snapshot capture is presented as **manual only**; the view MUST NOT imply crawl history
      accumulates automatically (only the GSC cron exists, and only when `GSC_SNAPSHOT_PROPERTIES` is set)
- [ ] 11.5 RED a comparison names both endpoints (ids, labels, `capturedAt`); diff direction is unambiguous
      for both families; each list labels its own bound at `LIMITS.maxCrawlDiffRows`
- [ ] 11.6 RED fewer-than-two-snapshots renders a distinct actionable state per family; D1-not-configured is
      distinct from empty history
- [ ] 11.7 RED the two sub-families ship and degrade **independently** — GSC history present with no crawl
      history (and the reverse) both render correctly
- [ ] 11.8 GREEN `bff/ui/history/*` + `bff/ui/src/charts/*`: hand-rolled SVG trend/bar primitives, no
      charting library
- [ ] 11.9 PROOF a11y + keyboard pass; `pnpm test -- crawl-snapshots history`

## Phase 12: Sibling-spec coordination (land with or before the PRs they block)

- [ ] 12.1 Amend `dashboard-shell`'s error-presentation completeness requirement for the three new codes —
      **blocks PR2 and PR4**
- [ ] 12.2 Amend `quota-visibility`'s 429 requirement with the rate-limited-without-known-delay case; no
      fabricated `retryAfter` — **blocks PR3 and PR4**
- [ ] 12.3 Amend `result-export` for as-of date + bound provenance on authenticated exports — **blocks PR4**
- [ ] 12.4 Add navigation entries for the five new views to `dashboard-shell` incrementally, one per view PR

## Recorded follow-ups (verified, deliberately NOT tasked here)

- [ ] F1 `src/db/gsc-store.ts` / `src/db/crawl-store.ts`: no DELETE, expiry or age-based cleanup exists —
      `ROADMAP.md`'s rolling-90-day retention decision is unimplemented. Separate server-side change.
- [ ] F2 No scheduled path exists for `snapshot_crawl` (`src/scheduled.ts` covers GSC only).
- [ ] F3 `src/google/ads.ts`: no currency field anywhere, and `normalizeMetric`'s `Number(v) || 0` collapses
      absent-vs-zero irrecoverably.
- [ ] F4 Server-side error codes to replace BFF text classification (design option (a)/(c) trajectory).
- [ ] F5 Add a real `criteria` echo to the five `src/seo/*` intelligence tools so the BFF resolver can retire.
- [ ] F6 `src/google/auth.ts:3` module-level token cache — safe under one identity, a cross-tenant leak the
      moment a second exists.
- [ ] F7 **A future SDD change for the six `business_*` Google Business Profile tools**, including the
      confirmation/undo design that three live public write tools require. Out of scope here.
