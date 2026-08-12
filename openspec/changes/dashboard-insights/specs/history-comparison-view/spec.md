# Delta for History Comparison View

## PROVISIONAL AND BLOCKED — no unbuilt tool exists yet, no reconciliation is possible today

This capability has no unbuilt tool with even a name, unlike the other three provisional views in this
change. `ROADMAP.md`'s "Resolved decisions" section fixes only the storage engine — D1 (SQLite), with
rolling 90-day retention — and states that history storage removes an earlier blocker. It does not create
a binding, a snapshot schema, a write path, or an MCP tool that exposes history. There is nothing to
reconcile against, because there is no output schema, provisional or otherwise, to reconcile against.

**Precise blocker** (restated from the proposal's dependency table): this view is blocked until the server,
as a separate change, (a) creates the D1 binding and a snapshot schema with 90-day rolling retention, (b)
writes snapshots on a defined trigger, and (c) exposes history through a registered MCP tool with a
published output schema. Until all three exist, this spec asserts only the invariants below — nothing
about field names, snapshot shape, diff representation, or trend-chart data, because none of that is
knowable yet. No requirement in this file may be implemented, and no code may depend on this capability,
until that blocker is resolved and a reconciliation pass against the real tool shape has occurred.

## ADDED Requirements

### Requirement: The View Does Not Ship Before the Blocker Resolves

No implementation of this view, and no other view's code, MUST depend on this capability while the D1
binding, snapshot writer, and history-exposing MCP tool remain unbuilt. The dashboard's navigation MAY
list this view as a distinct disabled/not-yet-available state, per the `dashboard-shell` state contract,
but MUST NOT link to a functioning route that issues a request no tool can serve.

#### Scenario: Navigation shows the view as not yet available

- GIVEN the D1 snapshot writer and history-exposing MCP tool do not yet exist
- WHEN a user views the dashboard's navigation
- THEN this view MUST appear in a distinct "not yet available" state, and activating it MUST NOT trigger
  a request to a nonexistent tool

### Requirement: The Retention Window Is Visible Whenever History Is Shown

Once the blocker resolves and history becomes available, every view of historical data MUST display the
retention window (per `ROADMAP.md`'s resolved 90-day rolling retention, or whatever window the eventual
tool actually reports) so a user does not read a bounded history as if it were a complete, unbounded
record. A history view MUST NOT render as though data older than the retention window simply does not
exist, without stating that a retention boundary is the reason.

#### Scenario: A history view names its retention window

- GIVEN a user views historical data once the blocker is resolved
- WHEN the view renders that history
- THEN it MUST display the retention window that bounds it

#### Scenario: Data older than the retention window is explained, not silently absent

- GIVEN a user requests a comparison period that falls outside the retention window
- WHEN the view attempts to render that comparison
- THEN it MUST state that the requested period falls outside the retention window, and MUST NOT render an
  empty result indistinguishable from "no change occurred"

### Requirement: A Period-Over-Period Diff States Both Endpoints

Once available, every diff or trend this view renders MUST state both compared snapshots (or periods)
explicitly, by their own dates, the same way `gsc-insight-views` requires both periods of a GSC comparison
to be stated. A diff MUST NOT be rendered with only a delta value and no visible statement of which two
points in time produced it.

#### Scenario: A diff names both of its snapshot dates

- GIVEN a period-over-period diff is rendered
- WHEN the view displays that diff
- THEN both the earlier and the later snapshot dates MUST be visible together with the delta

### Requirement: "No Change" Is Distinct From "No Data For That Period"

Once available, the view MUST distinguish a diff whose value is genuinely zero (the metric did not
change between two snapshots that both exist) from a case where one or both snapshots for the requested
period do not exist in D1. Both cases MUST NOT be rendered with the same "no change" presentation.

#### Scenario: A genuine zero-change diff shows both snapshots existed

- GIVEN two snapshots exist for the requested period and their compared metric is identical
- WHEN the view renders the diff
- THEN it MUST show a "no change" state that also confirms both snapshot dates are present

#### Scenario: A missing snapshot is shown as missing data, not as zero change

- GIVEN one of the two snapshots for the requested period does not exist
- WHEN the view attempts to render the diff
- THEN it MUST show an explicit "no data for that period" state, distinct from the "no change" state,
  naming which endpoint is missing

## Blocker Record

| Requirement            | Blocked until                                                                                                                                                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All requirements above | Server creates the D1 binding + snapshot schema (90-day rolling retention), writes snapshots, and exposes history through a registered MCP tool with a published output schema. `ROADMAP.md`'s resolved decision fixes only the storage engine. |

## Required Amendments To Sibling Changes

None. The disabled-navigation-entry state this spec relies on is an instance of the existing
`dashboard-shell` "distinguishable states" contract from `dashboard-views`; no new state category needs
to be added to that spec to represent "capability not yet available."
