# Proposal: Dashboard Insights (authenticated and analytical views)

## Intent

`dashboard-bff-foundations` makes MCP results safely reachable from a browser; `dashboard-views` renders the
four crawl/PageSpeed tools. Both deliberately deferred everything authenticated. Meanwhile `ROADMAP.md`
resolved the deployment shape as **single-tenant** (one owner, one Google account, refresh token held as a
Worker secret), which removed the blocker those changes cited: Search Console and Keyword Planner no longer
need an authorization server.

So the gap is now the reverse of what was assumed. `search_console_query` already ships and returns real
Search Analytics rows, but the only way to read them is a JSON blob in an MCP host transcript — the owner
cannot see which queries sit in striking distance or which pages are decaying. And the roadmap's dashboard
principle ("every tool the server registers gets a view, and a new tool's view lands as part of adding it")
has already been broken twice, by `check_links` and then by `search_console_query`. This change closes the
authenticated/analytical half of the panel and puts the contract in place so the next authenticated tool does
not repeat the miss.

## Outcomes

- The owner reads Search Console performance as a scannable report and can act on striking-distance and
  low-CTR opportunities without exporting to a spreadsheet.
- Authenticated results are visibly **not** fresh-on-demand: GSC's own reporting delay is displayed, so a
  two-day-old number is never read as "right now".
- Google-side quota is visible and defended separately from the MCP's shared 60-req/60s bucket.
- No Google credential — refresh token, access token, client secret, Ads developer token — is reachable from
  the browser, a cache key, an export, or a log line.
- When each unbuilt tool ships, its view has a spec waiting that names exactly which parts must be
  reconciled against the real output schema.

## Evidence status — read this before the specs phase

This is the load-bearing honesty constraint of the change.

| Tool                              | Status                                     | What the spec may assert                                                                                                      |
| --------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `search_console_query`            | **SHIPPED, verified**                      | Field-level requirements from the real shape (below)                                                                          |
| `find_striking_distance_keywords` | **SHIPPED, RECONCILED** (commit `a5b4f22`) | Field-level requirements from the real `OpportunityResult` shape (`gsc-insight-views` spec)                                   |
| `find_low_ctr_opportunities`      | **SHIPPED, RECONCILED** (commit `a5b4f22`) | Field-level requirements from the real `OpportunityResult` shape (`gsc-insight-views` spec)                                   |
| content decay / period comparison | UNBUILT                                    | Intent + behavioral invariants only                                                                                           |
| `get_keyword_metrics`             | **SHIPPED, RECONCILED** (commit `1044d82`) | Field-level requirements from the real `KeywordMetric[]` shape (`keyword-research-view` spec)                                 |
| `discover_keywords`               | **SHIPPED, RECONCILED** (commit `1044d82`) | Field-level requirements from the real `KeywordMetric[]` shape (`keyword-research-view` spec)                                 |
| `cluster_keywords`                | **SHIPPED, RECONCILED** (commit `ef5b0d2`) | Field-level requirements from the real `ClusterResult` shape — not in this proposal's original scope, added on reconciliation |
| `analyze_domain`                  | UNBUILT                                    | Intent + behavioral invariants only                                                                                           |
| `find_seo_opportunities`          | UNBUILT                                    | Intent + behavioral invariants only                                                                                           |
| history / snapshots               | UNBUILT, no interface                      | Nothing beyond the blocker; D1 is decided, exposure is not designed                                                           |

**Reconciliation note (added after this proposal was first written):** four tools shipped mid-planning
across two rebases of this session's worktree — `find_striking_distance_keywords`, `find_low_ctr_opportunities`,
`get_keyword_metrics`, `discover_keywords` — plus `cluster_keywords`, which was never in scope at all. All
five are now reconciled in their respective specs. Only content decay, `analyze_domain`, and
`find_seo_opportunities` remain genuinely unbuilt.

