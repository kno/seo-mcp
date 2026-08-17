# Delta for Site Google Credentials

## Purpose

The per-site Google credential model: encrypted-at-rest storage of a site's own OAuth client
and refresh token, the resolution precedence between a site's own credentials and the global env
fallback, the mandatory credential health check that gates whether a site is selectable, the
`connected` / `credentialSource` / `credentialHealth` state surfaced in the `sites` list, and the
containment invariant that no stored secret is ever readable through any BFF response. This
capability does not cover the OAuth authorize/callback round-trip itself
(`google-account-connect-flow` owns that) or the read-only invariants shared with every other
authenticated source (`authenticated-source-contract` owns those).

## ADDED Requirements

### Requirement: Per-Site Credentials Are Stored Encrypted at Rest

A site's `client_id`, encrypted `client_secret`, encrypted `refresh_token`, per-write IV, connected-at
timestamp, and connected Google account label MUST be stored in a dedicated D1 table
(`site_credentials`, added via an additive `CREATE TABLE IF NOT EXISTS` migration). `client_secret` and
`refresh_token` MUST be encrypted with AES-GCM via Web Crypto before the write, using a key imported from
the `DOMAIN_CREDENTIAL_ENCRYPTION_KEY` Worker secret, with a fresh random IV generated per write. Plaintext
`client_secret` or `refresh_token` MUST NOT be written to any column, log line, or intermediate value that
outlives the write operation.

#### Scenario: Refresh token is encrypted before the D1 write

- GIVEN a site's Google account connection completes with a raw refresh token available in memory
- WHEN the credential row is persisted
- THEN the stored `refresh_token` column MUST contain AES-GCM ciphertext and its IV, never the raw token

#### Scenario: A tampered ciphertext fails closed

- GIVEN a `site_credentials` row whose encrypted `refresh_token` ciphertext has been altered after
  the fact (e.g. bit-flipped)
- WHEN the credential is decrypted for use
- THEN decryption MUST fail (AES-GCM authentication failure) and the resolution MUST treat the site as
  having no usable site-level credential, MUST NOT return garbage plaintext, and MUST fall through to the
  global-fallback resolution step

#### Scenario: Each write uses a unique IV

- GIVEN two separate connect operations for two different sites
- WHEN each site's `refresh_token` is encrypted
- THEN the two stored IVs MUST be independently random and MUST NOT be equal

### Requirement: Credential Resolution Precedence Is Site-Then-Global, Never Mixed

