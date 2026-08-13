# Authenticated Source Contract

## Purpose

Shape-independent invariants that apply to every authenticated or analytical data source the
dashboard consumes (Search Console today; Google Ads Keyword Planner and any future
authenticated source later). These requirements exist so each provisional view does not
redefine credential containment, staleness display, quota accounting, or failure
classification independently — and so a provisional view cannot ship ahead of its tool's real,
published output schema. These requirements are read-only: no requirement in this file
describes or permits a write path to the MCP.

## Requirements

### Requirement: No Google or MCP Credential Reaches the Browser

No Google credential (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, any
derived Google OAuth access token, or any Google Ads developer token) and no `MCP_AUTH_TOKEN`
MUST appear in any browser-reachable surface produced by an authenticated-source view or its
supporting BFF route: not in a response body, not in a response header, not in an error message
text, not in an export artifact (JSON or CSV), not in a cache key, not in a cache value, and not
in a log line intended for client consumption. This extends the existing `bff-result-cache`
no-cache-key-from-secret rule and the existing `result-export` no-secret rule to every
authenticated source, not only `analyze_pagespeed`.

#### Scenario: Access token never reaches the response body

- GIVEN a dashboard request triggers a Search Console call that internally exchanges the
  refresh token for a Google access token
- WHEN the BFF returns the result to the browser
- THEN the response body MUST NOT contain the access token, the refresh token, the client
  secret, or the client ID

#### Scenario: Credential failure message is sanitized

- GIVEN the Google token exchange fails and the underlying error text could include a client
  secret or refresh token fragment
- WHEN the BFF surfaces this failure to the caller
- THEN the surfaced message MUST NOT include the credential value, matching the sanitization
  rule already required for upstream authentication headers by `mcp-error-contract`

#### Scenario: No credential in a cache key or value

- GIVEN an authenticated-source result is cached
- WHEN the cache key and cache value are inspected
- THEN neither MUST be derived from or contain the Google refresh token, access token, Ads
  developer token, client secret, or `MCP_AUTH_TOKEN`

#### Scenario: No credential in an export

- GIVEN a user exports an authenticated-source result to JSON or CSV
- WHEN the export is generated
- THEN it MUST NOT contain any Google credential or `MCP_AUTH_TOKEN`, extending the
  `result-export` no-secret-material requirement to authenticated sources

### Requirement: The Authenticated Registry Is an Explicit Allowlist