Verified shape, read from `src/google/search-console.ts:4-19` and `src/server.ts:125-165`:
`{ siteUrl, startDate, endDate, dimensions: string[], rowCount, rows: [{ keys: string[], clicks,
impressions, ctr, position }] }`. Inputs: `siteUrl`, `startDate`/`endDate` as `YYYY-MM-DD`, optional
`dimensions` from `query|page|country|device|date|searchAppearance`, optional `rowLimit` 1–250. Bounds:
`LIMITS.maxGscRows: 250`, `LIMITS.gscTimeoutMs: 15_000`, `LIMITS.googleTokenTimeoutMs: 10_000`
(`src/config.ts:28-30`). `dimensions` defaults to `["query","page"]` server-side. `rows` is truncated to
`maxGscRows`, so **250 rows means "bound reached", not "that is all the data"** — the same bound-versus-empty
rule `dashboard-views` established, applied to a different limit.

Everything else in the table above is **provisional by construction**. Specs for those views MUST state that
inline and MUST NOT invent field names, units, or score scales. Reconciliation is a first-class requirement of
this change (`authenticated-source-contract`), not a footnote.

## Scope

### In Scope

1. `search_console_query` output schema + published type, extending the `mcp-result-contract` pattern to the
   sixth tool that `dashboard-bff-foundations` skipped.
2. Search Console view over the verified tool, with property/date-range/dimension controls, the 250-row bound
   badge, and the reporting-delay display.
3. Provisional views for the GSC insight tools, keyword research, and SEO intelligence, written against
   roadmap intent plus shape-independent invariants.
4. A cross-cutting contract for authenticated sources: secret containment, delayed-data caching and staleness
   class, Google-side quota accounting, and mandatory schema reconciliation on tool arrival.
5. A blocked-by-design `history-comparison-view` spec that names its blocker precisely and asserts only what
   is knowable now.

### Out of Scope (non-goals, with rationale)

| Deferred                                                                                                      | Rationale                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Implementing any MCP tool.** No new server tool, no Google Ads client, no D1 schema, no history endpoint.   | These are `ROADMAP.md` server items. They are **dependencies of this change, not deliverables of it.** Only item 1 above touches `src/`.                 |
| Google Trends, Bing Webmaster Tools, Google Business Profile, structured-data validation, permitted SERP data | `ROADMAP.md:74` lists these as _evaluate_: no tool chosen, no committed shape. A view for an unevaluated source would be invention, not planning.        |
| Scheduled jobs / cron-driven refresh                                                                          | `ROADMAP.md:64` marks these conditional ("if the data justifies them"). No polling or auto-refresh anywhere, per `dashboard-views` decision 3.           |
| Multi-tenant dashboard auth, per-client MCP credentials, per-property authorization                           | Resolved single-tenant: one owner, one Google account. Conditional future work (`DASHBOARD_ROADMAP.md` Phase 7), not a scheduled phase.                  |
| A user-facing Google OAuth flow, consent screen, or token revocation UI                                       | Resolved: one-time offline consent produces a refresh token stored as a Worker secret. There is no authorization server and no per-user Google identity. |
| Anything owned by `dashboard-views` or `dashboard-bff-foundations`                                            | Shell, error envelope, gate, cache mechanism, export mechanism, crawl-tool views. Consumed here, never redefined. Drift into them is a scope escalation. |
| Write paths to the MCP                                                                                        | The MCP is read-only analysis.                                                                                                                           |

## Capabilities

### New Capabilities

- `authenticated-source-contract`: cross-cutting rules for every authenticated/analytical view — no Google
  credential in any browser-reachable surface, cache key, export or log; a distinct staleness class for
  upstream-delayed data (as-of date and reporting lag displayed separately from `resultAge`); Google-side
  quota accounting independent of the MCP bucket; and the mandatory reconciliation gate that forbids shipping
  a provisional view before its tool's real output schema is published.
- `search-console-view`: the verified `search_console_query` report — property, date range, dimension
  selection, clicks/impressions/CTR/position table, 250-row bound badge, reporting-delay and as-of display.
- `gsc-insight-views`: `find_striking_distance_keywords`, `find_low_ctr_opportunities`, and content
  decay / period-over-period comparison. Provisional.
- `keyword-research-view`: `get_keyword_metrics` first, then `discover_keywords` — volume, CPC, competition,
  intent, clustering. Provisional.
- `seo-intelligence-view`: `analyze_domain`, `find_seo_opportunities`, keyword-to-page mapping, content gaps,
  cannibalizations, internal-linking recommendations, impact/effort prioritization. Provisional.
