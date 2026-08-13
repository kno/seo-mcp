# Delta for Broken Links View

## MODIFIED Requirements

### Requirement: Bounded Probe Set Is Named, Not Implied Exhaustive

The panel MUST show an explicit indicator that the probe set was truncated whenever
`LinkCheckResult.truncated` is `true`, naming the server's `maxLinkChecks` limit and the total
number of links actually found on the page (`linksFound`). `checked === maxLinkChecks` alone MUST
NOT be used to infer truncation: a page with exactly `maxLinkChecks` links and zero truncation
(`truncated: false`) is indistinguishable from a truncated page by count alone, and MUST NOT show a
bound indicator.

#### Scenario: Truncated result shows a bound indicator naming both figures

- GIVEN a `LinkCheckResult` with `truncated: true`, `checked: 40`, and `linksFound: 127`
- WHEN the panel renders
- THEN it MUST show an explicit indicator that the probe set was capped at 40 links out of 127 found,
  not presented as exhaustive

#### Scenario: Untruncated result at the exact limit shows no bound indicator

- GIVEN a `LinkCheckResult` with `truncated: false`, `checked: 40`, and `linksFound: 40`
- WHEN the panel renders
- THEN it MUST NOT show a bound indicator, even though `checked` equals the server's `maxLinkChecks`
  limit

#### Scenario: Untruncated result below the limit shows no bound indicator

- GIVEN a `LinkCheckResult` with `truncated: false` and `checked` below the server's link-check limit
- WHEN the panel renders
- THEN it MUST NOT claim the probe set was bounded by that limit
