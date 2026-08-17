# Delta for Authenticated Source Contract

## MODIFIED Requirements

### Requirement: No Google or MCP Credential Reaches the Browser

No Google credential — whether from the global env tier (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_REFRESH_TOKEN`) or from a site's own encrypted `site_credentials` row (`client_id`,
`client_secret`, `refresh_token`) — and no derived Google OAuth access token, Google Ads developer token,
OAuth `code`, OAuth `state`, or `MCP_AUTH_TOKEN` MUST appear in any browser-reachable surface produced by
an authenticated-source view or its supporting BFF route: not in a response body, not in a response
header, not in a redirect URL or fragment, not in an error message text, not in an export artifact (JSON
or CSV), not in a cache key, not in a cache value, and not in a log line intended for client consumption.
This extends the existing `bff-result-cache` no-cache-key-from-secret rule and the existing `result-export`
no-secret rule to every authenticated source and every credential tier, not only the global env tier and
not only `analyze_pagespeed`.

#### Scenario: Access token never reaches the response body

- GIVEN a dashboard request triggers a Search Console call that internally exchanges a refresh token
  (site-tier or global-tier) for a Google access token
- WHEN the BFF returns the result to the browser
- THEN the response body MUST NOT contain the access token, the refresh token, the client secret, or
  the client ID, regardless of which tier answered

#### Scenario: Credential failure message is sanitized

- GIVEN the Google token exchange fails and the underlying error text could include a client secret or
  refresh token fragment
- WHEN the BFF surfaces this failure to the caller
- THEN the surfaced message MUST NOT include the credential value, matching the sanitization rule
  already required for upstream authentication headers by `mcp-error-contract`

#### Scenario: No credential in a cache key or value

- GIVEN an authenticated-source result is cached
- WHEN the cache key and cache value are inspected
- THEN neither MUST be derived from or contain the Google refresh token (site-tier or global-tier),
  access token, Ads developer token, client secret, or `MCP_AUTH_TOKEN`

#### Scenario: No credential in an export

- GIVEN a user exports an authenticated-source result to JSON or CSV
- WHEN the export is generated
- THEN it MUST NOT contain any Google credential (either tier) or `MCP_AUTH_TOKEN`, extending the
  `result-export` no-secret-material requirement to authenticated sources

#### Scenario: OAuth code and state never reach a browser-visible log or export

- GIVEN a site's connect flow has completed, generating an authorization `code` and a signed `state`
  value during the round-trip
- WHEN any subsequent authenticated-source response, export, or client-consumable log for that site is
  produced
- THEN neither the `code` nor the `state` value MUST appear in it

### Requirement: Credential Failure Is Distinguishable From Quota Exhaustion and From a Genuine Empty Result

A Google credential failure (expired or revoked refresh token, missing/misconfigured credentials, or a
resolved credential set that fails the mandatory health check defined by `site-google-credentials` —
each of which requires operator action such as reconnecting, granting property access, or rotating a
secret) MUST be distinguishable from Google-side quota exhaustion (which requires waiting) and from a
genuine data-absent result (the query ran successfully and returned zero rows). This requirement now
covers both credential tiers: a site resolving to its own account and a site resolving to the global
fallback must both be able to report a credential failure distinctly, and a site rejected at selection
time for failing its health check MUST be distinguishable from a site whose credentials passed the
health check but later failed mid-call (e.g. revoked between the last probe and the call).

Before an authenticated view ships past this contract, the system MUST implement one of: (a) distinct
machine-readable codes for credential failure versus quota exhaustion versus tool failure versus
health-check-gated non-selectability, or (b) a documented and tested text-classification rule applied to
the upstream error message that maps it to one of these categories. Whichever is chosen, when the
failure's category cannot be determined by that mechanism, the system MUST default to treating it as a
non-retryable operator-action failure rather than silently retrying or presenting it as transient.

#### Scenario: Missing credentials render a distinct "not configured" state

- GIVEN a site resolves to `credentialSource: "none"` (no site-level account and the global env secrets
  are absent)
- WHEN a user triggers an authenticated-source query for that site
- THEN the view MUST render a "not configured" state distinct from both an error state and an
  empty-result state

#### Scenario: A health-check-gated site cannot be selected in the first place

- GIVEN a site's cached `credentialHealth` is `"invalid"`
- WHEN a user attempts to select that site as active
- THEN the selection attempt MUST be rejected with a code distinguishable from a generic tool failure,
  and no authenticated-source query MUST be attempted against that site while it remains unselected

#### Scenario: Credential failure surfaces as an operator-action state, not a retry-now state

- GIVEN the Google token exchange fails because the refresh token was revoked, for either a site-tier
  or global-tier credential
- WHEN the failure is surfaced to the view
- THEN the view MUST present it as requiring operator action (e.g. reconnecting the account, or fixing
  property access), MUST NOT offer an immediate-retry affordance implying the failure is transient, and
  MUST NOT be presented identically to a quota-exhaustion failure

#### Scenario: Quota exhaustion surfaces as a wait-and-retry state

- GIVEN the upstream source rejects a call because its own quota is exhausted
- WHEN the failure is surfaced to the view
- THEN the view MUST present it as a wait state distinct from the credential-failure state, and MUST
  disable resubmission consistent with the rate-limit handling `quota-visibility` and `dashboard-shell`
  already require for the MCP bucket's 429 case

#### Scenario: A genuine empty result is never presented as a failure

- GIVEN an authenticated-source query executes successfully and the upstream source returns zero rows
  for the requested range
- WHEN the view renders the result
- THEN it MUST render the empty-result state, and MUST NOT render either the credential-failure state
  or the quota-exhaustion state

#### Scenario: Undetermined failure class defaults to non-retryable

- GIVEN an upstream failure's text does not clearly match any classification rule the system implements
- WHEN the failure is surfaced to the view
- THEN the system MUST default to a non-retryable, operator-action presentation rather than offering an
  unqualified immediate-retry action

## ADDED Requirements

### Requirement: Every Authenticated Result Carries Credential Provenance

Every result produced by a Search Console or Google Ads tool call MUST carry a `credentialSource: "site"
| "global"` field identifying which credential tier answered the call, so the reader always knows whose
account produced the data rather than silently assuming it was the site's own account. This field MUST
be present on every authenticated result, not only on error paths.

#### Scenario: A site-tier result reports its provenance

- GIVEN a site's own connected Google account answers a Search Console query
- WHEN the result is returned to the caller
- THEN it MUST carry `credentialSource: "site"`

#### Scenario: A global-fallback result reports its provenance rather than implying ownership

- GIVEN a site with no connected account is queried and the global env tier answers instead
- WHEN the result is returned to the caller
- THEN it MUST carry `credentialSource: "global"`, and the view MUST NOT present the data as if it came
  from the site owner's own account

### Requirement: Google Ads Tools Resolve Credentials From the Active Site, Not an Explicit Parameter

`get_keyword_metrics` and `discover_keywords`, when invoked through the dashboard, MUST resolve their
Google credentials from the currently selected active site's resolved credential tier (per
`site-google-credentials`'s precedence rule), not from a new explicit `siteUrl` parameter on the tool
call itself. `cluster_keywords` requires no Google credential and MUST remain unaffected by this
requirement.

#### Scenario: An Ads call binds to the active site's resolved credentials

- GIVEN a dashboard session has site A selected as active, and site A resolves to its own connected
  Google account
- WHEN `get_keyword_metrics` or `discover_keywords` is invoked from the dashboard
- THEN the BFF MUST use site A's resolved credential tier for the underlying Ads call, without the
  tool call itself carrying a `siteUrl` parameter

#### Scenario: cluster_keywords is unaffected

- GIVEN any active site selection state, including no site selected
- WHEN `cluster_keywords` is invoked
- THEN it MUST execute without requiring, resolving, or depending on any Google credential
