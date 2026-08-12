# Delta for Keyword Research View

## PROVISIONAL — reconciliation required before shipping

This spec covers two unbuilt tools: `get_keyword_metrics` (first, per `ROADMAP.md`'s resolved data-slice
order) and `discover_keywords` (second). Neither has an implementation, a registered MCP tool, a Google
Ads Keyword Planner integration, or a published output schema. `ROADMAP.md` states the intended output in
prose only — "volume, CPC, competition, intent, and clustering" — and this spec MAY require that the view
present that information, but MUST NOT invent the field names, units, value ranges, or clustering
representation that would carry it, because none of those are settled.

Per the `authenticated-source-contract` capability's reconciliation gate: this spec MUST be reconciled
against each tool's real output schema before that tool's part of the view ships. `get_keyword_metrics`
and `discover_keywords` MAY reconcile and ship independently of each other.

Credential handling (the Google Ads developer token), cache TTL class, and reporting-lag semantics are
governed by `authenticated-source-contract` and are not restated here.

## ADDED Requirements

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

### Requirement: Monetary Values Carry Their Currency Explicitly

Whatever numeric representation CPC (cost-per-click) ultimately takes, the view MUST display its currency
alongside every monetary value it renders, and MUST NOT render a bare number that could be misread as a
different currency or as a unitless score. If the reconciled tool shape returns monetary values in more
than one currency across different keywords or markets, each value MUST carry its own currency label
rather than one assumed currency for the whole result.

#### Scenario: A CPC value renders with its currency

- GIVEN a reconciled keyword-metrics result includes a CPC value
- WHEN the view renders that value
- THEN it MUST display the value together with its currency, and MUST NOT display a bare number

#### Scenario: Mixed currencies within one result are each labelled

- GIVEN a result set contains CPC values in more than one currency
- WHEN the view renders the set
- THEN each value MUST carry its own currency label, not a single currency assumed for the whole set

### Requirement: An Absent Metric Is Distinguishable From a Zero Metric

For volume, CPC, competition, and any other per-keyword metric the reconciled shape returns, the view
MUST distinguish a metric that Google Ads did not return for a given keyword (e.g. insufficient data) from
a metric that Google Ads returned as an explicit zero. Neither case MUST be rendered as a blank cell that
could be mistaken for the other, and neither MUST default to a fabricated placeholder value.

#### Scenario: A zero-volume keyword shows zero, not blank

- GIVEN a reconciled result reports an explicit zero for a keyword's volume
- WHEN the view renders that row
- THEN it MUST display a zero, not an absence indicator

#### Scenario: A keyword lacking a metric shows explicit absence, not zero

- GIVEN a reconciled result has no value for a keyword's competition metric (the source did not return
  one)
- WHEN the view renders that row
- THEN it MUST show an explicit "not available" indicator for that cell, and MUST NOT render it as zero

### Requirement: Clustering Is Inspectable, Not an Opaque Grouping

`ROADMAP.md` names clustering as part of the intended output. Whatever the reconciled clustering
representation turns out to be (cluster IDs, cluster labels, similarity scores, or another shape), the
view MUST let a user see which individual keywords belong to a given cluster and MUST NOT present
clustering only as an unlabelled visual grouping that cannot be inspected member-by-member.

#### Scenario: A user can see a cluster's member keywords

- GIVEN a reconciled `discover_keywords` result groups keywords into clusters
- WHEN a user inspects a cluster
- THEN the view MUST list the individual keywords that belong to that cluster

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

## Required Amendments To Sibling Changes

None identified. This capability consumes the existing `quota-visibility` and `dashboard-shell` contracts
from `dashboard-views` without needing a change to either; the independent-quota requirement above is a
new instance of the pattern `quota-visibility` already establishes for the MCP bucket, not a new contract
shape.
