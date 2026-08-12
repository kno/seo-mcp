# Delta for GSC Insight Views

## Reconciliation status

Two of the three tools this spec covers now exist and are RECONCILED against their real shape, read from
`src/google/opportunities.ts` and `src/server.ts` (commit `a5b4f22`):

- `find_striking_distance_keywords` — inputs `siteUrl`, `startDate`, `endDate` (both `YYYY-MM-DD`), optional
  `minPosition`/`maxPosition` (1–100, server defaults 11/20), optional `minImpressions` (int ≥0, default 1),
  optional `limit` (1–250, default 25).
- `find_low_ctr_opportunities` — inputs `siteUrl`, `startDate`, `endDate`, optional `maxPosition` (1–100,
  default 10), optional `minImpressions` (int ≥0, default 10), optional `maxCtr` (0–1, default 0.02),
  optional `limit` (1–250, default 25).
- Both return the same `OpportunityResult` shape: `{ siteUrl, startDate, endDate, dimensions, criteria:
Record<string, number>, rowCount, rows: GscRow[] }` (`src/google/opportunities.ts:60-66,150-156,183-190`).
  `rowCount` is always `rows.length` after filtering and truncation — there is no separate
  total-matching-count field.
- **Neither tool accepts a comparison or baseline period.** Both operate on one date range only.

The third tool — content-decay / period-over-period comparison — remains **PROVISIONAL**: unbuilt, no
registered tool, no output schema. Its requirements below stay behavioral invariants only, per the
`authenticated-source-contract` reconciliation gate, and MUST be reconciled before it ships. This
capability is not an all-or-nothing gate: the two grounded tools may ship while the third stays blocked.

All three tools derive from the same resolved first data slice — Google Search Console `query + page` by
date (`ROADMAP.md`, "Resolved decisions" section) — so they share a property, a date range (where
applicable), and Google's own reporting delay. The reporting-lag/as-of display and the credential/quota
rules live in `authenticated-source-contract` and are not restated here.

## ADDED Requirements

### Requirement: Shared Property and Date-Range Selection Across All Three Tools

The view MUST offer one property selector and one date-range selector that apply to whichever of the
three insight tools is active, rather than each tool defining its own independent property/date controls.
Switching the active insight tool MUST NOT silently reset a property or date range the user has already
selected.

#### Scenario: Property and date range persist across tool switches

- GIVEN a user has selected a property and a date range while viewing striking-distance results
- WHEN the user switches to the low-CTR opportunities tool within the same view
- THEN the previously selected property and date range MUST remain selected, not reset to a default

#### Scenario: An unselected property blocks submission for any of the three tools

- GIVEN no property has been selected
- WHEN a user attempts to submit a request to any of the three insight tools
- THEN the view MUST prevent submission and MUST NOT send a request lacking a property

### Requirement: Applied Criteria Are Shown Alongside Results

Both grounded tools echo the effective thresholds used to produce the result in `criteria` (e.g. the
position range, minimum impressions, or maximum CTR applied, including server-side defaults when the user
did not override them). The view MUST display these effective criteria alongside the result, so a user
cannot mistake a threshold the server defaulted for one they chose, and cannot misread a narrow result as
"few opportunities exist" when it was actually "few opportunities matched this threshold".

#### Scenario: Server-applied defaults are visible, not hidden

- GIVEN a user submits a striking-distance request without overriding `minImpressions`
- WHEN the view renders the result
- THEN it MUST display the `minImpressions` value the server actually applied, from `criteria`, not only
  the value the user explicitly typed

### Requirement: Ranked Opportunity Sets Label Their Own Bound

Both `find_striking_distance_keywords` and `find_low_ctr_opportunities` return `rowCount` equal to
`rows.length` after filtering and truncation, with no separate total-matching-count field
(`src/google/opportunities.ts:132,187`). The view MUST treat `rowCount === criteria.limit` as a signal that
more matching opportunities may exist beyond what was returned, using the `dashboard-shell` bound-versus-
empty state contract, and MUST NOT present that case as the complete result.

There is a second, independent truncation layer the view MUST also account for: both tools pull GSC rows
up to `LIMITS.maxGscRows` (250) BEFORE filtering (`src/google/opportunities.ts:113-119,164-170`), so
opportunities beyond that raw pull are invisible to the filter regardless of `limit`. The view MUST NOT
claim exhaustiveness for either tool's result under any circumstance, since this deeper truncation cannot
be detected from the response at all.

#### Scenario: A capped opportunity set is not presented as complete

- GIVEN a result whose `rowCount` equals its own `criteria.limit`
- WHEN the view renders that set
- THEN it MUST show a bound-reached indication naming the limit, and MUST NOT present the set as the
  complete result

#### Scenario: The view never claims exhaustiveness

- GIVEN any successful result from either tool, regardless of `rowCount`
- WHEN the view renders it
- THEN it MUST NOT state or imply that the result is a complete enumeration of all matching opportunities,
  because the underlying Search Console pull is itself bounded before filtering

#### Scenario: Zero opportunities is distinct from an unfetched state

- GIVEN a request to either tool completes successfully with no opportunities found
- WHEN the view renders that result
- THEN it MUST show an explicit "no opportunities found" state, distinguishable from the loading state and
  from a state where the request has not yet been submitted

### Requirement: Period-Over-Period Comparison States Both Periods Explicitly

Content-decay detection and period-over-period comparison are, by their nature, meaningless without a
stated baseline. The view MUST require and display both compared periods (the current period and the
baseline period) as explicit, user-visible date ranges before rendering any comparison result. A
comparison MUST NOT be rendered with an implicit, unstated, or default-only baseline that is not shown to
the user.

#### Scenario: Comparison result names both periods

- GIVEN a period-over-period comparison result is rendered
- WHEN the view displays that result
- THEN both the current period's date range and the baseline period's date range MUST be visible together
  with the comparison

#### Scenario: Submitting a comparison without a baseline is blocked

- GIVEN a user has selected a current period but has not selected or confirmed a baseline period
- WHEN the user attempts to submit the comparison request
- THEN the view MUST prevent submission until a baseline period is explicitly selected

### Requirement: Content-Decay Direction Is Unambiguous

Whatever numeric or qualitative decay indicator the real tool returns, the view MUST render the direction
of change (decline vs. improvement vs. no material change) using a presentation that cannot be misread as
the opposite direction — for example, a decline MUST NOT use the same visual treatment (color, icon, or
sign) that the view uses elsewhere for improvement.

#### Scenario: A decline cannot be rendered as an improvement

- GIVEN a query or page shows a decay result whose reconciled meaning is "performance declined"
- WHEN the view renders that entry
- THEN it MUST use a decline-specific presentation, and MUST NOT reuse the presentation the view assigns
  to an improvement for the same metric

#### Scenario: No material change is a third, distinct state

- GIVEN a comparison result whose reconciled meaning is "no material change between periods"
- WHEN the view renders that entry
- THEN it MUST show a state distinct from both "declined" and "improved", not defaulted to either

### Requirement: Reporting Lag Applies to All Three Tools

Per `authenticated-source-contract`, Google Search Console data carries its own reporting delay,
independent of the freshness of the BFF's cached result. Every result rendered by any of the three
insight tools MUST carry the same as-of/reporting-lag display that `search-console-view` establishes,
using the current period's and (for comparisons) the baseline period's own as-of dates.

#### Scenario: A comparison shows the as-of date for each period independently

- GIVEN a period-over-period comparison result
- WHEN the view renders it
- THEN it MUST show an as-of date for the current period and a separate as-of date for the baseline
  period, not one shared value implied to cover both
