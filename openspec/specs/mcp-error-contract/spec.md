# MCP Error Contract

## Requirements

### Requirement: Normalized Error Envelope Shape

The BFF MUST translate every failure it surfaces to a caller — transport-level (401, 429, 503) and MCP tool-level (`isError: true`) — into one normalized error envelope containing at minimum: a stable machine-readable `code`, a human-readable `message`, and an optional `retryAfter` field present when the underlying failure indicates a retry delay.

#### Scenario: Transport-level rate limit is normalized

- GIVEN the MCP server responds with 429 and a `retry-after: 60` header
- WHEN the BFF surfaces this failure to the caller
- THEN the response MUST use the normalized envelope with a stable `code` identifying rate limiting
- AND `retryAfter` MUST be present and reflect the retry delay

#### Scenario: Tool-level failure is normalized

- GIVEN the MCP server returns `isError: true` with a plain-text message for a tool call
- WHEN the BFF surfaces this failure to the caller
- THEN the response MUST use the normalized envelope with a stable `code` identifying a tool failure
- AND `retryAfter` MUST be absent unless the underlying failure specifies one

### Requirement: Stable Codes Distinguish Failure Categories

The normalized error envelope MUST distinguish, via distinct `code` values, at least: authentication failure (dashboard gate rejection), authentication failure (upstream 401), rate limiting (upstream 429), upstream unavailability (upstream 503), tool execution failure (`isError`), BFF-side input validation failure, output-schema validation failure, and BFF timeout while awaiting an upstream result.

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

### Requirement: No Raw Upstream Error Detail Leaks Secrets

The normalized error envelope's `message` MUST NOT include the shared `MCP_AUTH_TOKEN`, raw upstream authentication headers, or other secret material, even when the underlying MCP failure text might have included such detail.

#### Scenario: Upstream 401 message is sanitized

- GIVEN the MCP server's 401 response includes a `www-authenticate` header
- WHEN the BFF constructs the normalized error message
- THEN the message MUST describe the failure category without including the raw header value or any credential
