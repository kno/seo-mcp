# Tasks: Dashboard Insights (authenticated and analytical views)

## Review Workload Forecast

| Field                   | Value                                 |
| ----------------------- | ------------------------------------- |
| Estimated changed lines | ~250-350/PR, 5 PRs                    |
| 400-line budget risk    | Medium                                |
| Chained PRs recommended | Yes                                   |
| Suggested split         | PR1 → PR2 → PR3 → PR4 → PR5 (stacked) |
| Delivery strategy       | ask-on-risk                           |
| Chain strategy          | stacked-to-main                       |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal                         | PR  | Focused test command               | Runtime harness                    | Rollback boundary                              |
| ---- | ---------------------------- | --- | ---------------------------------- | ---------------------------------- | ---------------------------------------------- |
| 1    | GSC output schema            | PR1 | `pnpm test -- search-console`      | `test/integration/` MCP round-trip | Revert `outputSchema`; additive                |
| 2    | Authenticated route class    | PR2 | `pnpm test -- authenticated`       | `bff/test/integration/` stub MCP   | Remove `bff/src/authenticated/*`; no route yet |
| 3    | Quota ledger + cache class   | PR3 | `pnpm test -- quota-ledger cache`  | `bff/test/integration/` KV         | Drop files; PR2 degrades to `unavailable`      |
| 4    | search-console-view UI       | PR4 | `pnpm test -- search-console-view` | `bff/test/integration/` full route | Shell disable-view state                       |
| 5    | gsc-insight-views (grounded) | PR5 | `pnpm test -- opportunities`       | `bff/test/integration/` stub MCP   | Shell disable-view state                       |

## Phase 1: GSC output schema (PR1) — search-console-view

- [ ] 1.1 RED `test/schemas/search-console.test.ts`: accepts real fixture, rejects 251-row, rejects unknown dimension
- [ ] 1.2 GREEN `src/schemas/search-console.ts`: `gscDimensionSchema`, `gscRowSchema`, `gscQueryResultSchema`
- [ ] 1.3 `src/google/search-console.ts`: types become `z.infer` aliases, logic unchanged
- [ ] 1.4 `src/types/index.ts`, `src/types/schemas.ts`: publish types + schema
- [ ] 1.5 `src/server.ts`: add `outputSchema` to `search_console_query` (higher-risk MCP surface)
- [ ] 1.6 RED→GREEN `test/integration/`: registration exposes `outputSchema`, structuredContent round-trips

## Phase 2: Authenticated route class (PR2) — authenticated-source-contract

- [ ] 2.1 RED `bff/test/`: containment sweep — no Google credential binding anywhere in `bff/`
- [ ] 2.2 RED: freshness derivation (`asOf`, `lagDays`, `basis: "assumed"`)
- [ ] 2.3 GREEN `bff/src/authenticated/freshness.ts`: `SourceFreshness`, required `AuthenticatedOk<T>`
- [ ] 2.4 RED: classifier — exact configured-error string, OAuth codes, quota strings, unmatched → non-retryable
- [ ] 2.5 GREEN `bff/src/authenticated/classify.ts`: 4-class classifier, discards upstream text
- [ ] 2.6 `bff/src/errors.ts`: `upstream_source_not_configured` (503), `upstream_credential_failure` (502, no retry), `upstream_source_quota` (429, no `retryAfter`)
- [ ] 2.7 RED integration: stub MCP canned error texts per class; decoy credentials absent from body/header/cache/export/log
- [ ] 2.8 GREEN `bff/src/authenticated/registry.ts` + `bff/src/router.ts`: typed registry from schema map, wire `search_console_query`

## Phase 3: Quota ledger + cache class (PR3) — authenticated-source-contract, quota-visibility

- [ ] 3.1 RED: ledger increments on upstream attempt only, never on cache hit
- [ ] 3.2 GREEN `bff/src/authenticated/quota-ledger.ts`: `q1:{source}:{windowStart}` KV counter, `basis: "bff-observed"`
- [ ] 3.3 RED: TTL by range-state (`closed`/`open`), zero-row cached at `open`
- [ ] 3.4 GREEN `bff/src/cache.ts`, `bff/wrangler.jsonc`: `authenticated-delayed` class, `AUTH_SOURCE_TTL_SECONDS`, timeout `27_000`

## Phase 4: search-console-view UI (PR4) — search-console-view

- [ ] 4.1 RED: two staleness elements, distinct names, none combined
- [ ] 4.2 RED: bound badge at 250; empty/not-configured/credential-failure/quota states distinct; no timer/focus fetch
- [ ] 4.3 GREEN `bff/ui/search-console/*`: controls, table, badge, freshness display

## Phase 5: gsc-insight-views, grounded tools only (PR5) — gsc-insight-views

- [ ] 5.1 RED schema tests + GREEN `src/schemas/opportunities.ts`, `src/server.ts` outputSchema for both tools (higher-risk MCP surface)
- [ ] 5.2 RED: shared property/date-range selector persists across tool switch; blocks empty-property submit
- [ ] 5.3 RED: `criteria` (server defaults) rendered alongside result
- [ ] 5.4 RED: bound-reached at `rowCount === criteria.limit`; never claims exhaustiveness; zero vs unfetched distinct
- [ ] 5.5 GREEN: registry rows for both tools; `bff/ui/gsc-insights/*` reusing Phase 4 freshness display

## Phase 6: Sibling-spec coordination (land with/before dashboard-views)

- [ ] 6.1 Amend `dashboard-shell` error-presentation completeness requirement for the 3 new codes — blocks PR2/PR4
- [ ] 6.2 Amend `quota-visibility` 429 requirement: rate-limited-without-known-delay case, no fabricated `retryAfter` — blocks PR3/PR4

## Phase 7: Blocked — re-run sdd-tasks once reconciled

- [ ] 7.1 Content-decay/period-comparison slice of `gsc-insight-views`: no tool, no schema, no decay shape
- [ ] 7.2 `keyword-research-view`: blocked on `get_keyword_metrics`/`discover_keywords` + Ads developer token
- [ ] 7.3 `seo-intelligence-view`: blocked on `analyze_domain`/`find_seo_opportunities` schemas + provenance field
- [ ] 7.4 `history-comparison-view`: blocked on D1 binding, snapshot schema/writer, MCP history tool with `retention` field