- `history-comparison-view`: D1-backed snapshots, period-over-period diffs, trend charts. **Blocked**; spec
  asserts the blocker and the invariants, nothing about shape.

### Decomposition rationale

| Boundary                                                            | Why it is drawn here                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authenticated-source-contract` separate from the four views        | Its requirements are the only ones in this change that are **verifiable today** and hold regardless of any tool's final shape. Duplicating them into four provisional specs would make them four times as likely to drift and impossible to test once.                      |
| `search-console-view` separate from `gsc-insight-views`             | The verified/anticipatory line must be a file boundary, not a paragraph. `search-console-view` can be specced, built, reviewed and shipped now; `gsc-insight-views` cannot start until its tools exist. Merging them would block shippable work on unbuilt work.            |
| `gsc-insight-views` kept as one capability, not three               | All three derive from the same first data slice (`query + page` by date, `ROADMAP.md:83`), the same upstream property and the same delay semantics. Three specs would be three copies of one set of invariants over three unknown shapes.                                   |
| `keyword-research-view` separate from `search-console-view`         | Different upstream API (Google Ads Keyword Planner), different credential (developer token), different quota, different data meaning (market volume vs. own-property performance). No shared invariant beyond `authenticated-source-contract`.                              |
| `seo-intelligence-view` separate from both                          | Derived/synthesized output, not a data source read. Its distinguishing requirement is provenance — every recommendation must name which underlying tool produced its evidence — which neither data-source view needs.                                                       |
| `history-comparison-view` kept in this change despite being blocked | Its blocker and non-invention rules belong on the record now, and GSC period-over-period comparison would otherwise be silently confused with it. They are different: GSC comparison reads Google's own 16-month window; history diffs D1 snapshots of _our_ crawl metrics. |

### Modified Capabilities

Each delta below follows the `dashboard-views` rule: if the owning change has not archived when specs are
written, fold the requirement into that change instead of writing a delta against an unmerged spec.

- `mcp-result-contract`: add `search_console_query` — Zod object output schema and published result type. This
  edits `src/server.ts`, an **MCP tool surface, flagged higher risk** per `openspec/config.yaml`.
- `dashboard-bff`: one JSON route per authenticated tool, a per-tool timeout above `gsc-timeout + token
exchange` (≥25s), and Google-quota accounting. Same token-injection and gate-first rules; no new bypass.
- `bff-result-cache`: a long-TTL class for upstream-delayed data, and an explicit prohibition on any cache key
  derived from a Google credential (extending the existing `apiKey` no-cache rule).
- `mcp-error-contract`: Google credential failure and Google quota exhaustion currently both arrive as
  `tool_failed` with Google's plain text (`src/google/search-console.ts:76-81` throws → `errorResult`), so the
  dashboard cannot mechanically distinguish "credentials broken, call an operator" from "Google quota spent,
  wait". Needs either distinguishable codes or a documented, tested text-classification rule with a safe
  default.
- `dashboard-shell`: navigation entries and the delayed-data staleness state. Structure and state contract are
  consumed unchanged.
- `quota-visibility`: display Google-side quota alongside MCP-bucket headroom, clearly labelled as two
  independent limits.
- `result-export`: exports of authenticated results must carry the as-of date and row-bound provenance, and
  must contain no credential.

## Approach and Tradeoffs

| #   | Decision                                                                                                                                                | Alternatives rejected                        | Rationale                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Ship `search-console-view` and `authenticated-source-contract` first, as the only slices with a verified basis.** Provisional views wait on tools.    | Spec and build all four views now            | Building against an invented shape guarantees rework and, worse, produces a UI that looks authoritative about numbers it never validated.                                                     |
| 2   | **Two staleness axes, displayed separately: `resultAge` (our cache) and `asOf` / reporting lag (Google's delay).**                                      | Reuse the crawl tools' single `resultAge`    | GSC data is days behind reality. One number cannot mean both "we fetched this 30s ago" and "Google's latest data is from two days ago". Collapsing them produces confidently wrong SEO reads. |
| 3   | **Long cache TTL for authenticated reads (hours, near the existing 86400 clamp), with explicit user refresh.**                                          | Copy the crawl tools' short TTL              | Re-fetching data that physically cannot have changed spends both the MCP bucket and Google's quota for an identical answer. Refresh stays available for the case where Google backfills.      |
| 4   | **Treat Google quota as a second, independently exhaustible budget with its own accounting and its own disable-submit state.**                          | Rely on the MCP's 60/60s bucket              | The MCP bucket is ours; Search Console and Ads quotas are Google's and are unaffected by it. Staying inside 60/60s while exhausting a daily Google quota is entirely possible.                |
| 5   | **No credential ever leaves the Worker: no proxying of raw Google responses, no Google call from the browser, no credential in a cache key or export.** | A thin Google passthrough route              | Single-tenant makes the credential _more_ dangerous, not less: one leak exposes the owner's whole Search Console and Ads account. The BFF's containment rule is absolute.                     |
| 6   | **Charts stay mechanism-agnostic in the specs; hand-rolled SVG is the recommendation inherited from `dashboard-views`.**                                | Mandate a charting library                   | Trend lines and bar charts are two primitives. Requirements describe what must be readable, not what draws it, so a library stays substitutable.                                              |
| 7   | **Every provisional spec carries an explicit reconciliation clause naming the tool it depends on.**                                                     | A single global "these are provisional" note | A global note is skippable. A per-spec clause is checkable at review time and blocks a view from shipping ahead of its schema.                                                                |
| 8   | **Views ship as independent slices behind the existing shell.**                                                                                         | One authenticated-dashboard release          | Each slice is separately reviewable and revertable, and the 800-line review budget is respected per slice.                                                                                    |

## Affected Areas

| Area                                                                              | Impact    | Description                                                                                                      |
| --------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/schemas/search-console.ts` (new)                                             | New       | Zod output schema for the GSC result shape.                                                                      |
| `src/google/search-console.ts`                                                    | Modified  | Result interface becomes a `z.infer` alias; import paths unchanged.                                              |
| `src/server.ts`                                                                   | Modified  | `outputSchema` on `search_console_query`. **Higher risk: MCP tool surface.**                                     |
| `src/types/index.ts`                                                              | Modified  | Publish the GSC result type.                                                                                     |
| `bff/src/router.ts`, `bff/src/cache.ts`                                           | Modified  | Authenticated routes, TTL class, Google-quota accounting. **Higher risk: token-holding Worker request surface.** |
| `bff/ui/` (new views)                                                             | New       | Authenticated/analytical views behind the existing shell.                                                        |
| `bff/test/`, `test/`                                                              | New       | RED-first tests per slice, including credential-containment and staleness-display tests.                         |
| `src/http/*`, `src/security/*`, `src/google/auth.ts` logic, root `wrangler.jsonc` | Unchanged | Any drift here is a scope escalation.                                                                            |

