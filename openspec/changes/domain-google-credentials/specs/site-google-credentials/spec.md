# Delta for Site Google Credentials

## Purpose

The per-site Google credential model: encrypted-at-rest storage of a site's own refresh token
(the OAuth client itself is app-level and shared — see the client_secret note below), the
resolution precedence between a site's own credentials and the global env fallback, the mandatory
credential health check that gates whether a site is selectable, the `credential: { tier,
accountLabel, accountKey, health: { searchConsole, googleAds } }` state surfaced in the `sites`
list (five presented states per source — `not_connected` / `unchecked` / `stale` / `healthy` /
`unhealthy`, only `healthy`/`unhealthy` ever persisted), and the containment invariant that no
stored secret is ever readable through any BFF response. This
capability does not cover the OAuth authorize/callback round-trip itself
(`google-account-connect-flow` owns that) or the read-only invariants shared with every other
authenticated source (`authenticated-source-contract` owns those).

## ADDED Requirements

### Requirement: Per-Site Credentials Are Stored Encrypted at Rest

A site's `client_id` (plaintext — it only records which app client minted the token, never a secret
in its own right), encrypted `refresh_token`, per-write IV, connected-at timestamp, and connected
Google account label MUST be stored in a dedicated D1 table (`site_credentials`, added via an
additive `CREATE TABLE IF NOT EXISTS` migration). `client_secret` is deliberately NOT stored
per-site: every connected account shares the app's own single OAuth client, so a per-site
`client_secret` would either duplicate the highest-value secret across every row or imply a
bring-your-own-OAuth-client feature this change does not offer. `refresh_token` MUST be encrypted
with AES-GCM via Web Crypto before the write, using a key imported from the
`DOMAIN_CREDENTIAL_ENCRYPTION_KEY` Worker secret, with a fresh random IV generated per write, and an
`additionalData` binding the ciphertext to its own site row (so lifting one site's ciphertext onto
another's row fails to decrypt rather than silently succeeding). Plaintext `refresh_token` MUST NOT
be written to any column, log line, or intermediate value that outlives the write operation.

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
given site as: (1) if the site has a `site_credentials` row, use that site's own `client_id` and
`refresh_token`, paired with the app's single global `GOOGLE_CLIENT_SECRET` (never a per-site
secret — see "Per-Site Credentials Are Stored Encrypted at Rest" above); (2) otherwise, use the
global `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` env secrets as one
complete set. A resolved credential set MUST NOT pair a site's `refresh_token` with a DIFFERENT
site's `client_id`, or complete a partial site-tier attempt with a global-tier field for a field
the site row is actually supposed to supply (`client_id`/`refresh_token`). Every resolution MUST
report which tier answered via `credentialSource: "site" | "global"`, or `"none"` when neither tier
has usable values (e.g. the global env secrets are also absent).

#### Scenario: A connected site resolves to its own credentials

- GIVEN a site has a `site_credentials` row
- WHEN Search Console or Ads credentials are resolved for that site
- THEN the resolved set MUST use the site's own `client_id`/`refresh_token` (paired with the shared
  global `client_secret`), and `credentialSource` MUST be `"site"`

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
health result is `"unhealthy"` MUST NOT be selectable in the dashboard's domain selector. This check is
orthogonal to `credential.tier`: a site with no site-level account (`tier: "global"`) can still be `"unhealthy"` if the global
fallback itself cannot access that site's property, and a site with its own connected account can still
be `"unhealthy"` if that account's token has been revoked or lacks Search Console access to the property.

Only two states are ever PERSISTED per `(site, source)` row, `source` being `"search-console"` or
`"google-ads"`:

- `"healthy"` — the most recent probe (or the most recent real authenticated call, which counts as
  stronger evidence than a probe) against the resolved credential set succeeded.
