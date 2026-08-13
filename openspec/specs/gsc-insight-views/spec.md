# GSC Insight Views

## Reconciliation status

Two of the three tools this spec covers now exist and are RECONCILED against their real shape, read from
`src/google/opportunities.ts` and `src/server.ts` (commit `a5b4f22`):

- `find_striking_distance_keywords` — inputs `siteUrl`, `startDate`, `endDate` (both `YYYY-MM-DD`), optional
  `minPosition`/`maxPosition` (1–100, server defaults 11/20), optional `minImpressions` (int ≥0, default 1),
  optional `limit` (1–250, default 25).
- `find_low_ctr_opportunities` — inputs `siteUrl`, `startDate`, `endDate`, optional `maxPosition` (1–100,
  default 10), optional `minImpressions` (int ≥0, default 10), optional `maxCtr` (0–1, default 0.02),
  optional `limit` (1–250, default 25).
- Both return the same `OpportunityResult` shape: `{ siteUrl, startDate, endDate, dimensions, criteria:
Record<string, number>, rowCount, rows: GscRow[] }` (`src/google/opportunities.ts:60-66,150-156,183-190`).
  `rowCount` is always `rows.length` after filtering and truncation — there is no separate
  total-matching-count field.
- **Neither tool accepts a comparison or baseline period.** Both operate on one date range only.

The third tool — content-decay / period-over-period comparison — is now also RECONCILED. It ships as three
related tools, not one, read from `src/server.ts` (search for `"compare_search_console"`,
`"snapshot_search_console"`, `"list_search_console_snapshots"`) plus `src/seo/gsc-diff.ts` and
`src/db/gsc-store.ts`:

- `snapshot_search_console` — inputs `{ siteUrl, startDate, endDate, dimensions?, label? }`. Internally runs
  a bounded Search Console query (`LIMITS.maxSnapshotRows`, 500 rows) and stores it in D1. Output: `{
snapshotId, siteUrl, rowCount, capturedAt }`.
- `list_search_console_snapshots` — inputs `{ siteUrl, limit?: 1-50 }`. Output: `{ siteUrl, count,
snapshots: StoredSnapshot[] }`. `StoredSnapshot` (`src/db/gsc-store.ts:4-11`): `{ id, siteUrl, capturedAt,
startDate, endDate, label: string | null }`. `listSnapshots` defaults to 20 when `limit` is omitted
  (`src/db/gsc-store.ts:93`) and orders most-recent-first; this is a LISTING cap, not a retention cap — see
  `history-comparison-view`'s "Snapshot Retention Is Unbounded, Not a Rolling Window" requirement.
- `compare_search_console` — inputs `{ siteUrl, baseSnapshotId?, currentSnapshotId? }`. If either snapshot
  ID is omitted, both default to the two most recent snapshots for that site (`twoMostRecent`,
  `src/db/gsc-store.ts:124-131`, where the more recent of the pair becomes `current` and the older becomes
  `base`). If fewer than two snapshots exist for the site, the tool returns an **error result** with the
  message "Need at least two snapshots to compare" (`src/server.ts`), not an empty or degraded diff. Output:
  `{ siteUrl, baseSnapshotId, currentSnapshotId, diff: GscDiff }`.
- `GscDiff` (`src/seo/gsc-diff.ts:21-28`): `{ baseCount, currentCount, decayed: GscDiffRow[], improved:
GscDiffRow[], lost: GscDiffRow[], gained: GscDiffRow[] }`. `GscDiffRow` (`:11-19`): `{ query, page, base:
GscMetrics | null, current: GscMetrics | null, clicksDelta, impressionsDelta, positionDelta }`.
  `GscMetrics` (`:4-9`) is `{ clicks, impressions, ctr, position }`. Each row is already classified into
  exactly one of the four named buckets by the diffing logic (`decayGscRows`, `:52-126`): a query/page pair
  present in both snapshots goes to `decayed` (clicks down or position up) or `improved` (clicks up or
  position down); a pair present only in the base snapshot goes to `lost` (`current: null`); a pair present
  only in the current snapshot goes to `gained` (`base: null`). The view does not invent its own
  classification — it renders the bucket the tool already assigned. Each bucket is truncated to
  `LIMITS.maxDiffRows` independently (`:117-125`), so a bucket's length reaching that cap is a bound signal,
  the same as `rowCount === criteria.limit` for the other two tools.
- **All three tools need `env.DB` (D1) configured.** Without it, each returns an error result — "D1 storage
  is not configured" — not a degraded/empty success (`src/server.ts`, `if (!env.DB) return
