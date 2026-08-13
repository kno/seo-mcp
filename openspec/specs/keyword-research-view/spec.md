# Keyword Research View

## Reconciliation status

All three tools this capability covers now exist and are RECONCILED against their real shape, read from
`src/google/ads.ts`, `src/seo/keywords.ts`, and `src/server.ts` (commit `1044d82` for the Ads tools,
`ef5b0d2` for clustering):

- `get_keyword_metrics` — input `{ keywords: string[1..100], geoTargetIds?, languageId?, customerId? }`.
  Result `{ customerId, count, keywords: KeywordMetric[] }`.
- `discover_keywords` — input `{ seedKeywords?, seedUrl?, geoTargetIds?, languageId?, limit?: 1-200,
customerId? }` (at least one of `seedKeywords`/`seedUrl` required). Same result shape as
  `get_keyword_metrics`: `{ customerId, count, keywords: KeywordMetric[] }`.
- `cluster_keywords` — input `{ keywords: string[1..500] }`. Result `ClusterResult { count, intents:
Record<string, number>, clusters: KeywordCluster[]{ label, keywords: string[] }, keywords:
ClassifiedKeyword[]{ keyword, intent, tokens } }`. **This is pure text analysis — no Google Ads API call,
  no credential, no quota.** It was not in this capability's original scope and is added here.

`KeywordMetric = { keyword, avgMonthlySearches, competition: string, competitionIndex: number,
lowTopOfPageBid: number, highTopOfPageBid: number }` (`src/google/ads.ts:9-16`).

Two reconciliation findings change requirements below rather than merely confirming them — see the
amended requirements:

1. **No currency field exists anywhere** — not in `KeywordMetric`, not in `Env`, not in any config.
   `lowTopOfPageBid`/`highTopOfPageBid` are bare numbers (`src/google/ads.ts:36-46`, converting bid micros
   with no currency capture). The "carries its currency explicitly" requirement as originally written
   assumed the tool would supply one; it does not.
2. **Absent and zero are already collapsed at the source.** `normalizeMetric` computes every numeric field
   as `Number(value) || 0` (`src/google/ads.ts:29-46`), so a keyword Google Ads returns with no data and a
   keyword Google Ads returns with an explicit zero are indistinguishable in the tool's own output. The
   distinction this spec originally required cannot be recovered client-side.

Credential handling (the Google Ads developer token), cache TTL class, and reporting-lag semantics for the
two Ads-backed tools are governed by `authenticated-source-contract` and are not restated here.
`cluster_keywords` needs none of that — it has no upstream credential or quota at all.

## Requirements

### Requirement: The View Ships When Only `get_keyword_metrics` Exists

The view MUST be usable, and MUST render a complete result, when only `get_keyword_metrics` has shipped
and `discover_keywords` has not. The view MUST NOT require `discover_keywords` to be present in order to
submit or display a `get_keyword_metrics` request, and MUST NOT show a broken or partial-looking layout
in `discover_keywords`'s absence.

#### Scenario: Metrics-only mode renders without discovery

- GIVEN `discover_keywords` has not shipped and only `get_keyword_metrics` is available
- WHEN a user submits a keyword-metrics request
- THEN the view MUST render the metrics result without any error or missing-section indication caused by
  `discover_keywords`'s absence

#### Scenario: Discovery becomes available without breaking existing metrics usage

- GIVEN the view has been reconciled and shipped for `get_keyword_metrics` only
- WHEN `discover_keywords` later reconciles and ships
- THEN the metrics-only usage path MUST continue to function unchanged

### Requirement: Monetary Values Are Never Rendered Without a Currency Label

`lowTopOfPageBid` and `highTopOfPageBid` are bare numbers with no currency field anywhere in the tool
response, `Env`, or config (verified: `src/google/ads.ts:9-16`, `src/config.ts:8-10`). The single-tenant
deployment has exactly one Google Ads account and therefore exactly one billing currency, so the view MUST
require an explicitly operator-configured currency label — obtained out of band, not read from any tool
response — and MUST display it alongside every bid value. The view MUST NOT render a bid value with no
currency indicator, and MUST NOT guess or hardcode a currency.

Per-value or mixed-currency labelling does not apply: the tool provides no signal that a result could span
more than one currency, and the single-tenant Ads account has one billing currency.

#### Scenario: A bid value never renders without a currency label

- GIVEN a `get_keyword_metrics` or `discover_keywords` result includes a bid value
- WHEN the view renders that value
- THEN it MUST display the operator-configured currency label alongside it
- AND MUST NOT display a bare number

#### Scenario: A missing currency label surfaces an explicit configuration-needed state

