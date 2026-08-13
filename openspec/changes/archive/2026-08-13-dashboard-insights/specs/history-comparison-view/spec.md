# Delta for History Comparison View

## Reconciliation status

Both sub-capabilities this view covers are now RECONCILED against real, shipped tools and D1 storage. This
is a substantial change from the previous state of this file, which asserted the entire capability was
unbuilt with "no tool with even a name." That is no longer true. Facts below are re-verified against the
current worktree, not assumed from prior planning.

### GSC-snapshot family (shares no credential distinction with crawl; both live in the same D1 database)

- `snapshot_search_console` — inputs `{ siteUrl, startDate, endDate, dimensions?, label? }`. Output: `{
snapshotId, siteUrl, rowCount, capturedAt }`. Rows are bounded by `LIMITS.maxSnapshotRows` (500) before
  storage (`src/db/gsc-store.ts:42-82`, `src/server.ts`).
- `list_search_console_snapshots` — inputs `{ siteUrl, limit?: 1-50 }`. Output: `{ siteUrl, count,
snapshots: StoredSnapshot[] }`. `StoredSnapshot` (`src/db/gsc-store.ts:4-11`): `{ id, siteUrl,
capturedAt, startDate, endDate, label: string | null }`. `listSnapshots` defaults to 20 rows when `limit`
  is omitted (`:93`), ordered most-recent-first.
- `compare_search_console` — inputs `{ siteUrl, baseSnapshotId?, currentSnapshotId? }`, defaulting to the
  two most recent snapshots (`twoMostRecent`, `:124-131`) when either ID is omitted. Returns an error
  result ("Need at least two snapshots to compare") when fewer than two snapshots exist for the site — not
  an empty diff. Output: `{ siteUrl, baseSnapshotId, currentSnapshotId, diff: GscDiff }`. `GscDiff`
  (`src/seo/gsc-diff.ts:21-28`): `{ baseCount, currentCount, decayed, improved, lost, gained }`, each an
  array of `GscDiffRow` (`:11-19`) truncated independently to `LIMITS.maxDiffRows`.
- Requires `env.DB` (D1); returns an error result, not a degraded success, when D1 is not configured.

### Crawl-snapshot family (credential-free — `crawl_site` needs no Google credential, unrelated to

`authenticated-source-contract`)

- `snapshot_crawl` — inputs `{ url, limit?: 1-20, concurrency?: 1-4, label? }`. Output: `{ snapshotId, url,
pageCount, capturedAt }`. Crawls via `crawlSite`, then stores via `storeCrawlSnapshot`
  (`src/db/crawl-store.ts:44-84`), bounding stored pages to `LIMITS.maxCrawlSnapshotPages`.
- `list_crawl_snapshots` — inputs `{ url, limit?: 1-50 }`. Output: `{ url, count, snapshots:
StoredCrawlSnapshot[] }`. `StoredCrawlSnapshot` (`:5-13`): `{ id, url, capturedAt, label: string | null,
crawled, failed, issueCounts: Record<string, number> }`. Defaults to 20 when `limit` is omitted (`:95`).
- `compare_crawls` — inputs `{ url, baseSnapshotId?, currentSnapshotId? }`, same two-most-recent default
  (`twoMostRecentCrawls`, `:116-123`) and same "need at least two snapshots" error behavior as
  `compare_search_console` (message: "Need at least two crawl snapshots to compare"). Output: `{ url,
baseSnapshotId, currentSnapshotId, diff: CrawlDiff }`. `CrawlDiff` (`src/seo/crawl-diff.ts:13-19`): `{
newPages: string[], removedPages: string[], newIssues: CrawlPageIssueChange[], resolvedIssues:
CrawlPageIssueChange[], issueCountDeltas: Record<string, number> }`. `CrawlPageIssueChange` is `{ page,
codes: string[] }`. Both page lists and both issue-change lists are independently sorted and truncated to
  `LIMITS.maxCrawlDiffRows` (`src/seo/crawl-diff.ts:94-99`).
- Requires `env.DB` (D1); same error-not-degraded behavior when D1 is not configured.

The two families are independent: a user may have crawl-snapshot history with no Search Console snapshots,
or the reverse. Neither sub-capability gates the other, and the view's navigation and onboarding states
below apply per family, not to the view as a whole.

### Verified retention defect — no automatic cleanup exists anywhere

`ROADMAP.md`'s "Resolved decisions" section states "rolling 90-day retention in D1" as a decided policy.
This is verified NOT implemented in code today: `src/db/gsc-store.ts` and `src/db/crawl-store.ts` contain
no `DELETE`, expiry, or age-based cleanup statement of any kind (grepped directly, confirmed empty).
`list_search_console_snapshots` and `list_crawl_snapshots` only bound how many stored snapshots are
**returned** by a given call (`limit`, 1-50, defaulting to 20) — not how many are **retained**. Snapshots
accumulate in D1 indefinitely; there is no scheduled or on-write deletion path today. This is a real
server-side gap against the documented decision, not a documentation lag this spec can paper over, and it
is recorded as a needed follow-up below rather than tasked in this change.