## Risks

| Risk                                                                                                             | Likelihood | Mitigation                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| A provisional spec's invented detail is implemented as if verified                                               | High       | Decision 7: per-spec reconciliation clause; `authenticated-source-contract` forbids shipping a view before its tool's schema is published. |
| Delayed GSC data read as current, producing a wrong SEO conclusion                                               | High       | Decision 2: separate `asOf`/lag display; no view renders a metric without its as-of date.                                                  |
| Google-side quota exhausted while the MCP bucket looks healthy                                                   | Med-High   | Decision 4: independent accounting, labelled display, submit disabled on exhaustion; Decision 3 reduces call volume.                       |
| 250-row truncation read as the complete data set                                                                 | Med-High   | Bound badge naming `maxGscRows`, per the `dashboard-views` bound-versus-empty rule.                                                        |
| Google credential leaks into a cache key, export, log or bundle                                                  | Med        | Decision 5, with RED tests asserting absence in every response body, header, cache value, export and log line.                             |
| Credential failure indistinguishable from quota exhaustion, so the owner retries a broken-auth state             | Med        | `mcp-error-contract` delta; safe default is "do not retry, surface as operator action".                                                    |
| The change grows into implementing the unbuilt tools                                                             | Med        | Non-goal stated explicitly; only item 1 of In Scope touches `src/`; tool implementation is a dependency.                                   |
| `src/server.ts` edit destabilizes the MCP tool surface for existing hosts                                        | Low-Med    | Additive `outputSchema` only, object root (avoids the legacy `{result:…}` wrap); integration test that registration still round-trips.     |
| Another actor commits to `src/google/*` or `bff/` concurrently, as already happened twice in this planning chain | Med        | Re-read the real shapes at specs and apply time; treat any divergence as a spec-reconciliation event, not a merge conflict to paper over.  |
| `src/google/auth.ts:3` holds the access token in a module-level cache                                            | Low        | Not request-scoped, so acceptable under a single shared credential; server-side and out of scope here, but must never be surfaced.         |