- GIVEN the operator has not configured a currency label
- WHEN the view would otherwise render a bid value
- THEN it MUST show an explicit configuration-needed state instead of a bare or defaulted currency

### Requirement: The View Does Not Claim Precision the Tool Does Not Provide

`normalizeMetric` computes every numeric field as `Number(value) || 0` (`src/google/ads.ts:29-46`), so
`get_keyword_metrics` and `discover_keywords` already collapse "Google Ads returned no data for this
keyword" and "Google Ads returned an explicit zero" into the same `0` before the tool responds. This
distinction cannot be recovered client-side from the current tool output — the original requirement to
distinguish them is unsatisfiable against the real shape and is withdrawn as stated.

The view MUST instead avoid overstating confidence in a `0`: it MUST label a `0` metric value as "0 or no
data reported" rather than presenting it as a confirmed zero search volume or a confirmed zero competition
score, so a user does not read data absence as a verified low value.

#### Scenario: A zero-valued metric does not claim certainty

- GIVEN a keyword-metrics result reports `0` for a keyword's `avgMonthlySearches`
- WHEN the view renders that row
- THEN it MUST label the value in a way that does not assert Google Ads confirmed zero search volume,
  since the tool cannot distinguish that from missing data

### Requirement: Clustering Is Inspectable, Not an Opaque Grouping

RECONCILED — the real `cluster_keywords` shape already satisfies this by construction:
`KeywordCluster { label, keywords: string[] }` lists each cluster's member keywords directly
(`src/seo/keywords.ts:18-21`), and `ClassifiedKeyword { keyword, intent, tokens }` carries a per-keyword
intent classification independent of cluster membership. The view MUST let a user see which individual
keywords belong to a given cluster (trivial from `KeywordCluster.keywords`) and MUST also surface each
keyword's classified `intent`, and MUST NOT present clustering only as an unlabelled visual grouping that
cannot be inspected member-by-member.

`cluster_keywords` is a separate, credential-free tool from the two Ads-backed tools (pure text analysis,
no upstream call) — the view MAY let a user cluster a `discover_keywords` result's keywords, or cluster an
arbitrary list independent of any Ads call.

#### Scenario: A user can see a cluster's member keywords

- GIVEN a `cluster_keywords` result groups keywords into clusters
- WHEN a user inspects a cluster
- THEN the view MUST list the individual keywords that belong to that cluster, from `KeywordCluster.keywords`

#### Scenario: Clustering works without an Ads call

- GIVEN a user has a keyword list that did not come from `discover_keywords`
- WHEN the user submits it to the clustering view
- THEN the view MUST be able to cluster it without requiring a Google Ads credential or quota

### Requirement: Google Ads Quota Is Displayed Independently of Google Search Console Quota

Per `authenticated-source-contract`, every Google-side quota is a distinct, independently exhaustible
budget from the MCP's shared rate-limit bucket. This view's requirement adds: the Google Ads
Keyword Planner quota MUST be displayed as its own distinct budget, separate from any Google Search
Console quota the dashboard also displays, because the two are different Google APIs with different
credentials (developer token vs. OAuth refresh token) and independent exhaustion.

#### Scenario: Ads quota exhaustion does not imply GSC quota exhaustion

- GIVEN the Google Ads quota is exhausted while the Google Search Console quota has headroom remaining
- WHEN a user views quota status while both this view and a GSC-backed view are reachable
- THEN the view MUST show the Ads quota as exhausted and the GSC quota as having headroom, as two
  separately labelled values, and MUST NOT disable GSC-backed submission because of Ads exhaustion

#### Scenario: Clustering is never blocked by Ads quota state

- GIVEN the Google Ads quota is exhausted
- WHEN a user submits a `cluster_keywords` request
- THEN the view MUST allow it to proceed, because `cluster_keywords` makes no Google Ads call and spends
  no Ads quota

## Required Amendments To Sibling Changes

None to `dashboard-views` or `dashboard-bff-foundations`. This capability consumes the existing
`quota-visibility` and `dashboard-shell` contracts from `dashboard-views` without needing a change to
either; the independent-quota requirement above is a new instance of the pattern `quota-visibility`
already establishes for the MCP bucket, not a new contract shape.

One follow-up outside this change's scope, not a sibling-spec amendment: `src/google/ads.ts`'s
`normalizeMetric` collapses absent and zero metrics into the same `0` via `Number(value) || 0`
(`:29-46`). Preserving that distinction (e.g. via `Number.isFinite` checks) would let a future version of
the "does not claim precision" requirement above assert an actual absence indicator instead of a hedged
zero label. Not tasked here — this capability ships against the tool's current, lossy behavior.