For Search Console and Google Ads credential resolution, the system MUST resolve credentials for a
given site as: (1) if the site has a `site_credentials` row, use that site's `client_id`,
`client_secret`, and `refresh_token` as one complete set; (2) otherwise, use the global
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` env secrets as one complete set. A
resolved credential set MUST NOT combine a site-level field with a global-level field (e.g. a site's
`client_id` paired with the global `refresh_token`). Every resolution MUST report which tier answered via
`credentialSource: "site" | "global"`, or `"none"` when neither tier has usable values (e.g. the global env
secrets are also absent).

#### Scenario: A connected site resolves to its own credentials

- GIVEN a site has a `site_credentials` row
- WHEN Search Console or Ads credentials are resolved for that site
- THEN the resolved set MUST be entirely the site's own `client_id`/`client_secret`/`refresh_token`, and
  `credentialSource` MUST be `"site"`

#### Scenario: An unconnected site falls back to the global tier

- GIVEN a site has no `site_credentials` row and the global env secrets are present
- WHEN credentials are resolved for that site
- THEN the resolved set MUST be entirely the global `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REFRESH_TOKEN`,
  and `credentialSource` MUST be `"global"`

#### Scenario: Tiers are never mixed

- GIVEN a site has a `site_credentials` row containing only a subset of fields due to a hypothetical
  partial write
- WHEN credentials are resolved for that site
- THEN the resolution MUST NOT complete a set by substituting a global-tier field for a missing
  site-tier field; it MUST treat the site-tier attempt as unusable and fall through to a complete
  global-tier set instead

#### Scenario: Neither tier has usable credentials

- GIVEN a site has no `site_credentials` row and one or more of the global env secrets is absent
- WHEN credentials are resolved for that site
- THEN `credentialSource` MUST be `"none"`, and no Search Console or Ads call MUST be attempted with a
  partial credential set

### Requirement: Resolved Credentials Must Pass a Health Check Before a Site Is Selectable

Whichever credential tier resolves for a site (`"site"` or `"global"`), that resolved credential set
MUST be validated by a lightweight probe call (confirming Search Console access to that site's exact
property URL) before the site can be selected as the dashboard's active site. A site whose most recent
health result is `"invalid"` MUST NOT be selectable in the dashboard's domain selector. This check is
orthogonal to `connected`: a site with no site-level account can still be `"invalid"` if the global
fallback itself cannot access that site's property, and a site with its own connected account can still
be `"invalid"` if that account's token has been revoked or lacks Search Console access to the property.

Each site's credential health is tracked as one of three states, persisted alongside the resolution tier
so it can be displayed without a live probe on every read:

- `"healthy"` — the most recent probe against the resolved credential set succeeded.
- `"invalid"` — the most recent probe failed (revoked/expired token, or the account lacks access to
  that site's property).
- `"unchecked"` — no probe has ever completed for the currently resolved credential set (e.g. a newly
  added site, or a site whose resolution tier just changed from site to global or vice versa).

The health check runs at exactly three points, and nowhere else:

1. **On connect** — synchronously, immediately after the OAuth callback persists the encrypted
   credential row and before the connect operation reports success to the caller. The probe result
   (healthy or invalid) MUST be persisted and returned in the connect response; a failed probe MUST NOT
   prevent the credential row from being persisted (so the operator can inspect the failure in Manage
   Domains without redoing consent), but MUST mark the site `"invalid"` rather than `"connected"`.
2. **On selection attempt** — synchronously, when the dashboard attempts to make a site the active
   site. If the cached health result for the currently resolved tier is within its freshness window (15
   minutes from the last probe), the cached result is reused and no new probe call is made. If the
   cached result is stale, absent (`"unchecked"`), or belongs to a different resolution tier than the one
   now resolved, a fresh probe MUST run before the selection attempt can succeed. A selection attempt
   against a resolved-but-invalid or resolved-but-unprobed-and-failing credential set MUST be rejected
   and MUST NOT change the active site.
3. **On manual recheck** — synchronously, when an operator explicitly invokes a "Recheck" action for a
   site in Manage Domains, bypassing the 15-minute freshness window. This is the only way to clear a
   cached `"invalid"` result without waiting for the window to lapse or re-running the connect flow, and
   it exists because global-tier failures (e.g. an operator fixed access in the Google Cloud Console)
   have no OAuth callback to re-trigger the check.

No other trigger runs a probe: listing sites (`sites` / Manage Domains render) MUST use only the cached
health value and MUST NOT itself trigger a new probe call, so that viewing the list stays cheap
regardless of how many sites are stale. A dedicated background/periodic health sweep (e.g. a Cron
Trigger) is explicitly out of scope for this change; staleness beyond the 15-minute window is resolved
opportunistically by the next selection attempt or manual recheck, not by a scheduled job.

#### Scenario: A successful connect marks the site healthy

- GIVEN a domain owner completes the OAuth connect flow and the resulting credentials can read that
  site's Search Console property
- WHEN the callback persists the credential row and runs its mandatory health probe
- THEN the site's health MUST be recorded as `"healthy"` and the connect response MUST report success

#### Scenario: A connect with inaccessible property marks the site invalid, not silently connected

- GIVEN a domain owner completes the OAuth consent screen for an account that does not have Search
  Console access to the site's exact property URL
- WHEN the callback runs its mandatory post-persist health probe
- THEN the credential row MUST still be persisted, the site's health MUST be recorded as `"invalid"`,
  and the connect response MUST report the invalid state rather than an unqualified success

#### Scenario: An invalid site cannot be selected

- GIVEN a site's cached health state is `"invalid"`
- WHEN the dashboard attempts to make that site the active site
- THEN the selection attempt MUST be rejected, the active site MUST NOT change, and the rejection MUST
  be distinguishable from a generic tool failure (see `mcp-error-contract`)

#### Scenario: A fresh, healthy cached result is reused on selection without a new probe

- GIVEN a site's cached health result is `"healthy"` and was recorded 3 minutes ago (within the
  15-minute freshness window) for the currently resolved credential tier
- WHEN the dashboard attempts to make that site the active site
- THEN the selection MUST succeed using the cached result, and no new probe call MUST be made to Google

#### Scenario: A stale cached result triggers a fresh probe before selection completes

- GIVEN a site's cached health result was recorded 20 minutes ago (outside the 15-minute freshness
  window)
- WHEN the dashboard attempts to make that site the active site
- THEN a fresh probe MUST run against the currently resolved credential tier before the selection
  attempt resolves, and the site's cached health and the selection outcome MUST reflect that fresh
  result

#### Scenario: A tier change invalidates the cached result even if it is fresh

- GIVEN a site's cached health result is `"healthy"` for `credentialSource: "global"`, recorded 2
  minutes ago, and the site has just been connected to its own Google account (its resolution tier is
  now `"site"`)
- WHEN the dashboard attempts to make that site the active site
- THEN the stale-tier cached result MUST NOT be reused; a fresh probe against the new `"site"` tier MUST
  run before the selection attempt resolves

#### Scenario: Manual recheck clears an invalid state without a new OAuth round-trip

- GIVEN a site is marked `"invalid"` because a global-tier account lacked property access, and an
  operator has since granted that access directly in Search Console
- WHEN the operator invokes the "Recheck" action for that site in Manage Domains
- THEN a fresh probe MUST run immediately regardless of the 15-minute freshness window, and a
  successful probe MUST update the site's health to `"healthy"`, making it selectable again

#### Scenario: Listing sites never triggers a probe

- GIVEN ten sites exist, several with a stale or `"unchecked"` cached health state
- WHEN the `sites` list is requested (e.g. to render Manage Domains)
- THEN the response MUST reflect each site's currently cached health state without making any new probe
  call to Google, even for stale or unchecked entries

#### Scenario: An unchecked site is treated as not-yet-selectable, not as healthy by default

- GIVEN a site has just been added and has never had a credential resolution or health probe run
- WHEN the site is listed
- THEN its health MUST report `"unchecked"`, and it MUST NOT be selectable until a selection attempt
  (or manual recheck) runs a probe that resolves to `"healthy"`

### Requirement: The `sites` List Distinguishes Connected, Provenance, and Health as Separate Fields

The `sites` list output schema MUST expose three independent fields per site, none of which may be
inferred from another: `connected: boolean` (whether the site has its own `site_credentials` row,
independent of whether that row's credentials currently work), `credentialSource: "site" | "global" |
"none"` (which tier the last resolution used), and `credentialHealth: "healthy" | "invalid" | "unchecked"`
(the last probe outcome for the currently resolved tier), plus `credentialHealthCheckedAt: string |
undefined` (ISO timestamp of the last probe, absent when `credentialHealth` is `"unchecked"`). No raw
credential field (`client_id`, `client_secret`, `refresh_token`, or any derived access token) MUST ever
appear in this schema.

#### Scenario: A healthy, connected site reports all four fields consistently

- GIVEN a site has its own connected Google account and its last probe against that account succeeded
  4 minutes ago
- WHEN the site is listed
- THEN it MUST report `connected: true`, `credentialSource: "site"`, `credentialHealth: "healthy"`, and
  a `credentialHealthCheckedAt` timestamp

#### Scenario: A connected but invalid site is visibly distinct from both "connected" and "not connected"

- GIVEN a site has its own `site_credentials` row but the account's refresh token was revoked at Google
  and the last probe failed
- WHEN the site is listed
- THEN it MUST report `connected: true` and `credentialHealth: "invalid"`, a combination that Manage
  Domains MUST render as a distinct "invalid" state, never identical to either a healthy-connected site or
  a never-connected site

#### Scenario: No raw credential value ever appears in the list schema

- GIVEN any site in any combination of `connected`/`credentialSource`/`credentialHealth` states
- WHEN the `sites` list response is inspected
- THEN it MUST NOT contain `client_id`, `client_secret`, `refresh_token`, or any derived access token
  for any site

### Requirement: Disconnect Removes the Credential Row Behind the Existing Confirm Gate

Disconnecting a site's Google account MUST require the same two-step confirmation gate
(`assertConfirmedDelete`) already used for other destructive site operations, and MUST delete the
site's `site_credentials` row entirely (not merely mark it inactive). After disconnect, the site's
`connected` MUST become `false`, its `credentialSource` MUST re-resolve to `"global"` or `"none"`
per the ordinary resolution rule, and any cached health result tied to the deleted site-tier credential
MUST be discarded rather than continuing to report the old site-tier probe outcome.

#### Scenario: Disconnect requires confirmation

- GIVEN a connected site's disconnect action is invoked without having passed through the confirm gate
- WHEN the disconnect request is processed
- THEN it MUST be rejected, and the credential row MUST remain intact

#### Scenario: Confirmed disconnect deletes the row and re-resolves to the global tier

- GIVEN a connected site is disconnected through the confirm gate, and global env credentials are present
- WHEN the disconnect completes
- THEN the `site_credentials` row MUST be deleted, `connected` MUST report `false`, and the next
  resolution for that site MUST use `credentialSource: "global"` with a fresh (`"unchecked"`) health state
  for that tier

### Requirement: No Stored Secret Is Ever Readable Through Any BFF Response

No response produced by any route touching `site_credentials` (list, connect, disconnect, recheck, or
any authenticated tool route using resolved site credentials) MUST contain a site's `client_id`,
`client_secret`, `refresh_token`, or any derived Google access token, in the response body, headers,
error message text, cache key, cache value, export artifact, or log line. This is the per-site extension
of the invariant `authenticated-source-contract` already requires for the global env credential tier.

#### Scenario: A site-tier access token never appears in a Search Console response

- GIVEN a Search Console query resolves to a site's own connected credentials and internally exchanges
  the refresh token for an access token
- WHEN the BFF returns the query result to the browser
- THEN the response body MUST NOT contain the access token, the refresh token, the client secret, or
  the client ID for that site's account

#### Scenario: A health-check failure message is sanitized

- GIVEN a health probe fails because Google's token endpoint returns an error whose text could include
  partial credential detail
- WHEN that failure is surfaced as the site's `credentialHealth: "invalid"` state
- THEN the surfaced message MUST NOT include any credential value, matching
  `authenticated-source-contract`'s existing sanitization rule

## Worker Constraints

- Credential resolution and health-check state MUST NOT depend on any in-memory state surviving across
  requests or isolates; the last-probe result and its timestamp MUST be read from and written to D1, not
  held in a module-level variable.
- The AES-GCM encrypt/decrypt path MUST NOT perform an unbounded read of any external response body, and
  MUST NOT introduce a floating (unawaited) promise around the encrypt/decrypt or the health-probe fetch.
- The health-probe call itself is bounded by the same per-tool timeout discipline `dashboard-bff` already
  requires for authenticated routes; a probe that does not complete in time MUST be treated as `"invalid"`,
  not left pending.