The authenticated registry (`bff/src/authenticated/registry.ts`'s `AUTHENTICATED_REGISTRY`) MUST be an
explicit allowlist of read-only tool routes, not an incidental list that happens to omit write tools today. No
`business_*` tool (`business_reply_review`, `business_update_info`, `business_create_post`, or any future
Business Profile write tool) and no other write-capable MCP tool MUST be reachable through the BFF's
authenticated dispatch path. This exclusion MUST be structural, not merely a matter of no one having added
such a row yet: the registry's `schema` field MUST be typed as the union of published `outputSchema` literals
from the schema map (`src/types/schemas.ts`), so that adding a row for a tool that publishes no `outputSchema`
— which includes every write tool, by construction, since a write tool publishes no queryable output shape —
is a compile-time type error, not a silent runtime addition. A tool absent from the registry MUST return 404
from its `/api/tools/{tool}` path rather than being silently dispatched through the ordinary (non-authenticated)
tool-call path.

#### Scenario: No `business_*` tool is reachable through the BFF

- GIVEN the authenticated registry as it exists in `bff/src/authenticated/registry.ts`
- WHEN the registry's keys are enumerated
- THEN no key MUST start with `business_`, and each of `business_reply_review`,
  `business_update_info`, and `business_create_post` MUST report `isAuthenticatedTool === false` and
  `getAuthenticatedRoute === undefined`

#### Scenario: An unschemad write tool cannot be added to the registry without a type error

- GIVEN a future contributor attempts to add a registry row for a tool that publishes no
  `outputSchema` (as every write tool does today)
- WHEN the code is typechecked
- THEN the addition MUST fail to typecheck, because the registry's `schema` field only accepts the
  published schema-map union, not an arbitrary or absent schema

#### Scenario: A write tool's route returns 404, not a dispatched write

- GIVEN a request is made to `/api/tools/business_reply_review` (or any other unregistered write
  tool's path) through the BFF
- WHEN the BFF handles the request
- THEN it MUST respond 404 without dispatching the call upstream, rather than falling through to
  the ordinary (non-authenticated) tool-call path

### Requirement: Two Distinct Staleness Axes Are Always Presented Separately

Every authenticated-source result MUST carry and display two distinct staleness facts that
MUST NOT be merged into one figure: (1) `resultAge`, the BFF's own cache age as already defined
by `bff-result-cache` and `quota-visibility`, and (2) the upstream source's own reporting lag —
an as-of date or equivalent marker showing how far behind real time the underlying data itself
is, independent of when the BFF fetched or cached it. A view MUST NOT compute, display, or
imply a single combined "freshness" number that collapses these two axes.

#### Scenario: A freshly fetched but inherently delayed result shows both axes

- GIVEN an authenticated-source query was fetched from the upstream source moments ago (low
  `resultAge`) but the upstream source's own data is reported as being two days behind current
  real time
- WHEN the view renders the result
- THEN it MUST display a low `resultAge` AND, separately, the two-day reporting lag or as-of
  date, and MUST NOT present a single number implying the data itself is current

#### Scenario: A cached, previously fetched result still separates the axes

- GIVEN an authenticated-source result was served from cache with a `resultAge` of several
  hours, and the upstream data's own as-of date is earlier still
- WHEN the view renders the result
- THEN the cache-age figure and the upstream as-of/lag figure MUST both be visible and
  distinguishable from one another

#### Scenario: No metric renders without its as-of date

- GIVEN any metric derived from an authenticated source is rendered in a view
- WHEN a user reads that metric
- THEN an as-of date or upstream reporting-lag indicator MUST be visible alongside it, not only
  documented separately or available only via export

### Requirement: Upstream Quota Is Accounted and Displayed Independently of the MCP Bucket

Each authenticated upstream source (Search Console, Google Ads Keyword Planner, and any future
authenticated source) has its own quota that is independently exhaustible and is unaffected by
the shared MCP 60-requests-per-60-seconds bucket. The system MUST track and present an estimate
of authenticated-source call volume separately from the MCP-bucket headroom that
`quota-visibility` already covers, and MUST label this estimate as an estimate because the
upstream source returns no remaining-count that would make it exact. Staying inside the MCP
bucket's limit MUST NOT be presented, implied, or relied upon as evidence that the upstream
source's own quota is unaffected.

#### Scenario: Upstream quota indicator is distinct from the MCP-bucket indicator

- GIVEN a dashboard view renders both the MCP-bucket headroom indicator and an
  authenticated-source quota indicator
- WHEN a user views either indicator
- THEN they MUST be visually and textually distinguishable as two independent limits, neither
  implying it reflects the other

#### Scenario: MCP bucket healthy does not imply upstream quota healthy

- GIVEN the MCP-bucket headroom indicator shows ample remaining headroom
- WHEN the authenticated-source's own quota is near exhaustion due to Search Console or Ads
  calls the MCP bucket does not track
- THEN the view MUST still be able to show the upstream-quota indicator as constrained,
  independent of the MCP-bucket indicator's state

#### Scenario: Upstream quota estimate is labeled as an estimate

- GIVEN the upstream source returns no remaining-quota count
- WHEN the authenticated-source quota indicator is displayed
- THEN it MUST be labeled or otherwise clearly presented as an estimate derived from the BFF's
  own observed call volume, not as an exact remaining-quota count

#### Scenario: Upstream quota exhaustion disables submission with a reason

- GIVEN the authenticated-source quota estimate indicates exhaustion
- WHEN a user attempts to submit a new authenticated-source query
- THEN the submit action MUST be disabled and MUST state the reason is upstream quota, distinct
  from any MCP-bucket-related disabled reason

### Requirement: Credential Failure Is Distinguishable From Quota Exhaustion and From a Genuine Empty Result

A Google credential failure (expired or revoked refresh token, or missing/misconfigured
credentials, which requires operator action such as re-authorizing or rotating the secret) MUST
be distinguishable from Google-side quota exhaustion (which requires waiting) and from a
genuine data-absent result (the query ran successfully and returned zero rows). The current
verified gap is that `src/google/search-console.ts:76-81` and `src/google/auth.ts:19` both throw
a plain `Error` that reaches `errorResult` as one undifferentiated `tool_failed` text failure,
so the BFF and dashboard cannot mechanically tell these three cases apart today. Before an
authenticated view ships past this contract, the system MUST implement one of: (a) distinct
machine-readable codes for credential failure versus quota exhaustion versus tool failure, or
(b) a documented and tested text-classification rule applied to the upstream error message that
maps it to one of these categories. Whichever is chosen, when the failure's category cannot be
determined by that mechanism, the system MUST default to treating it as a non-retryable
operator-action failure rather than silently retrying or presenting it as transient.

#### Scenario: Missing credentials render a distinct "not configured" state

- GIVEN `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, or `GOOGLE_REFRESH_TOKEN` is absent
- WHEN a user triggers an authenticated-source query
- THEN the view MUST render a "not configured" state distinct from both an error state and an
  empty-result state

#### Scenario: Credential failure surfaces as an operator-action state, not a retry-now state

- GIVEN the Google token exchange fails because the refresh token was revoked
- WHEN the failure is surfaced to the view
- THEN the view MUST present it as requiring operator action (e.g. re-authorization), MUST NOT
  offer an immediate-retry affordance implying the failure is transient, and MUST NOT be
  presented identically to a quota-exhaustion failure

#### Scenario: Quota exhaustion surfaces as a wait-and-retry state

- GIVEN the upstream source rejects a call because its own quota is exhausted
- WHEN the failure is surfaced to the view
- THEN the view MUST present it as a wait state distinct from the credential-failure state, and
  MUST disable resubmission consistent with the rate-limit handling `quota-visibility` and
  `dashboard-shell` already require for the MCP bucket's 429 case

#### Scenario: A genuine empty result is never presented as a failure

- GIVEN an authenticated-source query executes successfully and the upstream source returns zero
  rows for the requested range
- WHEN the view renders the result
- THEN it MUST render the empty-result state, and MUST NOT render either the credential-failure
  state or the quota-exhaustion state

#### Scenario: Undetermined failure class defaults to non-retryable

- GIVEN an upstream failure's text does not clearly match any classification rule the system
  implements
- WHEN the failure is surfaced to the view
- THEN the system MUST default to a non-retryable, operator-action presentation rather than
  offering an unqualified immediate-retry action

### Requirement: A Provisional View MUST NOT Ship Before Its Tool's Real Output Schema Is Reconciled

Any view specified against a tool that does not yet exist, or whose output schema is not yet
published, is provisional. A provisional view's spec MUST state its provisional status inline
and MUST name the exact tool it depends on. Before a provisional view is implemented or shipped,
its spec MUST be reconciled against that tool's real, published output schema — field names,
types, units, and any bound or cap the tool enforces — and the reconciliation MUST be recorded
before implementation begins. Implementing or shipping a provisional view's UI against an
invented field name, unit, score scale, or bound that has not been confirmed against the real
tool output is a contract violation of this requirement, not merely a quality issue.

#### Scenario: A provisional spec names its blocking tool

- GIVEN a view is specified for a hypothetical tool that does not yet exist as a registered MCP
  tool
- WHEN the spec is read
- THEN it MUST state inline that it is provisional and MUST name that hypothetical tool as the one
  whose published output schema must reconcile it

#### Scenario: Implementation is blocked until reconciliation

- GIVEN a provisional view's underlying tool has just been implemented and its real output
  schema published
- WHEN implementation of that view begins
- THEN the view's spec MUST first be reconciled against the real schema (field names, types,
  units, bounds), and this reconciliation MUST occur before or as part of the same work that
  implements the view, not deferred to after shipping

#### Scenario: Shipping ahead of reconciliation is rejected

- GIVEN a provisional view's spec still contains an invented field name or unit that does not
  match the real tool's now-published output schema
- WHEN that view is proposed for implementation
- THEN the implementation MUST be rejected or blocked until the spec is corrected to match the
  real schema

## Worker Constraints

- Cloudflare Worker constraints apply identically to authenticated-source handling as to every
  other MCP tool call: no unbounded response body reads, no floating promises around the Google
  token exchange or the Search Console fetch, and no module-level mutable state introduced
  beyond the existing single-tenant access-token cache already present at `src/google/auth.ts:3`
  (out of scope to change here; noted only because any new authenticated-source integration MUST
  NOT introduce a second, inconsistent module-level credential cache).
- Quota and staleness accounting introduced by this contract MUST NOT depend on any in-memory
  state surviving across requests or isolates, consistent with `bff-result-cache`'s existing
  constraint on the MCP-bucket headroom estimate.

## Required Amendments To Sibling Changes

The following amendments are notes for the orchestrator. They are not deltas against unarchived
specs; they name the exact sibling change, capability, and content that must be added when that
change's specs are next open for editing.

- **`mcp-error-contract`** (in `dashboard-bff-foundations`, capability `mcp-error-contract`):
  needs a new stable `code` (or an equivalent documented text-classification rule) that
  distinguishes Google credential failure from Google quota exhaustion from a generic
  `tool_failed`, matching the "Credential Failure Is Distinguishable..." requirement above. The
  current envelope's `tool_failed` code (design.md's `BffErrorCode` table) does not yet
  differentiate these for `search_console_query`.
- **`bff-result-cache`** (in `dashboard-bff-foundations`, capability `bff-result-cache`): needs a
  long-TTL cache class for upstream-delayed authenticated data (hours-scale, near the existing
  86400 s clamp), and an explicit statement that no cache key for an authenticated-source tool
  may be derived from a Google credential — extending the existing `apiKey` no-cache-key rule.
- **`quota-visibility`** (in `dashboard-views`, capability `quota-visibility`): needs a
  requirement that an authenticated-source quota estimate is displayed alongside, and clearly
  labelled as independent from, the existing MCP-bucket headroom estimate — per the "Upstream
  Quota Is Accounted..." requirement above.
- **`result-export`** (in `dashboard-views`, capability `result-export`): needs its
  no-secret-material and truncation-provenance requirements extended explicitly to
  authenticated-source results (as-of date and row-bound provenance), matching the export
  requirements specified in `search-console-view` in this change.
- **`dashboard-bff`** (in `dashboard-bff-foundations`, capability `dashboard-bff`): needs a
  per-tool timeout for authenticated routes above `gsc-timeout + token exchange` (≥25 s per the
  proposal), and Google-quota accounting hooks, when that capability's spec is next open.
