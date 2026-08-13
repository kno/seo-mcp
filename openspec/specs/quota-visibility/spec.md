# Quota Visibility

## Requirements

### Requirement: Shared Bucket Headroom Is Surfaced as an Estimate

The dashboard MUST display an indication of how close the shared 60-requests-per-60-seconds rate-limit bucket is to its limit, derived exclusively from the BFF's read-only usage/headroom source (the BFF's own observed call volume and the window it covers). The display MUST present this figure as an ESTIMATE, not as an authoritative remaining-request count, and MUST make that estimated nature visible to the user rather than only documented out-of-band. The rationale — the Workers rate-limit binding reports only success or failure and never a remaining count (`src/http/auth.ts:104-107`), and the bucket is shared with every other MCP consumer whose traffic the BFF cannot observe — MUST be discoverable from the view (e.g. via visible label text or an accessible explanation), not only from developer documentation.

#### Scenario: Headroom indicator is visible without opening devtools

- GIVEN the BFF's usage source reports its observed call volume for the current window
- WHEN a user views any page of the dashboard
- THEN a headroom indicator MUST be visible without requiring devtools or inspecting network requests

#### Scenario: Headroom is labeled as an estimate

- GIVEN the headroom indicator renders a value derived from the BFF's own call accounting
- WHEN the indicator is displayed
- THEN it MUST be labeled or otherwise clearly presented as an estimate, not as an exact remaining-request count

#### Scenario: The estimate's limitation is discoverable from the view

- GIVEN a user wants to understand why the headroom figure is approximate
- WHEN the user interacts with the headroom indicator (e.g. a tooltip, help text, or adjacent explanation)
- THEN the view MUST make available an explanation that the figure reflects only the BFF's own observed traffic, not the full shared bucket

### Requirement: Result Age Is Surfaced for Every Cached Result

Every panel displaying a result that was served from the BFF's result cache MUST display the age of that cached result (derived from the BFF's `resultAge`), so a user can tell the panel is showing a stale result rather than a freshly fetched one.

#### Scenario: A freshly fetched result shows a low or zero age

- GIVEN a result was fetched directly from the MCP tool without being served from cache
- WHEN the panel renders that result
- THEN the displayed result age MUST reflect that the result is current (not stale)

#### Scenario: A cached result shows its actual age

- GIVEN a result was served from the cache with a `resultAge` of several minutes
- WHEN the panel renders that result
- THEN the displayed age MUST reflect the actual elapsed time, visible without opening devtools

### Requirement: A 429 Response Surfaces retryAfter and Discourages Immediate Retry

When a request is rejected with a normalized rate-limit error carrying `retryAfter`, the view MUST surface that `retryAfter` value to the user and MUST NOT present a control or affordance that invites immediate retry before that delay has elapsed.

#### Scenario: retryAfter is displayed

- GIVEN a request fails with the normalized rate-limit error and a `retryAfter` of 60 seconds
- WHEN the view renders the resulting error state
- THEN it MUST display the 60-second `retryAfter` value to the user

#### Scenario: Retry action is disabled until retryAfter elapses

- GIVEN the view is showing a rate-limit error state with a `retryAfter` value
- WHEN the user views the available actions before that delay has elapsed
- THEN any retry/resubmit action for the same request MUST be disabled or absent until the delay has elapsed

#### Scenario: Retry becomes available after retryAfter elapses

- GIVEN a rate-limit error state's `retryAfter` delay has fully elapsed
- WHEN the user views the view again
- THEN a retry/resubmit action MAY become available

#### Scenario: A rate-limit error without a retry delay is handled honestly

- GIVEN a request is rejected by an upstream quota that supplies no retry delay (an authenticated source's quota rejection carries no `retry-after`)
- WHEN the view renders the resulting error state
- THEN it MUST state that the limit was reached without displaying a specific wait time
- AND it MUST NOT fabricate or default a delay value, because an invented wait time is a false statement to the user
- AND it MUST still avoid presenting an affordance that invites immediate repeated retry
