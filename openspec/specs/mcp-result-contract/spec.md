# MCP Result Contract

## Requirements

### Requirement: Output Schema Per Tool

Each MCP tool (`health`, `crawl_page`, `crawl_site`, `check_links`, `analyze_pagespeed`) MUST declare an output schema describing the shape of its `structuredContent`. The schema for each tool MUST be derived from the tool's existing exported result type (`PageAnalysis`, `SiteCrawlResult`/`SitePageAnalysis`/`DomainSummary`/`CrawlPolicy`/`LinkGraphSummary`/`DomainCategory`/`DuplicateGroup`, `LinkCheckResult`/`LinkProbe`, `PageSpeedResult`, or the `health` shape) rather than a newly invented shape.

Every output schema's root MUST be an object. A non-object root causes the installed MCP SDK to apply a legacy `{result:…}` wire wrap, changing the payload shape clients receive.

#### Scenario: Tool declares a schema on registration

- GIVEN the MCP server registers the `crawl_page` tool
- WHEN a client inspects the tool's metadata
- THEN an output schema for `PageAnalysis` MUST be present

#### Scenario: Schema covers optional fields

- GIVEN a tool result type has optional fields (e.g. `analyze_pagespeed` fields absent for a failed sub-check)
- WHEN the schema is evaluated against a result missing those fields
- THEN validation MUST succeed without requiring the optional fields

#### Scenario: Nested collection results validate

- GIVEN a `check_links` result whose `results` array contains `LinkProbe` entries in each of the `ok`, `broken`, and `error` states
- WHEN the server validates the result against the `check_links` output schema
- THEN validation MUST succeed for all three states
- AND the state-dependent optional fields (`status`, `redirects`, `error`) MUST NOT be required unconditionally

### Requirement: Structured Content Runtime Validation

Before a tool response is returned, the server MUST validate the tool's result against its declared output schema and MUST NOT construct `structuredContent` via an unchecked type cast (e.g. `as Record<string, unknown>`).

#### Scenario: Valid result passes validation

- GIVEN a tool computed a result matching its declared schema
- WHEN the server prepares the response
- THEN `structuredContent` MUST contain the validated result
- AND no unchecked cast MUST be present in the code path

#### Scenario: Result violating its own schema is not silently shipped

- GIVEN a tool result that does not conform to its declared output schema (e.g. due to an internal bug)
- WHEN the server prepares the response
- THEN the server MUST surface this as a tool failure using the normalized error contract rather than returning invalid `structuredContent`

### Requirement: Published Result Types Module

The server codebase MUST publish a single module that re-exports the result types for all five tools (`PageAnalysis`, `SiteCrawlResult` and its nested types, `LinkCheckResult` and `LinkProbe`, `PageSpeedResult`, `Strategy`, and the `health` result type), so that external clients (including the BFF and dashboard) can import compile-time types from one source instead of duplicating type definitions.

#### Scenario: Client imports a tool's result type

- GIVEN a consumer needs the type of `crawl_site`'s result
- WHEN it imports from the published result-types module
- THEN it MUST receive a type identical to the one the server itself uses to produce that tool's `structuredContent`

#### Scenario: Type module has no duplicate, drifting definitions

- GIVEN the result-types module is published
- WHEN a tool's underlying result interface changes
- THEN the published module MUST reflect that change without requiring a separate manually maintained copy