errorResult(...)` guards on all three).
- `compare_search_console` has no "compare against a live query" path: it only ever compares two stored
  snapshots. There is no tool that computes a decay diff without first calling `snapshot_search_console` at
  least twice for the same site.

The first two tools (`find_striking_distance_keywords`, `find_low_ctr_opportunities`) derive from the same
resolved first data slice — Google Search Console `query + page` by date (`ROADMAP.md`, "Resolved
decisions" section) — so they share a property and a date range with each other. `compare_search_console`
and its snapshot-lifecycle siblings operate on stored snapshots rather than a live date range, and are
covered by the requirements below rather than the shared-selector requirement. The reporting-lag/as-of
display and the credential/quota rules live in `authenticated-source-contract` and are not restated here.

## Requirements

### Requirement: Shared Property and Date-Range Selection Across All Three Tools

The view MUST offer one property selector and one date-range selector that apply to whichever of the
three insight tools is active, rather than each tool defining its own independent property/date controls.
Switching the active insight tool MUST NOT silently reset a property or date range the user has already
selected.

#### Scenario: Property and date range persist across tool switches

- GIVEN a user has selected a property and a date range while viewing striking-distance results
- WHEN the user switches to the low-CTR opportunities tool within the same view
- THEN the previously selected property and date range MUST remain selected, not reset to a default

#### Scenario: An unselected property blocks submission for any of the three tools

- GIVEN no property has been selected
- WHEN a user attempts to submit a request to any of the three insight tools
- THEN the view MUST prevent submission and MUST NOT send a request lacking a property

### Requirement: Applied Criteria Are Shown Alongside Results

Both grounded tools echo the effective thresholds used to produce the result in `criteria` (e.g. the
position range, minimum impressions, or maximum CTR applied, including server-side defaults when the user
did not override them). The view MUST display these effective criteria alongside the result, so a user
cannot mistake a threshold the server defaulted for one they chose, and cannot misread a narrow result as
"few opportunities exist" when it was actually "few opportunities matched this threshold".

#### Scenario: Server-applied defaults are visible, not hidden

- GIVEN a user submits a striking-distance request without overriding `minImpressions`
- WHEN the view renders the result
- THEN it MUST display the `minImpressions` value the server actually applied, from `criteria`, not only
  the value the user explicitly typed

### Requirement: Ranked Opportunity Sets Label Their Own Bound

Both `find_striking_distance_keywords` and `find_low_ctr_opportunities` return `rowCount` equal to
`rows.length` after filtering and truncation, with no separate total-matching-count field
(`src/google/opportunities.ts:132,187`). The view MUST treat `rowCount === criteria.limit` as a signal that
more matching opportunities may exist beyond what was returned, using the `dashboard-shell` bound-versus-
empty state contract, and MUST NOT present that case as the complete result.

There is a second, independent truncation layer the view MUST also account for: both tools pull GSC rows
up to `LIMITS.maxGscRows` (250) BEFORE filtering (`src/google/opportunities.ts:113-119,164-170`), so
opportunities beyond that raw pull are invisible to the filter regardless of `limit`. The view MUST NOT
claim exhaustiveness for either tool's result under any circumstance, since this deeper truncation cannot
be detected from the response at all.

#### Scenario: A capped opportunity set is not presented as complete

- GIVEN a result whose `rowCount` equals its own `criteria.limit`
- WHEN the view renders that set
- THEN it MUST show a bound-reached indication naming the limit, and MUST NOT present the set as the
  complete result

#### Scenario: The view never claims exhaustiveness

- GIVEN any successful result from either tool, regardless of `rowCount`
- WHEN the view renders it
- THEN it MUST NOT state or imply that the result is a complete enumeration of all matching opportunities,
  because the underlying Search Console pull is itself bounded before filtering

#### Scenario: Zero opportunities is distinct from an unfetched state

- GIVEN a request to either tool completes successfully with no opportunities found
- WHEN the view renders that result
- THEN it MUST show an explicit "no opportunities found" state, distinguishable from the loading state and
  from a state where the request has not yet been submitted

### Requirement: Period-Over-Period Comparison States Both Snapshots Explicitly

`compare_search_console` compares two stored snapshots identified by `baseSnapshotId` and
`currentSnapshotId` — either explicitly supplied or defaulted to the two most recent snapshots for the
site (`twoMostRecent`, `src/db/gsc-store.ts:124-131`). The view MUST display both `baseSnapshotId` and
`currentSnapshotId`, and each snapshot's own `capturedAt` timestamp (fetched via
`list_search_console_snapshots` or carried alongside the comparison), so a user always sees which two
captures produced the diff, not only the delta values. A comparison MUST NOT be rendered with an implicit
or unstated snapshot pair.

When fewer than two snapshots exist for the selected site, `compare_search_console` returns a distinct
error result with the message "Need at least two snapshots to compare" rather than an empty diff. The view
MUST surface this as its own actionable state — distinct from a generic tool-failure state — that tells
the user to capture a snapshot with `snapshot_search_console` first, and MUST NOT render an empty-looking
comparison (zero rows in every bucket) as if it were a genuine "no changes detected" result.

#### Scenario: Comparison result names both snapshots

- GIVEN a `compare_search_console` result is rendered
- WHEN the view displays that result
- THEN both `baseSnapshotId` and `currentSnapshotId` MUST be visible, each alongside its own `capturedAt`
  timestamp

#### Scenario: Fewer than two snapshots is a distinct, actionable state

- GIVEN a user requests a comparison for a site with zero or one stored snapshot
- WHEN `compare_search_console` returns its "Need at least two snapshots to compare" error
- THEN the view MUST render a distinct state that instructs the user to capture a snapshot via
  `snapshot_search_console`, and MUST NOT present this as a generic failure or as an empty comparison
  result

#### Scenario: An explicit snapshot pair overrides the two-most-recent default

- GIVEN a user has explicitly selected a `baseSnapshotId` and a `currentSnapshotId` that are not the two
  most recent snapshots
- WHEN the comparison is submitted
- THEN the view MUST send both IDs explicitly and MUST NOT silently substitute the two-most-recent default

### Requirement: Content-Decay Direction Is Unambiguous Across All Four Buckets

`compare_search_console`'s `diff` already classifies every query/page pair into exactly one of four named
buckets — `decayed`, `improved`, `lost`, or `gained` (`src/seo/gsc-diff.ts:21-28,52-126`) — before the view
ever sees it. The view MUST render each bucket as its own distinct, unambiguous state rather than inventing
its own decline/improvement classification or folding `lost` into `decayed` or `gained` into `improved`:

- `decayed` — the pair exists in both snapshots and clicks fell or position worsened. MUST use a
  decline-specific presentation.
- `improved` — the pair exists in both snapshots and clicks rose or position improved. MUST use an
  improvement-specific presentation, visually and textually distinct from `decayed`.
- `lost` — the pair existed in the base snapshot (`base` populated) but not in the current snapshot
  (`current: null`). MUST be rendered as its own state, not merged into `decayed`, since a pair with no
  current-period data is not the same fact as one whose metrics measurably declined.
- `gained` — the pair exists only in the current snapshot (`base: null`, `current` populated). MUST be
  rendered as its own state, not merged into `improved`, for the same reason in reverse.

A `decayed` row MUST NOT use the same visual treatment (color, icon, or sign) that the view uses for
`improved`, and a `lost` row MUST NOT use the same treatment as a `decayed` row, nor `gained` the same as
`improved`.

#### Scenario: A decayed row cannot be rendered as an improvement

- GIVEN a query/page pair appears in the `decayed` bucket of a comparison result
- WHEN the view renders that row
- THEN it MUST use a decline-specific presentation, and MUST NOT reuse the presentation the view assigns
  to the `improved` bucket

#### Scenario: A lost query is distinct from a decayed query

- GIVEN a query/page pair appears in the `lost` bucket (present in the base snapshot, absent from the
  current snapshot)
- WHEN the view renders that row
- THEN it MUST show a state distinct from `decayed`, communicating that the pair no longer appears in the
  current data, not that its metrics fell

#### Scenario: A gained query is distinct from an improved query

- GIVEN a query/page pair appears in the `gained` bucket (absent from the base snapshot, present in the
  current snapshot)
- WHEN the view renders that row
- THEN it MUST show a state distinct from `improved`, communicating that the pair is new to the current
  data, not that its metrics rose

### Requirement: The Comparison Entry Point Requires Two Snapshots To Exist First

Because `compare_search_console` has no live-query path — it only ever compares stored snapshots — the
view MUST NOT present the comparison entry point as though it were immediately usable for a site with no
snapshot history. Before a user has captured at least two snapshots for a site via
`snapshot_search_console`, the view MUST show an onboarding state that explains a snapshot must be
captured first (and again after the first capture, that a second is needed), rather than presenting a
comparison form that submits directly into the "need at least two snapshots" error.

#### Scenario: A site with no snapshots shows a capture-first onboarding state

- GIVEN a site has zero stored Search Console snapshots
- WHEN a user opens the content-decay comparison entry point for that site
- THEN the view MUST show an onboarding state directing the user to capture a snapshot with
  `snapshot_search_console`, rather than an active comparison form

#### Scenario: A site with exactly one snapshot still shows the capture-more state

- GIVEN a site has exactly one stored Search Console snapshot
- WHEN a user opens the content-decay comparison entry point for that site
- THEN the view MUST show a state indicating one more snapshot is needed before a comparison is possible

### Requirement: Reporting Lag Applies to Every GSC-Backed Tool in This View

Per `authenticated-source-contract`, Google Search Console data carries its own reporting delay,
independent of the freshness of the BFF's cached result. Every result rendered by any tool in this view
(`find_striking_distance_keywords`, `find_low_ctr_opportunities`, `snapshot_search_console`,
`list_search_console_snapshots`, `compare_search_console`) MUST carry the same as-of/reporting-lag display
that `search-console-view` establishes. For `compare_search_console`, the "as-of" fact for each side of the
comparison is that snapshot's own `capturedAt` timestamp — the moment the underlying Search Console data
was captured into D1, not the moment the comparison was computed.

#### Scenario: A comparison shows the as-of date for each snapshot independently

- GIVEN a `compare_search_console` result is rendered
- WHEN the view renders it
- THEN it MUST show the base snapshot's `capturedAt` and the current snapshot's `capturedAt` as two
  separate as-of markers, not one shared value implied to cover both
