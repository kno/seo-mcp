# Tasks: Dashboard Views

## Blocking Precondition

**RESOLVED** — `dashboard-bff-foundations` is applied and archived
(`openspec/changes/archive/2026-08-12-dashboard-bff-foundations/`). Its published result types,
`POST /api/tools/{tool}` route, `bff/src/gate.ts`, the `BffErrorCode` union, `cacheStatus`/`resultAge`,
and `bff/src/usage.ts`/`GET /api/usage` all exist and are verified. Phase 1 may start.

- [x] 0.1 Verified: `bff/src/errors.ts`, `bff/src/gate.ts`, `src/types/index.ts`, and `bff/src/usage.ts` all exist on disk.

## Review Workload Forecast

| Field                   | Value                                     |
| ----------------------- | ----------------------------------------- |
| Estimated changed lines | 3500-5000 (new SPA + 6 slices + new deps) |
| 400-line budget risk    | High                                      |
| Chained PRs recommended | Yes                                       |
| Suggested split         | PR1→PR2→PR3→PR4→PR5→PR6→PR7               |
| Delivery strategy       | ask-on-risk                               |
| Chain strategy          | stacked-to-main (confirmed by user)       |

Decision needed before apply: No — chain strategy confirmed.
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal                                                                                         | PR  | Focused test command                        | Runtime harness                                    | Rollback boundary                                 |
| ---- | -------------------------------------------------------------------------------------------- | --- | ------------------------------------------- | -------------------------------------------------- | ------------------------------------------------- |
| 1    | Build/typecheck/test wiring, `assets` binding, gate-ordering RED test                        | PR1 | `pnpm test -- vitest.integration.config.ts` | Miniflare integration, unauthenticated asset fetch | Remove `assets` binding, revert wrangler.jsonc    |
| 2    | Shell: nav, `StateRegion`, `errors.ts`, `bounds.ts`, atoms, a11y/no-polling structural tests | PR2 | `pnpm test -- --project ui`                 | jsdom axe-core                                     | Revert `app/`,`data/`,`atoms/`                    |
| 3    | `page-report-view`                                                                           | PR3 | `pnpm test -- PageReport`                   | jsdom                                              | Disable route, revert `organisms/OnPageCard` etc. |
| 4    | `broken-links-view`                                                                          | PR4 | `pnpm test -- BrokenLinks`                  | jsdom                                              | Revert panel, shell shows disabled-view           |
| 5    | `site-crawl-view` + `BarChart`                                                               | PR5 | `pnpm test -- SiteCrawl`                    | jsdom + Miniflare (progress seam)                  | Revert route/organisms                            |
| 6    | `pagespeed-view` + `ScoreGauge` + secret handling                                            | PR6 | `pnpm test -- PageSpeed`                    | jsdom secrets suite                                | Revert route/organisms                            |
| 7    | `result-export` + `quota-visibility` + `GET /api/usage`                                      | PR7 | `pnpm test -- export usage`                 | jsdom + Miniflare (`/api/usage` gate)              | Revert `export/`, `bff/src/usage.ts`              |

## Phase 1: Build Wiring (PR1)

- [x] 1.1 RED: Integration test asserting unauthenticated `GET /`, `/index.html`, hashed asset, favicon, unknown deep link return `gate_unauthorized` before `assets` exists.
- [x] 1.2 Create `bff/ui/{index.html,vite.config.ts,tsconfig.json}` (DOM lib, excluded from root tsconfig).
- [x] 1.3 Add `assets` binding (`run_worker_first: true`) to `bff/wrangler.jsonc`; regenerate `Env` via `pnpm types:bff`.
- [x] 1.4 GREEN: wire `env.ASSETS.fetch` after gate in `bff/src/router.ts`; test 1.1 passes authenticated, fails unauthenticated per spec.
- [x] 1.5 Add `vitest.ui.config.ts` (jsdom) to `vitest.config.ts` projects; add `build:ui`/`dev:ui` scripts; update `.gitignore`/`.prettierignore`.

## Phase 2: Shell (PR2)

- [x] 2.1 RED per `dashboard-shell` scenarios: unmapped-code state, retryAfter countdown, loading/empty/bound distinction, keyboard/focus, no-polling structural test.
- [x] 2.2 GREEN: `data/errors.ts` (`ERROR_PRESENTATION` + `presentFor`), `data/bounds.ts` types, `data/client.ts` (`UserIntent`, `requestTool`), `StateRegion`, atoms.
- [x] 2.3 Structural test: no `visibilitychange`/`focus`/`setInterval`/`useEffect→requestTool` under `bff/ui/src`.
- [x] 2.4 Manual check (documented, not automated): 360px/1440px layout, per design's jsdom-layout limitation.

## Phase 3: Page Report (PR3)

- [ ] 3.1 RED per `page-report-view` scenarios (absence, headings, OG/JSON-LD, all 13 issue codes + unknown, failure-not-empty).
- [ ] 3.2 GREEN: `OnPageCard`, `HeadingsPanel`, `OpenGraphPanel`, `JsonLdPanel`, `IssuesList`, `PageReportContainer`.

## Phase 4: Broken Links (PR4)

- [ ] 4.1 RED: no fetch on page-report load; exactly one fetch on explicit action; all 4 counts visible; broken-vs-error distinct; probe-cap-at-50 badge; platform failure ≠ empty success.
- [ ] 4.2 GREEN: `BrokenLinksPanel`, `ProbeRow`, `BrokenLinksContainer` (button-only trigger, no auto-effect).

## Phase 5: Site Crawl (PR5)

- [ ] 5.1 RED: defaults 5/2; out-of-range blocked; max-value warned confirm; per-panel sample labeling incl. `outputBytes` bound; drill-down reuses in-memory page data (no new `crawl_page` call); duplicate-submit blocked in flight.
- [ ] 5.2 GREEN: `CrawlForm`, `DomainSummaryPanel`, `CrawlPolicyPanel`, `LinkGraphPanel`, `BarChart`, `PerPageTable`, `SiteCrawlContainer`, `readToolResponse` seam.

## Phase 6: PageSpeed (PR6)

- [ ] 6.1 RED: mobile default; missing score/metric/field-data shows unavailable not 0; opportunity with no savings still listed; secrets suite (storage/URL/echo/export/cache-key).
- [ ] 6.2 GREEN: `PageSpeedForm` (uncontrolled input), `ScorePanel`, `LabMetricsPanel`, `FieldDataPanel`, `OpportunitiesTable`, `ScoreGauge`, `data/secret.ts`, `PageSpeedContainer`.

## Phase 7: Export & Quota (PR7)

**Correction (this file predates `dashboard-bff-foundations` PR5):** `bff/src/usage.ts` and the
`GET /api/usage` route already exist and are archived/verified — do NOT recreate them. This phase
builds only the UI layer consuming the existing route.

- [ ] 7.1 RED: JSON fidelity + freshness; CSV golden/stability/`columns ∪ omitted` coverage; truncation/sample markers present only when bounded; no secret in either export; a jsdom test asserting the UI calls the existing `GET /api/usage` route and renders its `estimate`/`note` fields without claiming an authoritative count.
- [ ] 7.2 GREEN: `export/json.ts`, `export/csv.ts` + `CSV_SHAPES`, `ExportMenu`, `HeadroomIndicator`, `FreshnessBadge`, `UsageContainer` (consumes the existing `bff/src/usage.ts` backend, no new backend file).