## Rollback Plan

- **Dashboard/BFF slices**: views and routes live only in `seo-dashboard-bff`. `wrangler rollback` (or
  `wrangler versions deploy` to the prior version) restores the previous UI. `seo-mcp` is untouched by these
  slices, so no rollback here can affect MCP hosts.
- **Per-view**: each view is a separate slice/commit; reverting one leaves the shell and other views working.
  The shell renders a disabled-view state rather than a broken route.
- **`search_console_query` output schema (the one `seo-mcp` change)**: additive. Revert the `outputSchema`
  field and redeploy `seo-mcp` with `wrangler rollback`; hosts ignoring `structuredContent` are unaffected
  either way. The BFF must tolerate the schema's absence rather than fail closed.
- **Cache TTL class**: revert to the existing per-tool TTL values and redeploy the BFF. Cached entries expire
  on their own TTL; no migration.
- **Never rolled back independently**: the `dashboard-access-gate` and the credential-containment rules.
  Removing either while an authenticated route is live exposes the owner's Google account, not just a panel.

## Dependencies

**Must be archived before any work here starts** — from `dashboard-bff-foundations`: `mcp-result-contract`,
`dashboard-bff`, `dashboard-access-gate`, `mcp-error-contract`, `bff-result-cache`. From `dashboard-views`:
`dashboard-shell` (navigation and state contract), plus `result-export` and `quota-visibility` for the deltas
above.

**Per-view server prerequisites — none of these are deliverables of this change:**

