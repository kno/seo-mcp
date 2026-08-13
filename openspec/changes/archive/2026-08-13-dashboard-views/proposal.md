# Proposal: Dashboard Views

## Intent

`dashboard-bff-foundations` makes the MCP results safely reachable from a browser (output schemas, published
types, service-binding BFF, KV cache, access gate, normalized error envelope). It deliberately ships **no UI**.
Today the only way to read a `crawl_page`, `crawl_site`, `check_links` or `analyze_pagespeed` result is a raw
JSON blob in an MCP host transcript, so an SEO reviewer cannot see which pages are non-indexable, which are
orphans, or whether a "clean" link report simply hit a probe bound. This change specifies the user-facing views.

## Outcomes

- A reviewer reads any tool result as a scannable report instead of JSON.
- Every panel distinguishes **"nothing found"** from **"bound reached"** (256 KB output cap, ≤50 probes, ≤20 pages).
- Nobody can accidentally drain the shared 60-req/60s bucket by leaving a tab open.
- A stale panel is visibly stale; an upstream failure is visibly a failure, never an empty success.
- Any result leaves the dashboard as JSON or CSV without a copy-paste step.

## Scope

### In Scope

1. App shell: navigation, design-system baseline (atomic design, container/presentational split), accessibility
   and responsive behavior, and the shared loading / error / empty-state contract over `mcp-error-contract`.
2. `crawl_page` report view (on-page card, headings, link counts, Open Graph, JSON-LD, word count, issues).
3. `check_links` panel, on-demand only.
4. `crawl_site` view (bounded controls, domain summary, crawl policy, internal link graph, per-page table).
5. `analyze_pagespeed` view (scores, lab metrics, optional field INP, opportunities).
6. JSON/CSV export of any result.
7. Quota and freshness visibility.

### Out of Scope (non-goals)

