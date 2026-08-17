# Delta for Dashboard BFF

## ADDED Requirements

### Requirement: OAuth Connect Routes Are a Second, Explicitly Enumerated Route Class

Beyond the one-JSON-route-per-tool class this capability already defines, the BFF MUST expose a second,
distinct route class for the Google account connect flow: an authorize route, a callback route, a
disconnect route, and a manual recheck route. Each MUST be an explicitly enumerated route registration,
never reachable through the generic `/api/tools/{tool}` dispatch path and never matched by a wildcard or
pattern. None of these four routes is a proxy for an MCP tool call; they exist to manage the
`site_credentials` row and its cached health state directly.

#### Scenario: The authorize route is not an MCP tool proxy

- GIVEN the BFF's route table
- WHEN the authorize route is inspected
- THEN it MUST be registered as its own explicit route handler, distinct from the tool-proxy route
  registration mechanism used for `crawl_page`, `analyze_pagespeed`, etc.

#### Scenario: A disconnect request cannot be issued through the generic tool-call path

- GIVEN a request is made to the generic `/api/tools/{tool}` path naming something resembling the
  disconnect operation
- WHEN the BFF handles the request
- THEN it MUST NOT dispatch it as a disconnect; disconnect is reachable only via its own explicitly
  registered route

### Requirement: Authenticated Tool Routes Carry a Timeout Budget Above Token Exchange Plus Tool Latency

Any BFF route dispatching an authenticated Search Console or Google Ads tool call MUST apply an explicit
timeout set above the combined worst case of a Google token exchange plus the tool's own documented
worst-case latency (at least 25 seconds, per the tool's Search Console call budget plus token-exchange
overhead), consistent with this capability's existing bounded-handling requirement for long-running
tools. A route that also performs a mandatory health probe (the post-connect probe, or a selection-time
probe triggered by a stale cache) MUST bound that probe with its own explicit timeout and MUST treat a
probe that does not complete in time as a health-check failure, not as a hang.

#### Scenario: A slow token exchange plus tool call is bounded

- GIVEN a Search Console call for a connected site whose token exchange plus upstream query would
  exceed the route's configured timeout
- WHEN the timeout elapses before the combined operation completes
- THEN the BFF MUST return a normalized timeout error, distinguishable from a credential failure or a
  quota failure

#### Scenario: A hanging health probe is treated as invalid, not left pending

- GIVEN a selection-time health probe does not receive a response from Google within its own bounded
  timeout
- WHEN that timeout elapses
- THEN the BFF MUST record the site's health as `"invalid"` for this attempt and MUST NOT leave the
  selection attempt pending indefinitely

## MODIFIED Requirements

### Requirement: One JSON Route Per Tool

The BFF MUST expose one JSON-returning route per MCP tool it proxies, accepting the same logical inputs
each tool accepts today. This now includes `search_console_query`, `find_striking_distance_keywords`,
`find_low_ctr_opportunities`, `get_keyword_metrics`, and `discover_keywords` (all resolving Google
credentials per `site-google-credentials`'s precedence and health-check rules), alongside the
previously routed tools (`health`, `crawl_page`, `crawl_site`, `check_links`, `analyze_pagespeed`) and
the read-only insight tools already routed by `dashboard-insights`. `get_keyword_metrics` and
`discover_keywords`, when routed through the dashboard, MUST resolve their Google credentials from the
currently selected active site rather than accepting a `siteUrl` parameter on the route itself.
`cluster_keywords` requires no Google credential and its existing route is unaffected by this change.

When a new tool is added to `seo-mcp`, the BFF route set MUST be extended in the same change, so the
route set never silently lags the tool set.

#### Scenario: Route validates its own inputs before calling the MCP

- GIVEN a request to the `crawl_site` route with `limit` outside 1-20
- WHEN the BFF processes the request
- THEN the BFF MUST reject the request with a validation error from the normalized error contract
  before invoking the MCP tool

#### Scenario: Route returns the tool's structured result

- GIVEN a valid request to the `analyze_pagespeed` route
- WHEN the underlying MCP tool call succeeds
- THEN the route MUST return a JSON body containing the validated `PageSpeedResult` structured content

#### Scenario: An Ads route resolves credentials from the active site, not a route parameter

- GIVEN a dashboard session has a site selected as active
- WHEN the `get_keyword_metrics` or `discover_keywords` route is called
- THEN the BFF MUST resolve Google credentials from that active site's resolved tier, and the route
  MUST NOT accept or require a `siteUrl` parameter to determine which credentials to use
