# Delta for Broken Links View

## Purpose

Renders a `check_links` result (`LinkCheckResult`) as an on-demand panel. `check_links` is the
most subrequest-hungry tool and can hit the platform subrequest ceiling, so this view carries
independently verifiable requirements about triggering, counts, state distinction, and bounds.

## ADDED Requirements

### Requirement: Broken-Links Check Runs Only on Explicit User Action

The broken-links panel MUST NOT issue a `check_links` request as a side effect of opening,
loading, or viewing the page report. It MUST only run when the user performs a dedicated,
explicit action (e.g. clicking a "Check links" control) that exists separately from loading the
page report.

#### Scenario: Opening the page report does not trigger a link check

- GIVEN a user opens the page report for a URL that has never been link-checked
- WHEN the report finishes loading
- THEN no `check_links` request MUST have been issued

#### Scenario: Explicit action triggers the check

- GIVEN a user is viewing a page report
- WHEN the user activates the dedicated "check links" control
- THEN exactly one `check_links` request MUST be issued as a direct result of that action

### Requirement: Checked, OK, Broken, and Errors Counts Are Always Visible

Whenever a `LinkCheckResult` is rendered, the panel MUST display all four of `checked`, `ok`,
`broken`, and `errors` as distinct, always-visible figures — never only a subset — so a bounded
probe set can never present as a clean bill of health by omission.

#### Scenario: All four counts render together

- GIVEN `LinkCheckResult { checked: 50, ok: 40, broken: 5, errors: 5 }`
- WHEN the panel renders
- THEN it MUST display 50, 40, 5, and 5 as four distinct, simultaneously visible figures

#### Scenario: Zero broken is shown alongside checked, not alone

- GIVEN `LinkCheckResult { checked: 12, ok: 12, broken: 0, errors: 0 }`
- WHEN the panel renders
- THEN it MUST still show `checked: 12` alongside `broken: 0`, so zero broken is legible as "12 checked, 0 broken" rather than an unqualified "no broken links"

### Requirement: Broken and Error States Render Distinctly

The panel MUST visually and semantically distinguish each `LinkProbe` whose `state` is `"broken"`
(a 4xx/5xx HTTP status) from each whose `state` is `"error"` (unreachable target, invalid URL,
or timeout), because a broken link needs a content fix while an error needs a
reachability/network investigation.

#### Scenario: Broken probe shows its status code

- GIVEN a `LinkProbe { url, state: "broken", status: 404 }`
- WHEN the panel renders that probe
- THEN it MUST show the `broken` indicator together with the `404` status

#### Scenario: Error probe shows its error reason, not a status code

- GIVEN a `LinkProbe { url, state: "error", error: "Link probe timed out" }`
- WHEN the panel renders that probe
- THEN it MUST show the distinct `error` indicator together with the error reason, and MUST NOT present it as a `broken` (HTTP status) result

### Requirement: Bounded Probe Set Is Named, Not Implied Exhaustive

When `checked` equals the server's `maxLinkChecks` bound, the panel MUST show an explicit
indicator that the probe set was bounded by that limit and is not necessarily every link on the
page, naming the limit value.

#### Scenario: Checked count at the bound shows a bound indicator

- GIVEN a page with more than 50 distinct links and `LinkCheckResult.checked === 50`
- WHEN the panel renders
- THEN it MUST show an explicit indicator that the probe set was capped at 50 links, not presented as exhaustive

#### Scenario: Checked count below the bound shows no bound indicator

- GIVEN `LinkCheckResult.checked` is below the server's link-check limit
- WHEN the panel renders
- THEN it MUST NOT claim the probe set was bounded by that limit

### Requirement: Upstream Platform Failure Surfaces as an Error, Never as Zero Broken Links

When the underlying `check_links` request fails with a normalized error (including the
platform subrequest-ceiling failure the tool can hit), the panel MUST render the shared
error-state contract and MUST NOT render `broken: 0` or any other count as if the check had
completed successfully.

#### Scenario: Subrequest-ceiling failure shows an error, not a clean result

- GIVEN a `check_links` request fails with a normalized upstream error caused by the platform subrequest ceiling
- WHEN the panel renders
- THEN it MUST show the shared error-state presentation for that error
- AND MUST NOT display `checked`, `ok`, `broken`, or `errors` counts as if a result had been returned
