# Result Export

## Requirements

### Requirement: JSON Export Is a Faithful Representation of the Rendered Result

Any view offering export MUST provide a JSON export that is a faithful representation of the tool result the view rendered: the exported JSON MUST NOT drop, rename, or reshape fields present in the underlying published result type, and MUST NOT introduce fields not present in that result.

#### Scenario: JSON export matches the rendered result's fields

- GIVEN a view has rendered a `PageSpeedResult` (or `SiteCrawlResult`, `PageAnalysis`, `LinkCheckResult`) for the current data
- WHEN the user exports that result to JSON
- THEN the exported JSON MUST contain the same fields, with the same values, as the result the view rendered

#### Scenario: Export reflects the currently rendered result, not a stale one

- GIVEN a view has refreshed and now renders a newer result than a previous export
- WHEN the user exports again
- THEN the new export MUST reflect the currently rendered result, not the previously exported one

### Requirement: CSV Export of Nested Results Uses a Defined, Documented Flattening

CSV export of a nested result (notably `SiteCrawlResult`, whose `pages` array nests `SitePageAnalysis`) MUST use a flattening rule that is documented and stable across exports of the same result shape: the same input MUST always produce the same column set and the same per-row mapping. The flattening MUST NOT silently drop data present in the source result; any field that cannot be represented in the chosen flat column set MUST either be included as a column or be explicitly noted as omitted in an accompanying provenance indicator (see the truncation-provenance requirement below). The exact column layout (a single flat per-page sheet versus another documented shape) is an implementation decision left open by this requirement; only the no-silent-loss and stability invariants are binding.

#### Scenario: Repeated export of the same result produces the same columns

- GIVEN a `SiteCrawlResult` is exported to CSV twice without the underlying data changing
- WHEN the two exports are compared
- THEN both MUST have the same column set in the same order

#### Scenario: Nested per-page data appears in the CSV

- GIVEN a `SiteCrawlResult` with multiple `pages` entries, each with a `result` containing issue data
- WHEN the CSV export is generated
- THEN each page MUST be represented in the output, and issue-derived data for that page MUST be present in some column rather than silently omitted

#### Scenario: A field with no defined column is explicitly noted, not dropped silently

- GIVEN the chosen flat column set does not include a raw field present in the source result
- WHEN the CSV export is generated
- THEN the omission MUST be documented in the export's accompanying provenance indicator, and MUST NOT be a silent, unstated loss

### Requirement: Bounded or Truncated Results Carry Their Provenance Into the Export

Any export (JSON or CSV) of a result that was bounded or truncated — including but not limited to `SiteCrawlResult.outputBytes` reaching `maxSiteOutputBytes`, a capped sample list (e.g. `DomainCategory.sample`, `DuplicateGroup.sample`, `orphanPages.sample`), or a `check_links` result whose `checked` count reflects a probe-bound rather than the full link set — MUST carry an explicit marker of that bound or truncation in the exported artifact. An exported file MUST NOT be indistinguishable from an export of a complete, unbounded result when the source result was in fact bounded.

#### Scenario: JSON export of a truncated crawl includes a truncation marker

- GIVEN a `SiteCrawlResult` whose `outputBytes` is at the `maxSiteOutputBytes` cap
- WHEN the result is exported to JSON
- THEN the exported JSON MUST include a marker indicating the result may have been truncated by the output-size cap

#### Scenario: CSV export of a sampled category includes a sample marker

- GIVEN a `SiteCrawlResult` where `summary.duplicateTitles` contains a group whose `sample` is capped below its `count`
- WHEN the result is exported to CSV
- THEN the export MUST indicate, for that group, that the listed URLs are a sample rather than the complete set

#### Scenario: An unbounded, complete result exports without a truncation marker

- GIVEN a result whose relevant counts and sample sizes are equal (nothing was capped)
- WHEN the result is exported
- THEN the export MUST NOT display a truncation or sample marker implying data loss that did not occur

### Requirement: No Secret Material in Any Export

No export (JSON or CSV), for any tool result, MUST contain `MCP_AUTH_TOKEN`, any PageSpeed API key, or any other credential or secret value, regardless of whether the underlying request used one.

#### Scenario: PageSpeed export excludes the API key

- GIVEN a user exports the result of an `analyze_pagespeed` request that used an API key
- WHEN the export is generated
- THEN neither the JSON nor the CSV output MUST contain the API key

#### Scenario: No export ever contains the shared MCP token

- GIVEN any export of any tool result
- WHEN the export is generated
- THEN it MUST NOT contain `MCP_AUTH_TOKEN` or any value derived from it

### Requirement: Export Is Never Blocked by a Bound or Truncation

A user MUST be able to export a bounded or truncated result. The presence of a truncation or sample marker MUST NOT prevent the export action from completing; it only adds provenance to the exported artifact.

#### Scenario: Export succeeds despite truncation

- GIVEN a `SiteCrawlResult` reached its output-size cap
- WHEN the user requests a JSON or CSV export
- THEN the export MUST complete successfully and MUST include the required truncation marker
