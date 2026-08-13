# Delta for PageSpeed View

## ADDED Requirements

### Requirement: URL and Strategy Input

The `analyze_pagespeed` view MUST provide a URL input and a strategy selector limited to `mobile` and `desktop`, defaulting to `mobile`. The view MUST NOT submit a request without a URL.

#### Scenario: Strategy defaults to mobile

- GIVEN a user opens the PageSpeed view
- WHEN the strategy selector renders
- THEN it MUST default to `mobile`

#### Scenario: Submission without a URL is blocked

- GIVEN the URL input is empty
- WHEN the user attempts to submit the request
- THEN the view MUST prevent submission

### Requirement: Score Presentation for All Four Categories

The view MUST present `performanceScore`, `accessibilityScore`, `bestPracticesScore`, and `seoScore` from `PageSpeedResult`, each as a value in the 0-100 range when present. When a given score field is absent from the result, the view MUST display that category as unavailable rather than substituting a default numeric value (such as 0).

#### Scenario: All four scores are present

- GIVEN `PageSpeedResult` includes all four score fields
- WHEN the view renders
- THEN each of the four categories MUST display its corresponding numeric score

#### Scenario: A missing score is shown as unavailable, not zero

- GIVEN `PageSpeedResult.accessibilityScore` is absent
- WHEN the view renders the score section
- THEN the accessibility category MUST display an "unavailable" state and MUST NOT display a score of 0

### Requirement: Lab Metrics Presentation

The view MUST present the lab metrics available on `PageSpeedResult.labMetrics`: `firstContentfulPaintMs`, `largestContentfulPaintMs`, `totalBlockingTimeMs`, `cumulativeLayoutShift`, and `speedIndexMs`. Each metric MUST be labeled with its unit (milliseconds, or unitless for `cumulativeLayoutShift`). Any lab metric absent from the result MUST render as unavailable rather than as a zero or blank value indistinguishable from a genuine zero measurement.

#### Scenario: Present lab metrics render with correct units

- GIVEN `labMetrics.largestContentfulPaintMs` is `2400`
- WHEN the lab metrics section renders
- THEN it MUST display the value labeled in milliseconds

#### Scenario: Absent lab metric renders as unavailable

- GIVEN `labMetrics.speedIndexMs` is absent
- WHEN the lab metrics section renders
- THEN the Speed Index entry MUST display an "unavailable" state, distinguishable from a `0` value

#### Scenario: A genuine zero value is not confused with an absent metric

- GIVEN `labMetrics.cumulativeLayoutShift` is present with a value of `0`
- WHEN the lab metrics section renders
- THEN it MUST display `0`, not an "unavailable" state

### Requirement: Optional Field Data (INP) Presentation

The view MUST present `fieldMetrics` when present on `PageSpeedResult`, including `overallCategory` and `interactionToNextPaintMs` (INP). When `fieldMetrics` is absent entirely (no field data available for the URL, e.g. insufficient real-user traffic), the view MUST display an explicit "no field data available" state rather than omitting the section silently or rendering it identically to a present-but-empty state.

#### Scenario: Field data is present

- GIVEN `PageSpeedResult.fieldMetrics` includes `overallCategory` and `interactionToNextPaintMs`
- WHEN the field data section renders
- THEN it MUST display the overall category and the INP value in milliseconds

#### Scenario: Field data is entirely absent

- GIVEN `PageSpeedResult.fieldMetrics` is absent
- WHEN the field data section renders
- THEN it MUST display an explicit state indicating no field data is available for this URL

### Requirement: Opportunities Table With Estimated Savings

The view MUST render `PageSpeedResult.opportunities` as a table listing each opportunity's `title`, and its estimated savings (`savingsMs`, `savingsBytes`) when present. An opportunity with neither `savingsMs` nor `savingsBytes` MUST still be listed, with its savings columns shown as unavailable rather than as zero.

#### Scenario: Opportunity with both savings fields

- GIVEN an opportunity entry has both `savingsMs` and `savingsBytes`
- WHEN the opportunities table renders that row
- THEN it MUST display both estimated savings values

#### Scenario: Opportunity with no savings fields is still listed

- GIVEN an opportunity entry has neither `savingsMs` nor `savingsBytes`
- WHEN the opportunities table renders
- THEN the entry MUST still appear in the table with its `title`, and its savings columns MUST display as unavailable rather than `0`

### Requirement: PageSpeed API Key Is Never Persisted or Echoed

The optional PageSpeed API key input (mapped to the tool's `apiKey` input) MUST exist only in transient in-memory form for the duration of a single submission. The view MUST NOT write the key to `localStorage`, `sessionStorage`, any cookie, or any URL (query string, path, or fragment). The BFF response for a keyed request MUST NOT echo the key back in any field. No exported artifact (JSON or CSV) produced from a keyed request's result MUST contain the key. No cache key derived from a keyed request MUST embed or be derivable back into the key value.

#### Scenario: Key is not written to browser storage

- GIVEN a user enters a PageSpeed API key and submits a request
- WHEN the request completes
- THEN `localStorage`, `sessionStorage`, and cookies MUST NOT contain the entered key

#### Scenario: Key is not present in the URL

- GIVEN a user enters a PageSpeed API key and submits a request
- WHEN the view constructs the request or updates browser navigation state
- THEN the key MUST NOT appear in any URL query string, path segment, or fragment

#### Scenario: Response does not echo the key

- GIVEN a keyed `analyze_pagespeed` request succeeds
- WHEN the view receives the BFF response
- THEN the response body MUST NOT contain the submitted API key in any field

#### Scenario: Exported result omits the key

- GIVEN a user exports the result of a keyed `analyze_pagespeed` request to JSON or CSV
- WHEN the export is generated
- THEN neither the JSON nor the CSV output MUST contain the API key

#### Scenario: A keyed request is excluded from caching in a way that could leak the key

- GIVEN a request includes an API key
- WHEN the BFF or the view considers this request for caching
- THEN the resulting cache key MUST NOT embed the API key value or any value from which the key can be recovered
