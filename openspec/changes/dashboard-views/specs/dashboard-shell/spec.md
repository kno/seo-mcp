# Delta for Dashboard Shell

## Purpose

Structural foundation consumed by every view: navigation, a design-system baseline (atomic
design, container/presentational split), and the shared loading / error / empty / bound-reached
state contract over the `mcp-error-contract` envelope. Requirements are mechanism-agnostic: they
MUST hold regardless of the chosen frontend framework or charting approach.

## ADDED Requirements

### Requirement: Every Normalized Error Code Has a Defined Presentation

For every distinct `code` category the `mcp-error-contract` envelope defines (dashboard gate
rejection, upstream 401, upstream 429, upstream 503, tool `isError`, BFF input-validation
failure, output-schema validation failure, BFF timeout, and any further code the foundations
change ships), the shell MUST render a distinct, actionable presentation. An unrecognized or
newly added `code` value MUST fall into an explicit "unmapped error" state that still names the
raw `code` and message, and MUST NOT be silently rendered as empty or success.

#### Scenario: Known code renders its mapped presentation

- GIVEN a view's fetch fails with a normalized error whose `code` identifies upstream 401
- WHEN the shell renders the failure
- THEN it MUST show the presentation mapped to that code, distinct from the presentation used for 429, 503, timeout, or tool failure

#### Scenario: Unmapped code fails visibly, not silently

- GIVEN a normalized error carries a `code` the shell has no mapping for
- WHEN the shell renders the failure
- THEN it MUST show an explicit unmapped-error state naming the raw `code` and message
- AND MUST NOT render the view as empty or successful

### Requirement: Rate-Limit Errors Surface `retryAfter` and Block Resubmission

When a normalized error's `code` identifies rate limiting and includes `retryAfter`, the shell
MUST display the retry delay and MUST disable the triggering action until that delay elapses.

#### Scenario: 429 disables the retry control

- GIVEN a fetch fails with the rate-limit code and `retryAfter: 60`
- WHEN the shell renders the failure
- THEN it MUST show a countdown reflecting the 60-second delay
- AND the action that triggered the request MUST remain disabled until the countdown reaches zero

### Requirement: Loading, Empty, and Bound-Reached States Are Distinguishable

The shell MUST expose three mutually exclusive states per data region: in-flight loading,
successfully-loaded-with-nothing-found (empty), and successfully-loaded-but-truncated-by-a-limit
(bound reached). A consumer MUST NOT be able to tell "nothing found" and "a bound was reached"
apart only from raw counts.

#### Scenario: Empty result is distinct from loading

- GIVEN a request is in flight
- WHEN the response has not yet arrived
- THEN the shell MUST render the loading state, not the empty state

#### Scenario: Bound-reached result is distinct from empty

- GIVEN a result whose sample was capped by a server-side limit (e.g. `maxLinkChecks`)
- WHEN the shell renders that result
- THEN it MUST show a bound-reached indicator naming the limit, not the empty-state presentation

### Requirement: No Polling, Auto-Refresh, or Refresh-on-Focus

The shell MUST NOT issue any MCP-backed fetch except as the direct result of an explicit user
action (e.g. a button click or form submit). No timer, interval, visibility-change, or
focus/blur handler MUST trigger a fetch, because every fetch spends the shared 60-req/60s bucket.

#### Scenario: Returning to a background tab issues no fetch

- GIVEN a view previously loaded data and the tab lost then regained focus
- WHEN focus returns to the tab
- THEN the shell MUST NOT issue any new fetch as a result of that focus change

#### Scenario: No idle timer refresh

- GIVEN a view has been open and idle for an extended period
- WHEN no user action has occurred
- THEN the shell MUST NOT have issued any fetch since the last explicit user action

### Requirement: Keyboard Reachability and Focus Management

Every interactive control MUST be reachable and operable via keyboard alone, MUST expose a
programmatic name and role, and MUST move focus predictably when an async state (loading, error,
result) changes so a keyboard or screen-reader user is not left on a stale or removed element.

#### Scenario: Keyboard-only navigation reaches every control

- GIVEN a view with a form and a results region
- WHEN a user navigates using only Tab/Shift+Tab and Enter/Space
- THEN every actionable control MUST receive focus and be operable in that order

#### Scenario: Focus moves on async completion

- GIVEN a user submits a request from a focused control that becomes disabled while loading
- WHEN the result or error state renders
- THEN focus MUST move to a announced, programmatically identifiable element within that new state, not remain on a now-disabled or removed control

### Requirement: Responsive Layout Across Viewport Widths

Every view MUST remain usable — all data and controls reachable without horizontal scrolling of
the page body — at both a narrow (mobile-width) and a wide (desktop-width) viewport.

#### Scenario: Narrow viewport does not clip controls

- GIVEN a view is rendered at a mobile-width viewport
- WHEN a user interacts with its primary form and result region
- THEN no control or data field MUST be clipped or unreachable without horizontal page scrolling
