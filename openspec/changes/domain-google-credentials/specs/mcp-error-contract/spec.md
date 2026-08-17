# Delta for MCP Error Contract

## MODIFIED Requirements

### Requirement: Stable Codes Distinguish Failure Categories

The normalized error envelope MUST distinguish, via distinct `code` values, at least: authentication
failure (dashboard gate rejection), authentication failure (upstream 401), rate limiting (upstream 429),
upstream unavailability (upstream 503), tool execution failure (`isError`), BFF-side input validation
failure, output-schema validation failure, BFF timeout while awaiting an upstream result, a site with no
usable Google credential (`credentialSource: "none"`), and a site whose resolved Google credential
(site-tier or global-tier) is invalid — whether caught by the mandatory health check at selection time or
discovered mid-call (e.g. revoked between the last probe and the call). The credential-invalid code MUST
be distinct from the pre-existing generic `tool_failed` code and from the rate-limiting code, since a
credential failure requires operator action while a rate limit requires only waiting.

#### Scenario: Different upstream failures map to different codes

- GIVEN one request fails with an upstream 401 and another fails with an upstream 503
- WHEN the BFF normalizes both
- THEN the two envelopes MUST carry different `code` values

#### Scenario: Gate rejection is distinguishable from an upstream failure

- GIVEN a request is rejected by the dashboard access gate before any MCP call is made
- WHEN the BFF returns the normalized error
- THEN its `code` MUST be distinct from any code used for upstream MCP transport or tool failures

#### Scenario: BFF timeout is distinguishable from upstream unavailability

- GIVEN the BFF's timeout budget elapses while awaiting a long-running `crawl_site` result
- WHEN the BFF returns the normalized error
- THEN its `code` MUST identify a BFF timeout
- AND that `code` MUST be distinct from the code used for an upstream 503

#### Scenario: A site with no usable credential gets its own code

- GIVEN a site resolves to `credentialSource: "none"` because it has no connected account and the
  global env secrets are absent
- WHEN an authenticated-source call is attempted for that site
- THEN the normalized error MUST carry a `code` identifying "no usable Google credential", distinct
  from `tool_failed`, from the rate-limiting code, and from the invalid-credential code

#### Scenario: A health-check-invalid site gets a code distinct from a generic tool failure

- GIVEN a site's resolved credential (site-tier or global-tier) fails the mandatory health check, or
  fails mid-call after previously passing the health check
- WHEN a selection attempt or an authenticated-source call surfaces this failure
- THEN the normalized error MUST carry a `code` identifying an invalid/revoked Google credential,
  distinct from `tool_failed`, from the no-usable-credential code above, and from the rate-limiting
  code

## ADDED Requirements

### Requirement: Credential-Category Codes Never Leak Which Tier or Property Failed in Detail

The `message` accompanying the no-usable-credential and invalid-credential codes MUST describe the
failure category (e.g. "this site has no connected Google account and no fallback is configured", "this
site's Google credential could not be verified") without echoing the raw upstream Google error text, the
resolved tier's client ID, or any other credential fragment, consistent with this contract's existing
no-secret-leak rule for upstream 401 messages.

#### Scenario: An invalid-credential message names the category, not the upstream detail

- GIVEN a health probe fails because Google's token endpoint returns `invalid_grant` with response
  detail that could hint at partial credential state
- WHEN the BFF constructs the normalized error message for the invalid-credential code
- THEN the message MUST describe the failure as an invalid/revoked credential requiring operator
  action, and MUST NOT include the raw `invalid_grant` response body or any credential fragment