| View                      | Blocked until                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search-console-view`     | Nothing. `search_console_query` ships and is verified live (`ROADMAP.md:41`).                                                                                                                                                                                                                                                                                                                                                                |
| `gsc-insight-views`       | **Partially unblocked.** `find_striking_distance_keywords` and `find_low_ctr_opportunities` shipped (commit `a5b4f22`) and are now reconciled against their real `OpportunityResult` shape in the amended `gsc-insight-views` spec — these two are buildable now, pending an `outputSchema` for each (they have none yet). Content-decay / period-over-period comparison remains fully unbuilt and still blocks that third part of the view. |
| `keyword-research-view`   | **Fully unblocked.** `get_keyword_metrics`, `discover_keywords` (commit `1044d82`), and `cluster_keywords` (commit `ef5b0d2`, credential-free, not originally in scope) all shipped and are reconciled in the amended `keyword-research-view` spec, pending an `outputSchema` for each (none exist yet). Remaining prerequisite is operational only: the Ads developer token as a Worker secret.                                             |
| `seo-intelligence-view`   | `analyze_domain` and `find_seo_opportunities` exist with published output schemas.                                                                                                                                                                                                                                                                                                                                                           |
| `history-comparison-view` | **Precise blocker**: the server must (a) create the D1 binding and a snapshot schema with 90-day rolling retention, (b) write snapshots, and (c) expose history through an MCP tool. `ROADMAP.md:81` decides the storage engine only. There is no tool, no binding, and no interface today — so nothing to render and nothing to spec beyond the blocker.                                                                                    |

Operational prerequisite for every authenticated view: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and
`GOOGLE_REFRESH_TOKEN` set via `wrangler secret put` (`src/config.ts:5-7`, `src/google/auth.ts:14-20`), plus
an Ads developer token before keyword research. Absent credentials must render a distinct "not configured"
state, never an empty result.

## Open Decisions (need the human — listed, not assumed)

| Decision                                                                                                              | Status                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is the slicing in Decision 1 accepted — ship the GSC view now, hold the other three views until their tools exist?    | **Recommended**, needs confirmation. The alternative is deferring this change entirely until the tools land.                                                                                            |
| Cache TTL for authenticated reads                                                                                     | **Open.** Recommended: hours, with explicit refresh. Needs a product answer on acceptable staleness.                                                                                                    |
| Which Search Console properties the owner actually manages, and whether the property list is configured or discovered | **Open.** `search_console_query` takes `siteUrl` per call; there is no list-properties tool. Affects whether the UI needs a configured allowlist.                                                       |
| Default date range and comparison window for the GSC view                                                             | **Open.** Recommended: last 28 days vs. previous 28. Needs confirmation.                                                                                                                                |
| Distinguishing Google credential failure from Google quota exhaustion                                                 | **Open.** Needs either new error codes (server change) or an agreed text-classification rule. Safe default: do not retry.                                                                               |
| Google-side quota accounting source                                                                                   | **Open.** Google returns no remaining-count header, so it is BFF-side accounting with the same approximate semantics `dashboard-views` accepted for the MCP bucket. Needs agreement on display wording. |
| Whether `search_console_query`'s `outputSchema` belongs here or folded back into `dashboard-bff-foundations`          | **Open.** Recommended: here, since foundations explicitly deferred it. Folding back is acceptable if that change has not archived.                                                                      |
| Charting mechanism for trend lines                                                                                    | **Open**, inherited. Recommended: hand-rolled SVG, per `dashboard-views`.                                                                                                                               |

## Proposal question round

Execution mode is `auto`, so these were not asked interactively. They need the user's review before the specs
phase, and each maps to a row above.

1. **Business urgency**: is the driver "I already have GSC data I cannot read" (favours shipping the GSC view
   alone, now) or "I want the full insight panel" (favours holding this change until the tools land)?
2. **Business rule on freshness**: what result age is acceptable for authenticated data before the owner
   expects a refresh — an hour, a day, or "whatever Google has"?
3. **Domain scope**: how many Search Console properties, and are they fixed enough to configure as an
   allowlist rather than typed per query?
4. **Edge case priority**: when Google credentials break, what should happen — a loud operator-facing state, a
   silent degraded view, or a blocked dashboard?
5. **Overbuild boundary**: for `seo-intelligence-view`, is prioritization (impact/effort) part of the first
   product slice, or a later refinement once the underlying analyses are trusted?

Assumptions taken in the absence of answers: single owner, small fixed property set, hours-long acceptable
staleness, loud operator-facing credential failure, prioritization included but last.

## Success Criteria

- [ ] `search_console_query` has a Zod object output schema, a published result type, and a BFF route; no
      hand-duplicated shape exists in `bff/ui/`.
- [ ] The Search Console view renders clicks, impressions, CTR and position for the selected dimensions, and
      every metric is accompanied by its as-of date.
- [ ] A 250-row result displays a bound badge naming `maxGscRows`; an empty result renders a distinct
      empty state.
- [ ] `resultAge` and Google's reporting lag are displayed as two separate values, never merged.
- [ ] No Google credential (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, any access
      token, any Ads developer token) and no `MCP_AUTH_TOKEN` appears in any bundle, response body, header,
      cache key, cache value, export, browser storage or log line — asserted by test, not inspection.
- [ ] Missing Google credentials render a "not configured" state distinct from both an error and an
      empty result.
- [ ] Google-side quota is displayed separately from MCP-bucket headroom, and exhaustion of either disables
      submit with a reason.
- [ ] No authenticated view issues a request without an explicit user action; no timer, interval or focus
      handler triggers a fetch.
- [ ] Every provisional spec states its provisional status inline and names the tool whose real output schema
      must reconcile it; no provisional view is implemented before that reconciliation.
- [ ] `history-comparison-view` ships as spec only, with its blocker named, and no code depends on it.
- [ ] Authenticated exports carry as-of date and bound provenance, and contain no credential.
- [ ] Automated accessibility checks pass on every new view; keyboard-only navigation reaches every control.
- [ ] `src/http/*` and `src/security/*` are byte-unchanged.
- [ ] `pnpm test`, `pnpm typecheck` and `pnpm format:check` pass.
