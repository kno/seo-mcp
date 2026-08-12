# Delta for Dashboard BFF

## ADDED Requirements

### Requirement: BFF Holds the Shared MCP Token

The BFF MUST be a Worker distinct from `seo-mcp`, calling `seo-mcp` through a Cloudflare service binding. The BFF MUST hold `MCP_AUTH_TOKEN` (or an equivalent credential) exclusively on the server side. The token MUST NOT appear in any browser-reachable code path, client bundle, or HTTP response body.

#### Scenario: Token stays out of client-visible payloads

- GIVEN the BFF calls `seo-mcp` via its service binding to satisfy a dashboard request
- WHEN the BFF returns a response to the browser
- THEN the response body and headers MUST NOT contain `MCP_AUTH_TOKEN` or any equivalent secret value

#### Scenario: Token travels only over the service binding

- GIVEN the BFF needs to invoke an MCP tool
- WHEN it authenticates to `seo-mcp`
- THEN the credential MUST be transmitted only through the in-process service binding call, not over a public network hop

### Requirement: One JSON Route Per Tool

The BFF MUST expose one JSON-returning route per MCP tool (`health`, `crawl_page`, `crawl_site`, `check_links`, `analyze_pagespeed`), accepting the same logical inputs each tool accepts today (`crawl_page`: `url`; `crawl_site`: `url`, `limit` 1-20 default 10, `concurrency` 1-4 default 4; `check_links`: `url`; `analyze_pagespeed`: `url`, `strategy` `mobile`|`desktop` default `mobile`, optional `apiKey`; `health`: none).

When a new tool is added to `seo-mcp`, the BFF route set MUST be extended in the same change, so the route set never silently lags the tool set.

`search_console_query` is DEFERRED from this change and MUST NOT be routed by it. Unlike the five tools above it depends on an external authenticated data source (a Google refresh token), which raises secret-handling, per-property authorization, and cacheability questions this change does not answer. Its route requires its own change.

#### Scenario: Route validates its own inputs before calling the MCP

- GIVEN a request to the `crawl_site` route with `limit` outside 1-20
- WHEN the BFF processes the request
- THEN the BFF MUST reject the request with a validation error from the normalized error contract before invoking the MCP tool

#### Scenario: Route returns the tool's structured result

- GIVEN a valid request to the `analyze_pagespeed` route
- WHEN the underlying MCP tool call succeeds
- THEN the route MUST return a JSON body containing the validated `PageSpeedResult` structured content

### Requirement: Read-Only Usage and Headroom Source

The BFF MUST expose a read-only view of its own recent upstream call volume, sufficient for a client to show how close the shared rate-limit bucket is to its limit and how old a served result is. This MUST be derived from the BFF's own call accounting, because the Workers rate-limit binding reports only success or failure and never a remaining count (`src/http/auth.ts:104-107`). The BFF MUST NOT present derived headroom as an authoritative upstream figure, since the bucket is shared with every other MCP consumer and the BFF cannot observe their traffic.

#### Scenario: Headroom is reported as an estimate

- GIVEN the BFF has made a number of upstream calls in the current window
- WHEN a client requests usage information
- THEN the BFF MUST return its own observed call volume and the window it covers
- AND MUST mark the figure as an estimate of the shared bucket rather than an exact remaining count

#### Scenario: Served result carries its age

- GIVEN a request is satisfied from the result cache
- WHEN the BFF returns the response
- THEN the response MUST carry the age of the cached result so a client can show staleness

### Requirement: Bounded Handling of Long-Running Tools

The BFF MUST apply an explicit timeout to any tool invocation, set above the tool's documented worst-case latency (e.g. `crawl_site`'s order-of-magnitude ~40s bound), and MUST return a normalized error rather than hang indefinitely or exceed the Worker's CPU/wall-clock limits if the upstream call does not complete in time.

#### Scenario: Slow crawl_site call is bounded

- GIVEN a `crawl_site` request that would exceed the BFF's configured timeout
- WHEN the timeout elapses before the MCP call completes
- THEN the BFF MUST return a normalized timeout error to the caller
- AND MUST NOT leave the request open indefinitely

#### Scenario: Normal-latency call completes within budget

- GIVEN a `crawl_page` request with typical latency
- WHEN the MCP call completes before the timeout
- THEN the BFF MUST return the tool's result normally

### Requirement: Upstream Platform Failures Surface as Normalized Errors

A tool invocation MAY fail from a Cloudflare platform limit rather than from the tool's own logic — notably the per-invocation external subrequest ceiling, which `check_links` can approach because its own fetch budget (`LIMITS.linkCheckSubrequestBudget`) is configured above that ceiling. The BFF MUST surface such a failure as a normalized error identifying an upstream failure, and MUST NOT report it as a successful empty result.

#### Scenario: Upstream exhausts the platform subrequest ceiling

- GIVEN a `check_links` request on a page with many links
- WHEN the upstream Worker invocation fails because it exceeded the platform's external subrequest ceiling
- THEN the BFF MUST return a normalized error from the error contract
- AND MUST NOT return a success response with zero checked links

#### Scenario: Partial link results are not silently presented as complete

- GIVEN a `check_links` result whose `checked` count is lower than the number of links on the page because a bound was reached
- WHEN the BFF returns that result
- THEN the response MUST preserve the tool's own `checked`, `ok`, `broken`, and `errors` counts so the client can tell the probe set was bounded
