# Delta for GSC Insight Views

## PROVISIONAL — reconciliation required before shipping

This spec covers three unbuilt tools: `find_striking_distance_keywords`, `find_low_ctr_opportunities`,
and a content-decay / period-over-period comparison tool (name not yet assigned in `ROADMAP.md`). None
of the three has an implementation, a registered MCP tool, or a published output schema. Every
requirement below is written as an intent and a behavioral invariant that MUST hold regardless of the
eventual result shape — it does NOT name a response field, JSON key, metric name, or score scale, because
none of those are known yet.

Per the `authenticated-source-contract` capability's reconciliation gate: this spec MUST be reconciled
against each tool's real output schema, one tool at a time, before that tool's part of this view ships.
A requirement below MAY be satisfied for one of the three tools while the other two remain blocked; this
capability is not an all-or-nothing gate.

All three tools derive from the same resolved first data slice — Google Search Console `query + page` by
date (`ROADMAP.md`, "Resolved decisions" section) — so they share a property, a date range, and Google's
own reporting delay. The reporting-lag/as-of display and the credential/quota rules live in
`authenticated-source-contract` and are not restated here.

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

### Requirement: Ranked Opportunity Sets Label Their Own Bound

Both `find_striking_distance_keywords` and `find_low_ctr_opportunities` are expected, per `ROADMAP.md`, to
return ranked opportunity sets. Whatever bounding mechanism the real tool applies (a row limit, a result
cap, or none), the view MUST distinguish "this is the complete opportunity set" from "this set was capped
by a limit" once the real shape reveals which case applies, and MUST NOT silently render a capped set as
if it were exhaustive.

#### Scenario: A capped opportunity set is not presented as complete

- GIVEN the reconciled tool shape reveals that the returned opportunity set was truncated by a server-side
  bound
- WHEN the view renders that set
- THEN it MUST show a bound-reached indication naming the limit, per the `dashboard-shell` bound-versus-
  empty state contract, and MUST NOT present the truncated set as the complete result

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