- `"unhealthy"` — the most recent probe or real call failed (revoked/expired token, the account lacks
  access to that site's property, or — for Ads — zero or more than one accessible customer), with a
  `reason` recorded alongside it.

Three further states are DERIVED at read time and never written to D1: `"not_connected"` (no tier
resolved credentials at all), `"unchecked"` (a tier resolved but no health row exists yet for it, or
the existing row's `accountKey` no longer matches — a stale-tier row is treated as absent, not
reused), and `"stale"` (a health row exists and matches the current tier, but its TTL has elapsed).
`"checking"` (a probe in flight) is a response/UI-only value and is never persisted either — a
Worker isolate can die mid-probe, and a persisted `"checking"` would strand a site permanently
un-selectable with no actor left to clear it.

A `healthy`/`unhealthy` verdict's TTL is `CREDENTIAL_HEALTH_TTL_SECONDS` (6 hours) — long, because
Search Console/Ads access changes on a monthly cadence, not per session. The one exception: a probe
that failed for a transport reason (timeout, network error — inconclusive, not evidence of a bad
credential) is persisted as `"unhealthy"` with a much shorter 60-second TTL, so it self-heals on the
very next attempt instead of parking the site unhealthy for 6 hours on a transient blip.

The health check runs at exactly three points, and nowhere else:

1. **On connect** — synchronously, immediately after the OAuth callback persists the encrypted
   credential row and before the connect operation reports success to the caller. The probe result
   (healthy or unhealthy) MUST be persisted and returned in the connect response; a failed probe MUST
   NOT prevent the credential row from being persisted (so the operator can inspect the failure in
   Manage Domains without redoing consent), but MUST mark the site `"unhealthy"` rather than a bare
   "connected".
2. **On selection attempt** — synchronously, when the dashboard attempts to make a site the active
   site, gated on the Search Console health only (Ads health is stored and displayed but never gates
   selection — Ads has no per-site concept, and a Keyword Planner failure should not take down every
   other view for that site). If the cached Search Console health result is fresh (`expires_at >
now`) AND matches the currently resolved tier's `accountKey`, the cached result is reused and no
   new probe call is made. If the cached result is stale, absent (`"unchecked"`), or belongs to a
   different resolution tier than the one now resolved, a fresh probe MUST run before the selection
   attempt can succeed. A selection attempt against an unhealthy or unprobed-and-failing credential
   set MUST be rejected and MUST NOT change the active site.
3. **On manual recheck** — synchronously, when an operator explicitly invokes a "Recheck" action for a
   site in Manage Domains, bypassing the TTL unconditionally. This is the only way to clear a cached
   `"unhealthy"` result without waiting for the TTL to lapse or re-running the connect flow, and it
   exists because global-tier failures (e.g. an operator fixed access in the Google Cloud Console)
   have no OAuth callback to re-trigger the check.

Outside these three triggers, a real authenticated call's own outcome is recorded directly and never
triggers a probe: a successful Search Console or Ads call EXTENDS the cached `expires_at` for that
`(site, source)` without spending a probe call (stronger evidence than a probe), and a call that
classifies to an upstream credential failure DIRECTLY downgrades the cached state to `"unhealthy"`
without running one either.

No other trigger runs a probe: listing sites (`sites` / Manage Domains render) MUST use only the cached
health value and MUST NOT itself trigger a new probe call, so that viewing the list stays cheap
regardless of how many sites are stale. A dedicated background/periodic health sweep (e.g. a Cron
Trigger) is explicitly out of scope for this change; staleness beyond the TTL is resolved
opportunistically by the next selection attempt, real call, or manual recheck, not by a scheduled job.

#### Scenario: A successful connect marks the site healthy

- GIVEN a domain owner completes the OAuth connect flow and the resulting credentials can read that
  site's Search Console property
- WHEN the callback persists the credential row and runs its mandatory health probe
- THEN the site's health MUST be recorded as `"healthy"` and the connect response MUST report success

#### Scenario: A connect with inaccessible property marks the site invalid, not silently connected

- GIVEN a domain owner completes the OAuth consent screen for an account that does not have Search
  Console access to the site's exact property URL
- WHEN the callback runs its mandatory post-persist health probe
- THEN the credential row MUST still be persisted, the site's health MUST be recorded as `"unhealthy"`,
  and the connect response MUST report the unhealthy state rather than an unqualified success

#### Scenario: An unhealthy site cannot be selected

- GIVEN a site's cached health state is `"unhealthy"`
- WHEN the dashboard attempts to make that site the active site
- THEN the selection attempt MUST be rejected, the active site MUST NOT change, and the rejection MUST
  be distinguishable from a generic tool failure (see `mcp-error-contract`)

#### Scenario: A fresh, healthy cached result is reused on selection without a new probe

- GIVEN a site's cached health result is `"healthy"` and was recorded 3 minutes ago (well within the
  6-hour TTL) for the currently resolved credential tier
- WHEN the dashboard attempts to make that site the active site
- THEN the selection MUST succeed using the cached result, and no new probe call MUST be made to Google

#### Scenario: A stale cached result triggers a fresh probe before selection completes

- GIVEN a site's cached health result's `expires_at` has already elapsed
- WHEN the dashboard attempts to make that site the active site
- THEN a fresh probe MUST run against the currently resolved credential tier before the selection
  attempt resolves, and the site's cached health and the selection outcome MUST reflect that fresh
  result

#### Scenario: A tier change invalidates the cached result even if it is fresh

- GIVEN a site's cached health result is `"healthy"` for `credentialSource: "global"`, recorded 2
  minutes ago, and the site has just been connected to its own Google account (its resolution tier is
  now `"site"`, with a different `accountKey`)
- WHEN the dashboard attempts to make that site the active site
- THEN the stale-tier cached result MUST NOT be reused (an `accountKey` mismatch is treated as absent,
  not fresh); a fresh probe against the new `"site"` tier MUST run before the selection attempt
  resolves

#### Scenario: Manual recheck clears an invalid state without a new OAuth round-trip

- GIVEN a site is marked `"unhealthy"` because a global-tier account lacked property access, and an
  operator has since granted that access directly in Search Console
- WHEN the operator invokes the "Recheck" action for that site in Manage Domains
- THEN a fresh probe MUST run immediately regardless of the 6-hour TTL, and a successful probe MUST
  update the site's health to `"healthy"`, making it selectable again

#### Scenario: Listing sites never triggers a probe