### Verified scheduling gap — the cron covers GSC snapshots only, not crawl snapshots

`src/scheduled.ts`'s `runScheduledSnapshots` (exercised by `test/integration/scheduled.test.ts`) captures
one `snapshot_search_console`-equivalent write per site listed in `GSC_SNAPSHOT_PROPERTIES`, on a scheduled
trigger. It does not call anything in the crawl-snapshot family. There is no scheduled/cron path for
`snapshot_crawl` at all — every crawl snapshot must be triggered manually by a user or an external caller.
`test/telemetry.test.ts` covers only `logRequestMetrics` (per-request logging), which is unrelated to
snapshot capture or retention and confirms nothing about crawl scheduling either way. The view MUST NOT
imply that crawl history builds up automatically the way GSC snapshot history can when configured.

## ADDED Requirements

### Requirement: Snapshot Retention Is Unbounded, Not a Rolling Window

Because no retention or expiry logic exists in `src/db/gsc-store.ts` or `src/db/crawl-store.ts`, stored
snapshots accumulate indefinitely regardless of age. The view MUST NOT state or imply that history is
bounded to a rolling 90-day (or any other) window, since no such enforcement exists today. Where the view
lists snapshots, it MUST make clear that the `limit` parameter bounds how many snapshots are shown in that
list, not how many exist or are retained.

#### Scenario: The view does not claim a retention window that does not exist

- GIVEN a user views a list of stored Search Console or crawl snapshots
- WHEN the view renders that list
- THEN it MUST NOT state or imply a fixed retention window (e.g. "last 90 days") bounds the underlying
  stored history, because no such enforcement exists in the system today

#### Scenario: A capped snapshot list is not presented as the complete history

- GIVEN `list_search_console_snapshots` or `list_crawl_snapshots` returns exactly `limit` snapshots
- WHEN the view renders that list
- THEN it MUST show a bound-reached indication naming the limit, and MUST NOT present the list as the
  complete stored history for that site or URL

### Requirement: Crawl-Snapshot Capture Is Manual Only — No Automatic Cron Exists

Because `src/scheduled.ts`'s `runScheduledSnapshots` only captures Search Console snapshots for properties
listed in `GSC_SNAPSHOT_PROPERTIES`, and no equivalent scheduled path exists for `snapshot_crawl`, the
crawl-snapshot comparison entry point MUST state that crawl history only grows when a user (or an external
caller) explicitly triggers `snapshot_crawl`. The view SHOULD surface this as an onboarding nicety — it is
not a hard blocking requirement — so a user does not wait for crawl history to "fill in" the way scheduled
GSC snapshots might.

#### Scenario: The crawl-history view states capture is manual

- GIVEN a user opens the crawl-snapshot comparison entry point for a URL with fewer than two snapshots
- WHEN the view renders its onboarding state
- THEN it SHOULD state that a new crawl snapshot must be captured explicitly (there is no automatic
  scheduled capture for crawl history)

### Requirement: A Comparison Names Both Endpoints Explicitly

Every comparison this view renders — whether from `compare_search_console` or `compare_crawls` — MUST
display both `baseSnapshotId` and `currentSnapshotId`, and each snapshot's own `capturedAt` timestamp, so a
user always sees which two captures produced the diff. A comparison MUST NOT be rendered with only a delta
or diff body and no visible statement of which two snapshots produced it.

#### Scenario: A GSC comparison names both snapshot IDs and their capture times

- GIVEN a `compare_search_console` result is rendered
- WHEN the view displays that result
- THEN both `baseSnapshotId` and `currentSnapshotId` MUST be visible, each with its own `capturedAt`

#### Scenario: A crawl comparison names both snapshot IDs and their capture times

- GIVEN a `compare_crawls` result is rendered
- WHEN the view displays that result
- THEN both `baseSnapshotId` and `currentSnapshotId` MUST be visible, each with its own `capturedAt`

### Requirement: Fewer Than Two Snapshots Is a Distinct, Actionable State