| Deferred                 | Specific blocker                                                                                                                                                                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search-console-view`    | `search_console_query` (commit `9e570a3`) needs a Google refresh token; secret handling, per-property authorization and cacheability are unanswered. Its OAuth is **Google's**, not MCP-client OAuth, so it does not gate multi-tenancy. Needs its own change. |
| `history-comparison`     | Server durable storage (D1/KV/R2) unresolved in `ROADMAP.md`; nothing to diff against.                                                                                                                                                                         |
| `multi-tenant-dashboard` | Server OAuth and per-client quotas not shipped; there is exactly one shared credential.                                                                                                                                                                        |

Also out of scope: any write path to the MCP; any crawling logic in the dashboard; any change to
`src/http/*`, `src/security/*`, or the MCP tool surface; fixing `LIMITS.linkCheckSubrequestBudget`
(tracked by `openspec/changes/link-check-subrequest-budget/`).

## Capabilities

### New Capabilities

- `dashboard-shell`: navigation, design-system baseline, accessibility/responsive rules, and the shared
  loading / error / empty / stale state contract every view consumes.
- `page-report-view`: `crawl_page` report — on-page card, headings, internal/external counts, Open Graph,
  JSON-LD (blocks/types/invalid), word count, and issues with severity badges from the real codes.
- `broken-links-view`: `check_links` panel — user-triggered only, `checked`/`ok`/`broken`/`errors` always
  visible, `broken` (4xx/5xx) separated from `error` (unreachable/timeout/invalid URL).
- `site-crawl-view`: `crawl_site` — bounded limit/concurrency controls, domain summary, crawl policy, link
  graph (orphans, most-linked), per-page table with drill-down.
- `pagespeed-view`: `analyze_pagespeed` — URL, strategy, optional never-persisted API key, scores, lab
  metrics, optional field INP, opportunities.
- `result-export`: JSON and CSV export of any rendered result, including bound/truncation provenance.
- `quota-visibility`: shared-bucket headroom, result age and cache status, and `retryAfter` countdown.

Decomposition rationale: `broken-links-view` is separate from `page-report-view` even though the roadmap
nests them, because its "never on page load" rule and its platform-subrequest failure surfacing are
independently verifiable requirements. `result-export` and `quota-visibility` stay out of `dashboard-shell`
because the shell is structural, while these two carry data-serialization and telemetry requirements.

### Modified Capabilities

- `dashboard-bff`: `quota-visibility` needs a read-only usage/headroom source. The Workers rate-limit binding
  reports only success/failure, never a remaining count, so headroom must be derived from BFF-observed call
  accounting. If `dashboard-bff-foundations` has not archived when specs are written, fold this requirement
  into that change instead of writing a delta against an unmerged spec.

## Approach and Tradeoffs

| #   | Decision                                                                                      | Alternatives rejected                                                                                                                                                     | Rationale                                                                                                                                                                                                     |
| --- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **React SPA (Vite) served as static assets by the BFF Worker**                                | Full-stack framework on Workers (duplicates routing and expands the token-holding Worker's runtime surface); separate static host (second origin, cookie/gate complexity) | The BFF already owns routing, the gate and the JSON contract. The UI needs data fetching, not server rendering. Assets MUST be served behind the same gate.                                                   |
| 2   | **Hand-rolled SVG charts**                                                                    | Charting library                                                                                                                                                          | Only two primitives are needed: a horizontal bar chart (most-linked pages) and score gauges. A library is bundle cost for two shapes. Requirements stay mechanism-agnostic — a library remains substitutable. |
| 3   | **No eager loading, no polling, no auto-refresh anywhere**                                    | Refresh-on-focus / interval refresh                                                                                                                                       | Every panel competes for one 60/60s bucket shared with every other MCP consumer. All fetches are explicit user actions; `check_links` is strictly user-triggered.                                             |
| 4   | **UI defaults `crawl_site` to `limit` 5, `concurrency` 2; 20/4 is an explicit warned choice** | Default to the server's own 10/4                                                                                                                                          | Worst case approaches ~40s. The cheap path must be the default path; the expensive one must be chosen knowingly.                                                                                              |
| 5   | **Bound-vs-empty is a first-class display state, not a footnote**                             | Render counts only                                                                                                                                                        | `crawl_site` truncates at 256 KB, `check_links` probes ≤50, samples are capped at 10–25 entries. Reading a capped sample as a complete set is a wrong SEO conclusion, not a cosmetic issue.                   |
| 6   | **Views ship as independent slices behind the shell**                                         | One big UI release                                                                                                                                                        | Each view is separately reviewable and revertable, and the 800-line review budget is respected per slice.                                                                                                     |

## Affected Areas

| Area                                    | Impact    | Description                                                                                                 |
| --------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------- |
| `bff/ui/` (new)                         | New       | React SPA: atoms/molecules/organisms, containers, view routes.                                              |
| `bff/src/index.ts`, `bff/src/router.ts` | Modified  | Asset serving behind the gate; usage/headroom route. **Higher risk: token-holding Worker request surface.** |
| `bff/wrangler.jsonc`                    | Modified  | `assets` binding; regenerate `Env` via `wrangler types -c bff/wrangler.jsonc`.                              |
| `bff/test/`                             | New       | Component and integration tests, including gate-before-assets ordering.                                     |
| `src/**`, root `wrangler.jsonc`         | Unchanged | Any drift here is a scope escalation.                                                                       |

## Risks

| Risk                                                                 | Likelihood | Mitigation                                                                                                            |
| -------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------- |
| A view amplifies requests against the shared bucket                  | High       | Decision 3: no polling, no auto-refresh; cache-first reads; `retryAfter` countdown disables submit.                   |
| ~40s `crawl_site` reads as a hang, user retries and doubles the cost | High       | Determinate progress affordance, submit disabled while in flight, low defaults, explicit warning at 20 pages.         |
| A capped sample is read as the complete finding                      | High       | Decision 5: explicit truncation/bound badges with the applicable limit named.                                         |
| Asset route bypasses the access gate                                 | Med        | Gate ordering test per route, including static assets; RED test before implementation.                                |
| PageSpeed API key leaks into browser storage or a cache key          | Med        | Key is submit-scoped only, never persisted, never logged; foundations already excludes keyed requests from caching.   |
| `check_links` fails as a platform subrequest error                   | Med        | Surface as a normalized upstream error, never as an empty success; the fix belongs to `link-check-subrequest-budget`. |
| Bundle growth on a Worker asset budget                               | Low        | Decision 2; measure bundle size per slice.                                                                            |

## Rollback Plan

- **UI slices**: the SPA and its routes live only in the BFF Worker. `wrangler rollback` (or
  `wrangler versions deploy` to the prior version) on `seo-dashboard-bff` restores the previous UI. `seo-mcp`
  is not touched by this change, so **no rollback here can affect MCP hosts**.
- **Per-view**: each view is a separate slice/commit; reverting one leaves the shell and other views working.
  The shell renders a disabled-view state rather than a broken route.
- **`assets` binding**: remove from `bff/wrangler.jsonc`, rerun `wrangler types`, redeploy. The JSON API keeps
  serving without it.
- **Never rolled back independently**: the access gate. Removing it while assets or routes are live recreates
  the open-proxy state `dashboard-bff-foundations` exists to prevent.

## Dependencies

Must land before any view work starts, all from `dashboard-bff-foundations`:

1. `mcp-result-contract` — published result types and validated `structuredContent` (a view cannot type
   against untyped JSON).
2. `dashboard-bff` — one JSON route per tool.
3. `dashboard-access-gate` — the gate, before any browser-reachable surface exists.
4. `mcp-error-contract` — the eleven-code envelope the shared error state renders.
5. `bff-result-cache` — `cacheStatus` and `resultAge`, which `quota-visibility` displays.

## Open Decisions (need the human)

| Decision                                            | Status                                                                                                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend approach (`DASHBOARD_ROADMAP.md:109`)      | **Recommended closed**: React SPA as BFF-served assets. Needs confirmation.                                                                                   |
| Charting (`:110`)                                   | **Recommended closed**: hand-rolled SVG. Needs confirmation.                                                                                                  |
| Bounded response vs SSE for crawl progress (`:106`) | **Open**, inherited. Determines whether progress is determinate or indeterminate.                                                                             |
| Quota headroom source                               | **Open.** No upstream remaining-count exists; BFF-side accounting is the only option. Needs agreement on the display semantics (approximate, dashboard-only). |
| CSV shape for nested results                        | **Open.** `crawl_site` is nested; one flat per-page sheet vs multiple sheets is a product answer.                                                             |
| Whether truncation badges block export              | **Open.** Recommended: export carries provenance and is never blocked.                                                                                        |

## Success Criteria

- [x] Every view renders from the published result types; no hand-duplicated shape exists in `bff/ui/`.
- [x] No view issues an MCP request without an explicit user action; no timer or focus handler triggers a fetch.
- [x] `check_links` never runs as part of loading the page report.
- [x] Every one of the eleven `BffErrorCode` values renders a distinct, actionable state; none renders as empty.
- [x] `crawl_site` truncation, `check_links` probe bound, and every capped sample display a bound badge naming the limit.
- [x] `crawl_site` controls cannot submit `limit > 20` or `concurrency > 4`; defaults are 5 and 2.
- [x] The issues list covers all thirteen real codes emitted by `detectSeoIssues` with correct `warning`/`info` severity.
- [x] `MCP_AUTH_TOKEN` and any PageSpeed API key appear in no bundle, response, browser storage or log.
- [x] Static assets are unreachable without a valid gate session.
- [x] Every result view exports to JSON and CSV.
- [x] Result age, cache status and `retryAfter` are visible without opening devtools.
- [x] Automated accessibility checks pass on every view; keyboard-only navigation reaches every control.
- [x] `pnpm test` and `pnpm typecheck` pass, including BFF integration tests.
