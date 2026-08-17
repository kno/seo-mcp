# Delta for Google Account Connect Flow

## Purpose

The OAuth authorize/callback round-trip that lets a domain owner connect their own Google account to a
site: `state` CSRF binding, single-use and expiry semantics, `redirect_uri` registration, code-exchange
failure handling, and the rule that no credential material appears in any redirect URL, response, or log.
This capability owns the round-trip itself; the resulting credential storage, resolution precedence, and
health-check gating are owned by `site-google-credentials`.

## ADDED Requirements

### Requirement: The Authorize Route Mints a Signed, Single-Use, Expiring State Token

The authorize route MUST mint a signed `state` token binding the OAuth round-trip to the current
dashboard session and the target `siteUrl` before redirecting to Google's consent screen. The `state`
token MUST be single-use (rejected if presented a second time) and MUST expire after a bounded window
short enough to cover a normal consent flow but reject a delayed replay. The `siteUrl` MUST be a site
already known to the dashboard (present in the `sites` table); the authorize route MUST reject a request
naming an unknown site before minting any `state` or redirecting to Google.

#### Scenario: A valid authorize request redirects to Google with a bound state

- GIVEN a request to the authorize route for a known `siteUrl`, made from an authenticated dashboard
  session
- WHEN the route processes the request
- THEN it MUST redirect to Google's OAuth consent screen with a `state` parameter that is signed and
  bound to this session and this `siteUrl`

#### Scenario: An authorize request for an unknown site is rejected before redirecting

- GIVEN a request to the authorize route naming a `siteUrl` absent from the `sites` table
- WHEN the route processes the request
- THEN it MUST reject the request with a normalized error and MUST NOT redirect to Google or mint a
  `state` token

### Requirement: The Callback Route Rejects Unbound, Replayed, or Expired State

The callback route MUST verify the `state` parameter's signature, session binding, and expiry before
exchanging the authorization `code`. A `state` that is unsigned/tampered, bound to a different session,
already consumed once, or past its expiry window MUST be rejected, and the code exchange MUST NOT be
attempted in any of these cases.

#### Scenario: A tampered state is rejected

- GIVEN a callback request arrives with a `state` value whose signature does not verify
- WHEN the callback route processes the request
- THEN it MUST reject the request without attempting the code exchange, and MUST NOT persist any
  credential row

#### Scenario: A session-mismatched state is rejected

- GIVEN a callback request arrives with a validly signed `state` that was bound to a different
  dashboard session than the one presenting the callback
- WHEN the callback route processes the request
- THEN it MUST reject the request without attempting the code exchange

#### Scenario: A replayed state is rejected on its second use

- GIVEN a `state` token has already been consumed once by a prior successful callback
- WHEN a second callback request presents that same `state` value
- THEN it MUST be rejected as a replay, and MUST NOT trigger a second code exchange or credential write

#### Scenario: An expired state is rejected

- GIVEN a `state` token's expiry window has elapsed before the callback arrives
- WHEN the callback route processes the request
- THEN it MUST reject the request as expired, without attempting the code exchange

### Requirement: The Authorization Code Is Exchanged Server-Side and the Refresh Token Is Never Echoed

The callback route MUST exchange the authorization `code` for a refresh token entirely server-side (via
a direct call to Google's token endpoint), and the resulting refresh token MUST be encrypted and persisted
directly into `site_credentials` without ever being included in the callback's own response body, a
redirect URL or fragment, a response header, browser storage, or any log line. The `code` value itself
MUST also never appear in any log line or be persisted anywhere once the exchange completes.

#### Scenario: The refresh token never appears in the callback's redirect

- GIVEN a successful code exchange yields a refresh token
- WHEN the callback route redirects the browser back to Manage Domains
- THEN the redirect URL (including any query string or fragment) MUST NOT contain the refresh token,
  client secret, or authorization code

#### Scenario: The authorization code is not logged

- GIVEN a callback request carries a `code` value
- WHEN the callback route processes and exchanges it
- THEN no log line produced by this processing MUST contain the raw `code` value

### Requirement: Code-Exchange Failures Are Classified, Not Echoed Verbatim

When Google's token endpoint rejects the code exchange (invalid code, expired code, revoked client, or
any other token-endpoint error), the callback route MUST classify the failure into a normalized error
category and MUST NOT surface the upstream error response body or headers verbatim to the browser, since
that text could include partial credential detail. No credential row MUST be persisted when the code
exchange itself fails.

#### Scenario: A rejected code exchange surfaces a normalized error, not raw upstream text

- GIVEN Google's token endpoint rejects the authorization code as invalid
- WHEN the callback route surfaces this failure
- THEN the response MUST use a normalized error category and MUST NOT include the upstream response
  body or header text verbatim

#### Scenario: A failed code exchange leaves no partial credential row

- GIVEN the code exchange fails before a refresh token is ever obtained
- WHEN the callback route finishes handling the failure
- THEN no `site_credentials` row MUST be created or updated for that site as a result of this attempt

### Requirement: The Authorize and Callback Routes Are Explicitly Enumerated, Not Reachable by Pattern

Per `dashboard-bff`'s allowlist principle, the authorize route, the callback route, the disconnect
route, and the manual recheck route MUST each be an explicit, individually enumerated route registration.
None of these four MUST be reachable through a wildcard or pattern-matched route, and none MUST be
dispatched through the ordinary MCP tool-call path, since they are not MCP tool proxies.

#### Scenario: The callback route is not reachable via the generic tool-call path

- GIVEN the BFF's route table
- WHEN the callback route's path is inspected
- THEN it MUST be an explicitly registered non-tool route, and a request to that same path MUST NOT be
  dispatchable through the generic `/api/tools/{tool}` handling used for MCP tool proxies

## Worker Constraints

- The authorize and callback routes MUST NOT introduce module-level mutable state for tracking in-flight
  `state` tokens; single-use enforcement MUST be derived from a persisted, request-scoped check (e.g. a
  D1 row or KV entry marked consumed), not an in-memory set that would not survive isolate recycling and
  would not work across multiple isolates in any case.
- The code exchange and the mandatory post-connect health probe (see `site-google-credentials`) MUST be
  bounded by an explicit timeout consistent with `dashboard-bff`'s bounded-handling requirement for
  long-running upstream calls.
