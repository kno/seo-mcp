# Dashboard Access Gate

## Requirements

### Requirement: Authentication Precedes Any MCP Call

The BFF MUST authenticate every incoming request before making any call to `seo-mcp` or performing any work that would spend the shared rate-limit bucket or the shared token. Authentication MUST be independent of, and MUST NOT be deferred to, the server's future OAuth work.

#### Scenario: Unauthenticated request is rejected before upstream work

- GIVEN a request to any BFF tool route lacking valid dashboard credentials
- WHEN the BFF processes the request
- THEN the BFF MUST reject it with an authentication error
- AND MUST NOT invoke the MCP service binding or consume any shared rate-limit budget

#### Scenario: Authenticated request proceeds

- GIVEN a request carrying valid dashboard credentials
- WHEN the BFF processes the request
- THEN the BFF MUST proceed to route and cache handling

### Requirement: Credential Comparison Is Timing-Safe

The BFF MUST compare presented dashboard credentials against the expected secret using a timing-safe comparison mechanism, consistent with the existing MCP bearer-token comparison approach (SHA-256 digest plus constant-time compare).

#### Scenario: Incorrect credential is rejected without timing leakage

- GIVEN a request presents an incorrect credential value
- WHEN the BFF validates it
- THEN the BFF MUST reject the request
- AND the comparison MUST use a constant-time mechanism rather than a short-circuiting string comparison

### Requirement: Dashboard Credential Never Reaches the Browser via Server Response

Whatever mechanism the access gate uses (e.g. a signed session token), the underlying shared dashboard secret MUST be held server-side only. The gate MUST NOT require the browser to hold or resend the raw shared secret on every request once a session has been established.

#### Scenario: Session artifact does not embed the raw secret

- GIVEN a dashboard user successfully authenticates
- WHEN the BFF issues a session artifact (e.g. a cookie) to the browser
- THEN that artifact MUST NOT contain the raw shared dashboard secret in a recoverable form

#### Scenario: Gate mechanism is independent of server OAuth state

- GIVEN the server's OAuth support is not yet implemented
- WHEN a dashboard user authenticates against the BFF's access gate
- THEN authentication MUST succeed or fail based solely on the gate's own credential check, not on any server OAuth state