- GIVEN ten sites exist, several with a stale or `"unchecked"` cached health state
- WHEN the `sites` list is requested (e.g. to render Manage Domains)
- THEN the response MUST reflect each site's currently cached health state without making any new probe
  call to Google, even for stale or unchecked entries

#### Scenario: An unchecked site is treated as not-yet-selectable, not as healthy by default

- GIVEN a site has just been added and has never had a credential resolution or health probe run
- WHEN the site is listed
- THEN its Search Console health MUST report `"unchecked"`, and it MUST NOT be selectable until a
  selection attempt (or manual recheck) runs a probe that resolves to `"healthy"`

### Requirement: The `sites` List Distinguishes Tier, Provenance, and Per-Source Health as Separate Fields

The `sites` list output schema MUST expose a `credential` object per site with fields that are never
inferred from one another: `tier: "site" | "global" | "none"` (which resolution tier currently
applies — combines "does this site have its own connected account" and "did nothing resolve at
all" into one value, since the two are mutually exclusive), `accountLabel: string | null` (the
connected Google account's email for `"site"`, `null` otherwise), `accountKey: string | null`, and
`health: { searchConsole, googleAds }`, each an independently-derived `{ state, reason?, checkedAt?
}` where `state` is one of five PRESENTED values — `"not_connected"` (no tier resolved at all),
`"unchecked"` (a tier resolved but no health row exists yet, or the row's `accountKey` no longer
matches the resolved tier), `"stale"` (a health row exists but its TTL has elapsed), `"healthy"`,
or `"unhealthy"` — of which only `"healthy"`/`"unhealthy"` are ever persisted to D1; the other three
are derived at read time. No raw credential field (`client_id`, `client_secret`, `refresh_token`,
`credentialKey`, ciphertext, or IV, or any derived access token) MUST ever appear in this schema.

#### Scenario: A healthy, connected site reports tier and health consistently

- GIVEN a site has its own connected Google account and its last Search Console probe against that
  account succeeded 4 minutes ago
- WHEN the site is listed
- THEN it MUST report `credential.tier: "site"`, a non-null `accountLabel`/`accountKey`, and
  `credential.health.searchConsole: { state: "healthy", checkedAt: <timestamp> }`

#### Scenario: A connected but unhealthy site is visibly distinct from both "healthy" and "not connected"

- GIVEN a site has its own `site_credentials` row but the account's refresh token was revoked at Google
  and the last Search Console probe failed
- WHEN the site is listed
- THEN it MUST report `credential.tier: "site"` and `credential.health.searchConsole.state:
"unhealthy"` with a `reason`, a combination that Manage Domains MUST render as a distinct
  "unhealthy" state, never identical to either a healthy-connected site or a never-connected site

#### Scenario: No raw credential value ever appears in the list schema

- GIVEN any site in any combination of `credential.tier`/`credential.health` states
- WHEN the `sites` list response is inspected
- THEN it MUST NOT contain `client_id`, `client_secret`, `refresh_token`, `credentialKey`, ciphertext,
  IV, or any derived access token for any site

### Requirement: Disconnect Removes the Credential Row Behind the Existing Confirm Gate

Disconnecting a site's Google account MUST require the same two-step confirmation gate
(`assertConfirmedDelete`) already used for other destructive site operations, and MUST delete the
site's `site_credentials` row entirely (not merely mark it inactive). After disconnect, the site's
`credential.tier` MUST re-resolve to `"global"` or `"none"` per the ordinary resolution rule, and any
cached health result tied to the deleted site-tier credential (`accountKey` no longer matches) MUST
be treated as absent rather than continuing to report the old site-tier probe outcome.

#### Scenario: Disconnect requires confirmation

- GIVEN a connected site's disconnect action is invoked without having passed through the confirm gate
- WHEN the disconnect request is processed
- THEN it MUST be rejected, and the credential row MUST remain intact

#### Scenario: Confirmed disconnect deletes the row and re-resolves to the global tier

- GIVEN a connected site is disconnected through the confirm gate, and global env credentials are present
- WHEN the disconnect completes
- THEN the `site_credentials` row MUST be deleted, and the next resolution for that site MUST use
  `credential.tier: "global"` with a fresh (`"unchecked"`) health state for that tier

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
- WHEN that failure is surfaced as the site's `credential.health.searchConsole.state: "unhealthy"`
- THEN the surfaced message MUST NOT include any credential value, matching
  `authenticated-source-contract`'s existing sanitization rule

## Worker Constraints

- Credential resolution and health-check state MUST NOT depend on any in-memory state surviving across
  requests or isolates; the last-probe result and its timestamp MUST be read from and written to D1, not
  held in a module-level variable.
- The AES-GCM encrypt/decrypt path MUST NOT perform an unbounded read of any external response body, and
  MUST NOT introduce a floating (unawaited) promise around the encrypt/decrypt or the health-probe fetch.
- The health-probe call itself is bounded by the same per-tool timeout discipline `dashboard-bff` already
  requires for authenticated routes; a probe that does not complete in time MUST be treated as `"unhealthy"`,
  not left pending.
