# Search Console View

## Purpose

The dashboard view over the verified, shipped `search_console_query` MCP tool. This view is
GROUNDED, not provisional: the tool exists today and its real input schema and result shape are
cited below from the source. This spec MUST NOT invent an input the tool does not accept, a
field the tool does not return, or a bound the code does not enforce. It consumes, and MUST NOT
redefine, `authenticated-source-contract` (credential containment, the two staleness axes,
independent upstream quota, and failure-class distinguishability), `dashboard-shell` (state
contract, keyboard reachability, no polling), `quota-visibility`, and `result-export`.

### Verified real shape (cited from source, re-read at spec time)

- Tool registration and input schema: `src/server.ts:240-283`. Real inputs, exactly:
  - `siteUrl: string, min length 1` — a Search Console property, e.g.
    `sc-domain:example.com` or `https://example.com/` (`src/server.ts:246-251`).
  - `startDate: string` matching `/^\d{4}-\d{2}-\d{2}$/` (`src/server.ts:252`).
  - `endDate: string` matching `/^\d{4}-\d{2}-\d{2}$/` (`src/server.ts:253`).
  - `dimensions: optional array` of `"query" | "page" | "country" | "device" | "date" |
"searchAppearance"` (`src/server.ts:254-265`).
  - `rowLimit: optional integer, 1 to 250` (`src/server.ts:266`).
  - The tool accepts **no** other input — no comparison-period parameter, no metric selector, no
    property-list input. There is no list-properties tool; `siteUrl` is supplied per call
    (confirmed in `proposal.md`'s Open Decisions table).
- Result shape, `src/google/search-console.ts:12-19`:
  `{ siteUrl: string, startDate: string, endDate: string, dimensions: string[], rowCount:
number, rows: GscRow[] }`, where each `GscRow` (`src/google/search-console.ts:4-10`) is
  `{ keys: string[], clicks: number, impressions: number, ctr: number, position: number }`.
- Dimension default: when the caller omits `dimensions`, the tool defaults server-side to
  `["query", "page"]` (`src/google/search-console.ts:36-38`).
- Row bound: `rowLimit` is clamped server-side to `[1, LIMITS.maxGscRows]` where
  `LIMITS.maxGscRows = 250` (`src/config.ts:28`, `src/google/search-console.ts:39-42`), and the
  returned `rows` array is independently truncated to `LIMITS.maxGscRows` again
  (`src/google/search-console.ts:82-83`). `rowCount` reflects the length of the returned (already
  bounded) `rows` array (`src/google/search-console.ts:97`), so `rowCount === 250` is the signal
  that the bound was reached, not evidence that exactly 250 rows exist upstream.
- Timeouts: `LIMITS.gscTimeoutMs = 15_000` for the Search Console call itself, and
  `LIMITS.googleTokenTimeoutMs = 10_000` for the token exchange (`src/config.ts:29-30`).
- Failure path today: any non-2xx upstream response or thrown error surfaces as a plain `Error`
  (`src/google/search-console.ts:76-81`) that reaches `errorResult` in `src/server.ts` as one
  `isError: true` plain-text tool failure — the same undifferentiated gap
  `authenticated-source-contract` requires be resolved before this view's failure states can be
  fully distinguished at the BFF layer.

## Requirements

### Requirement: Query Controls Match the Tool's Real Input Schema Exactly

The view MUST expose exactly the inputs `search_console_query` accepts — `siteUrl` (property
selector), `startDate` and `endDate` (each `YYYY-MM-DD`), and an optional `dimensions` selector
limited to `query`, `page`, `country`, `device`, `date`, `searchAppearance` — and MUST NOT
expose a control for any parameter the tool does not accept (e.g. a metric selector, a
comparison-period input, or a property-discovery control), since no such input or
list-properties tool exists.

#### Scenario: Site, date range, and dimensions are the only query controls

- GIVEN a user opens the Search Console view
- WHEN the query form is rendered
- THEN it MUST offer a site/property field, a start-date field, an end-date field, and an
  optional dimension selector limited to the six real dimension values, and MUST NOT offer any
  other query parameter control

#### Scenario: Date fields enforce the tool's real date format

- GIVEN a user enters a start or end date
- WHEN the value is validated before submission
- THEN it MUST be rejected client-side unless it matches `YYYY-MM-DD`, mirroring the server's
  `/^\d{4}-\d{2}-\d{2}$/` validation

#### Scenario: Omitted dimensions fall back to the real server default

- GIVEN a user submits a query without selecting any dimension
- WHEN the result is rendered
- THEN the view MUST reflect that the query used the `["query", "page"]` default the server
  applies, not an invented client-side default

#### Scenario: Row limit control, if offered, stays within the real bound

- GIVEN the view offers a row-limit control
- WHEN a user sets its value
- THEN the control MUST constrain the value to the range 1 to 250, matching
  `LIMITS.maxGscRows`, and MUST NOT allow a value the server would itself clamp silently

### Requirement: Result Table Renders the Real Row Shape

The result table MUST render, per row, exactly the fields `search_console_query` returns:
the dimension key(s) (`keys`), `clicks`, `impressions`, `ctr`, and `position`. The view MUST NOT
invent an additional metric, unit, or derived score the tool does not return.

#### Scenario: Each row shows clicks, impressions, CTR, and position

- GIVEN a query returns rows with `dimensions: ["query", "page"]`
- WHEN the result table renders
- THEN each row MUST show its `keys` (query and page), `clicks`, `impressions`, `ctr`, and
  `position`, and MUST NOT show a field absent from the real `GscRow` shape

#### Scenario: CTR is rendered as returned, not re-derived

- GIVEN a row's `ctr` value from the tool
- WHEN the view displays it
- THEN it MUST display the tool-provided `ctr` value (formatted for readability, e.g. as a
  percentage) rather than recomputing CTR from `clicks` and `impressions` independently

### Requirement: A 250-Row Result Is Labelled as Capped, Never as Complete

When a result's `rowCount` equals `LIMITS.maxGscRows` (250), the view MUST display a bound
badge naming the limit (e.g. "showing the first 250 rows — more may exist"), consistent with the
bound-versus-empty correctness rule `dashboard-views` established for other tools' caps. A
250-row result MUST NOT be presented as if it were the complete data set for the query.

#### Scenario: Exactly 250 rows triggers the bound badge

- GIVEN a query result has `rowCount: 250`
- WHEN the view renders the result
- THEN it MUST display a bound-reached indicator naming `maxGscRows` / the 250-row limit, and
  MUST NOT imply this is the complete result set

#### Scenario: Fewer than 250 rows renders without a bound badge

- GIVEN a query result has `rowCount: 37`
- WHEN the view renders the result
- THEN it MUST NOT display the bound-reached indicator, since the row count is below the cap

### Requirement: Absent Rows Are Distinguished From a Failed Query

A query that executes successfully and returns `rowCount: 0` MUST render a distinct "no rows for
this range/property/dimensions" empty state. This empty state MUST be visually and textually
distinct from any error state (credential failure, quota exhaustion, or tool failure) and from
the loading state, per the state-contract requirements already established in
`dashboard-shell` and `authenticated-source-contract`.

#### Scenario: Zero rows from a successful query shows the empty state

- GIVEN `search_console_query` returns `{ rowCount: 0, rows: [] }` for the requested range
- WHEN the view renders the result
- THEN it MUST show the empty-result state, and MUST NOT show a loading or error state

#### Scenario: A failed query never renders the empty state

- GIVEN `search_console_query` throws (e.g. the upstream call errors)
- WHEN the view renders the outcome
- THEN it MUST show the appropriate failure state (credential failure, quota exhaustion, or
  generic tool failure per `authenticated-source-contract`), and MUST NOT render the empty-result
  state

### Requirement: Reporting Lag and As-Of Date Are Displayed Per `authenticated-source-contract`

Every rendered Search Console result MUST display its `resultAge` (the BFF's cache age) and,
separately, an as-of/reporting-lag indicator reflecting that Search Console data itself lags
real time, per the two-staleness-axes requirement in `authenticated-source-contract`. The view
MUST NOT merge these into one figure.

#### Scenario: Both staleness figures appear on a rendered result

- GIVEN a Search Console result is rendered, whether freshly fetched or served from cache
- WHEN a user inspects the result
- THEN both `resultAge` and the reporting-lag/as-of indicator MUST be visible, and MUST be shown
  as two separate values

### Requirement: Every Query Is an Explicit User Action

The view MUST NOT issue a `search_console_query` request except as the direct result of an
explicit user action (e.g. submitting the query form). No timer, interval, visibility-change, or
focus/blur handler MUST trigger a request, consistent with `dashboard-shell`'s no-polling
requirement and with the additional cost of authenticated calls consuming the independent
upstream quota `authenticated-source-contract` requires be tracked.

#### Scenario: Returning to the tab issues no query

- GIVEN a Search Console result is already displayed and the browser tab loses then regains
  focus
- WHEN focus returns to the tab
- THEN the view MUST NOT issue a new `search_console_query` request as a result of that focus
  change

#### Scenario: No idle-timer refresh of Search Console data

- GIVEN the view has been open and idle for an extended period after rendering a result
- WHEN no user action has occurred
- THEN the view MUST NOT have issued any further `search_console_query` request since the last
  explicit user submission

### Requirement: Export Carries As-Of Date, Capping, and No Credential

An export (JSON or CSV) of a Search Console result MUST carry its as-of date /
reporting-lag indicator and, when `rowCount` is at the 250-row bound, an explicit marker that the
export is capped and may not represent the complete data set. The export MUST NOT contain any
Google credential or `MCP_AUTH_TOKEN`, per `authenticated-source-contract` and the existing
`result-export` no-secret-material requirement.

#### Scenario: Export of a capped result includes the cap marker

- GIVEN a rendered result has `rowCount: 250`
- WHEN the user exports it to JSON or CSV
- THEN the exported artifact MUST include a marker indicating the result was capped at 250 rows
  and may not be the complete data set

#### Scenario: Export always includes the as-of indicator

- GIVEN any rendered Search Console result, capped or not
- WHEN the user exports it
- THEN the exported artifact MUST include the as-of date / reporting-lag indicator alongside the
  row data

#### Scenario: Export contains no Google credential

- GIVEN a user exports a Search Console result
- WHEN the export is generated
- THEN it MUST NOT contain `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, any
  derived access token, or `MCP_AUTH_TOKEN`

## Worker Constraints

- The view issues no direct call to Google or to `seo-mcp`; it calls the BFF route only, which
  itself observes the `gscTimeoutMs` (15 s) and `googleTokenTimeoutMs` (10 s) budgets when
  bounding its own per-tool timeout, per `authenticated-source-contract`'s note that the BFF
  timeout for this tool must exceed `gsc-timeout + token exchange`.
- Rendering MUST NOT assume more than `LIMITS.maxGscRows` (250) rows will ever arrive in one
  response; the table MUST render correctly at the full 250-row bound without relying on
  unbounded client-side memory growth across repeated queries.