`compare_search_console` and `compare_crawls` both return a dedicated error result — not an empty diff —
when fewer than two snapshots exist for the requested site or URL ("Need at least two snapshots to
compare" / "Need at least two crawl snapshots to compare"). The view MUST render this as its own
actionable "capture history first" state, distinguishable from a generic tool-failure state and from a
genuine zero-change comparison result (where two snapshots exist and every diff bucket is legitimately
empty).

#### Scenario: A site or URL with no snapshot history shows a capture-first state

- GIVEN a comparison is requested for a site or URL with zero or one stored snapshot
- WHEN the underlying tool returns its "need at least two snapshots" error
- THEN the view MUST render a distinct state instructing the user to capture a snapshot first, and MUST
  NOT present this as a generic failure or as an empty comparison result

#### Scenario: A genuine empty diff is distinct from a missing-history state

- GIVEN two snapshots exist and every bucket of the resulting diff is legitimately empty (no decay, no
  improvement, no lost/gained rows, or no new/removed pages or issues)
- WHEN the view renders that comparison
- THEN it MUST show a "no changes detected between these two snapshots" state, distinct from the
  "capture history first" state, and MUST still name both snapshot IDs and their capture times

### Requirement: Diff Direction Is Unambiguous for Both Snapshot Families

For GSC comparisons, `compare_search_console`'s `diff` classifies each query/page pair into exactly one of
`decayed`, `improved`, `lost`, or `gained` before the view sees it (`src/seo/gsc-diff.ts`). For crawl
comparisons, `compare_crawls`'s `diff` separately reports `newPages` vs. `removedPages` and `newIssues` vs.
`resolvedIssues` (`src/seo/crawl-diff.ts`). In both families, the view MUST render each of these as its own
distinct, unambiguous state — a decline-shaped fact (`decayed`, `lost`, `removedPages`, `newIssues`) MUST
NOT share a visual treatment (color, icon, or sign) with an improvement-shaped fact (`improved`, `gained`,
`newPages`, `resolvedIssues`) for the same metric.

#### Scenario: New pages and removed pages cannot share a presentation

- GIVEN a `compare_crawls` result includes both `newPages` and `removedPages` entries
- WHEN the view renders both lists
- THEN it MUST use visually distinct presentations for `newPages` (addition) and `removedPages` (loss)

#### Scenario: New issues and resolved issues cannot share a presentation

- GIVEN a `compare_crawls` result includes both `newIssues` and `resolvedIssues` entries for the same page
- WHEN the view renders both
- THEN it MUST use visually distinct presentations for `newIssues` (regression) and `resolvedIssues`
  (improvement), and MUST NOT collapse them into one undifferentiated "changed issues" list

#### Scenario: GSC decay-direction buckets remain distinct within this view

- GIVEN a `compare_search_console` result is rendered inside this view's comparison surface
- WHEN the view renders its `decayed`, `improved`, `lost`, and `gained` buckets
- THEN each MUST use the same distinct, non-interchangeable presentations required by `gsc-insight-views`'
  "Content-Decay Direction Is Unambiguous Across All Four Buckets" requirement, since this view renders the
  same tool output

### Requirement: Both Sub-Capabilities Ship and Degrade Independently

A user may have crawl-snapshot history with no Search Console snapshots for any property, or the reverse.
The view MUST allow each sub-capability's comparison entry point to reach its own "ready", "needs more
history", or active-comparison state independently of the other's state. Neither sub-capability's
availability, snapshot count, or comparison result MUST block, hide, or degrade the other's entry point.

#### Scenario: Crawl history is usable with zero GSC snapshots

- GIVEN a URL has two or more stored crawl snapshots and its site has zero stored Search Console snapshots
- WHEN a user opens the crawl-snapshot comparison entry point
- THEN it MUST render an active comparison, unaffected by the absence of GSC snapshot history

#### Scenario: GSC comparison is usable with zero crawl snapshots

- GIVEN a site has two or more stored Search Console snapshots and its URL has zero stored crawl snapshots
- WHEN a user opens the GSC-snapshot comparison entry point
- THEN it MUST render an active comparison, unaffected by the absence of crawl snapshot history

## Required Server-Side Follow-Ups (not tasked in this change)

- **Retention enforcement is undecided in code.** `ROADMAP.md` states a 90-day rolling retention decision
  that has no corresponding deletion, expiry, or cleanup logic in `src/db/gsc-store.ts` or
  `src/db/crawl-store.ts`. This needs a dedicated server-side change (scheduled cleanup job, or
  delete-on-write-beyond-window logic) before the documented decision matches reality. Until that change
  ships, this view's spec treats retention as unbounded, per the requirements above.
- **No scheduled capture exists for crawl snapshots.** Only Search Console snapshots have a cron path
  (`src/scheduled.ts`). If scheduled crawl-snapshot capture is wanted, it needs its own server-side change
  analogous to `runScheduledSnapshots`, not assumed here.

## Required Amendments To Sibling Changes

None. The disabled/onboarding-navigation-entry states this spec relies on are instances of the existing
`dashboard-shell` "distinguishable states" contract from `dashboard-views`; no new state category needs to
be added to that spec to represent "capture history first" or "no changes detected."
