# Design: Dashboard Views

## Technical Approach

A React SPA lives at `bff/ui/`, is built by Vite into `bff/ui/dist/`, and is served by the **existing BFF
Worker** through an `assets` binding with `run_worker_first: true`, so the gate (`bff/src/gate.ts`) runs before
any byte of any asset is served. The SPA consumes only the foundations contract — **`GET /api/tools/{tool}`**
with inputs as query-string parameters, matching `bff/src/router.ts`'s real, frozen contract — returning
`BffOk<T> | { error: BffError }`, plus a new read-only `GET /api/usage`, and imports result types from
`src/types/index.ts`. It re-derives nothing and duplicates no shape.

**One documented exception**: `analyze_pagespeed` accepts `POST` with a JSON body specifically for calls
carrying the secret `apiKey` input, and REJECTS `apiKey` supplied over `GET` as a query-string parameter —
a security fix added during `pagespeed-view`'s own implementation (a query string is visible in DevTools'
Network tab and any access log; a POST body is not). `GET` remains available on that same route for the
no-`apiKey` case, and no other route accepts anything but `GET`. See
`openspec/specs/dashboard-bff/spec.md`'s "A Secret-Bearing Input Never Travels as a Query-String Parameter"
requirement for the merged, authoritative record.

Four correctness mechanisms carry the specs, each a single module rather than a per-view convention:

| Mechanism                | Module                  | Satisfies                                                                     |
| ------------------------ | ----------------------- | ----------------------------------------------------------------------------- |
| Exhaustive error mapping | `ui/src/data/errors.ts` | `dashboard-shell` (every code has a presentation), all views' failure paths   |
| Cardinality / bounds     | `ui/src/data/bounds.ts` | `site-crawl-view`, `broken-links-view`, `result-export`, shell empty-vs-bound |
| Gesture-gated fetching   | `ui/src/data/client.ts` | `dashboard-shell` no-polling, `broken-links-view` on-demand-only              |
| One-shot secret cell     | `ui/src/data/secret.ts` | `pagespeed-view` key handling, `result-export` no-secret                      |

`src/**`, root `wrangler.jsonc`, `src/http/*` and `src/security/*` are untouched. `check_links` remains the
only tool whose upstream defect (`LIMITS.linkCheckSubrequestBudget: 60` above the Free-plan ceiling) is
surfaced, never fixed, here.

## Architecture Decisions

### Decision: asset serving cannot precede the gate

| Option                                                                                                    | Tradeoff                                                                                           | Decision   |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------- |
| `assets` binding with `run_worker_first: true`, worker calls `env.ASSETS.fetch(request)` after gate allow | Every request costs a Worker invocation; the gate is unbypassable by construction                  | **Chosen** |
| `assets` with default routing (`run_worker_first` unset)                                                  | The Asset Worker answers matching paths **before** the user Worker — the gate is silently bypassed | Rejected   |
| `run_worker_first: ["/api/*", "/auth/*"]` (array form)                                                    | Inverts the default only for API paths; asset paths still bypass the gate                          | Rejected   |
| Separate static host / Pages project                                                                      | Second origin, second gate, cookie scope problems                                                  | Rejected   |

**Verified** against `node_modules/wrangler/config-schema.json:3837-3885`: `run_worker_first` accepts `true`
meaning "every request should be routed to the User Worker". `not_found_handling: "single-page-application"`
gives deep-link support once the request reaches the Asset Worker.

```jsonc
// bff/wrangler.jsonc (added)
"assets": {
  "directory": "./ui/dist",
  "binding": "ASSETS",
  "not_found_handling": "single-page-application",
  "run_worker_first": true
}
```

Regenerate `Env` with `pnpm types:bff` (`wrangler types -c bff/wrangler.jsonc`); never hand-write it.
Router order is fixed and asserted: `authorize()` → `/auth/*` → `/api/*` → `env.ASSETS.fetch(request)`.
`ASSETS.fetch` is `await`ed and returned; no floating promise, no `waitUntil` needed.

### Decision: build, typecheck and test wiring

`bff/ui/` gets its own `tsconfig.json` (`jsx: "react-jsx"`, `lib: ["ES2023","DOM","DOM.Iterable"]`, no Workers
types) and is **excluded** from the root `tsconfig.json`, because DOM `lib` and `@cloudflare/workers-types`
collide on `fetch`/`Response`/`caches` declarations. `pnpm typecheck` becomes
`tsc --noEmit && tsc --noEmit -p bff/ui`. A fourth vitest project `vitest.ui.config.ts`
(`name: "ui"`, `environment: "jsdom"`, `include: ["bff/ui/**/*.test.tsx"]`) is composed into
`vitest.config.ts` `projects`, so `pnpm test` stays the single command. `bff/ui/dist` is added to `.gitignore`
and `.prettierignore`; `bff/ui/src` is covered by `pnpm format:check` unchanged. New scripts: `build:ui`
(`vite build`), `dev:ui` (Vite dev server proxying `/api` and `/auth` to `wrangler dev`), and `deploy:bff`
gains a `build:ui` prerequisite so a deploy can never ship a stale bundle.

### Decision: atomic design with a hard container boundary

```
bff/ui/src/
├── app/            shell, router, nav, layout, focus manager
├── atoms/          Badge Button Stat Absent SampleBadge Countdown Spinner VisuallyHidden
├── molecules/      StatGroup KeyValueList CategoryCard IssueRow ProbeRow SampleList
│                   ErrorPanel StateRegion FreshnessBadge HeadroomIndicator ExportMenu
├── organisms/      OnPageCard HeadingsPanel OpenGraphPanel JsonLdPanel IssuesList
│                   DomainSummaryPanel CrawlPolicyPanel LinkGraphPanel PerPageTable
│                   BrokenLinksPanel ScorePanel LabMetricsPanel FieldDataPanel
│                   OpportunitiesTable CrawlForm PageSpeedForm PageUrlForm
├── containers/     PageReportContainer BrokenLinksContainer SiteCrawlContainer
│                   PageSpeedContainer UsageContainer
├── charts/         BarChart ScoreGauge
├── data/           client.ts errors.ts bounds.ts secret.ts usage.ts
└── export/         json.ts csv.ts shapes/
```

| Layer                              | MAY                                                                                                                                                          | MUST NOT                                                                                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container                          | call `data/*`, own `AbortController` + request id, map `BffError` → presentation, derive `Bound[]`, own submit/confirm/countdown state, own the focus target | contain layout markup beyond composing one organism; render field values directly                                                                                                            |
| Organism / molecule / atom / chart | be a pure function of props; render `Cardinality` and `ErrorPresentation` values it is handed                                                                | import `data/client`, `fetch`, `localStorage`/`sessionStorage`/`document.cookie`, `window.location`; hold async state; call `setInterval`/`setTimeout`; format absence ad hoc (use `Absent`) |

The boundary is enforced by a unit test that walks `bff/ui/src/{atoms,molecules,organisms,charts}` and fails on
any forbidden import or global — a structural test, not a review convention.

Shared primitives the seven views actually reuse (no speculative library): `Stat`/`StatGroup` (link counts,
`checked/ok/broken/errors`, four PageSpeed scores), `Absent` (every optional field across `PageSignals`,
`labMetrics`, `savingsMs`), `SampleBadge` + `SampleList` (every capped field), `CategoryCard`
(`DomainCategory` × 4 plus `disallowedSkipped`), `Badge` (issue severity, probe state, cache status),
`StateRegion` (the loading/empty/bound/error switch every panel wraps), `ErrorPanel`, `FreshnessBadge`,
`ExportMenu`.

### Decision: fetching is gesture-gated, not discipline-gated

`requestTool` requires a branded capability token that can only be minted from a DOM event:

```ts
declare const brand: unique symbol;
export type UserIntent = { readonly [brand]: "user-intent" };
export function userIntent(event: { type: string }): UserIntent; // only mint site
export function requestTool<T>(
  tool: ToolName,
  input: unknown,
  intent: UserIntent,
  opts: { signal: AbortSignal; refresh?: boolean; secret?: SecretCell },
): Promise<BffOk<T> | { error: BffError }>;
```

No effect, timer or listener can construct a `UserIntent`, so "no polling / no auto-refresh / no
refresh-on-focus" is a type-level property. Backstopped by a structural test asserting that no file under
`bff/ui/src` registers `visibilitychange`, `focus`, `blur`, `online`, `pageshow`, or `setInterval`, and that no
`useEffect` body references `requestTool`. `BrokenLinksContainer` holds no auto-trigger at all: its only entry
point is the "Check links" button handler.

Cancellation: each container keeps `{ controller, requestId }` in a ref. `submit` aborts the previous
controller, increments `requestId`, and discards any resolution whose id is not current; route unmount aborts in
cleanup. `AbortError` maps to no error presentation — an abandoned request is not a failure.

Freshness: containers store the **whole** `BffOk<T>` envelope, not just `data`. `FreshnessBadge` receives
`{ cacheStatus, resultAge, receivedAtMs }` and computes displayed age on render only; no ticking timer. Explicit
refresh is the same submit path with `refresh: true` → `?refresh=1`. The single permitted timer in the app is
the `retryAfter` countdown, which re-enables a disabled control and never fetches.

### Decision: no client-side result cache

The BFF KV cache is the only cache. A browser-side cache keyed by request input would need a key derived from
`analyze_pagespeed` inputs including `apiKey`, recreating exactly the leak `pagespeed-view` forbids. Rejected
alternatives: an in-memory `Map` keyed by input hash (leak surface, and duplicates `resultAge` semantics);
`localStorage` persistence (a bounded/keyed result surviving a session is a data-retention question nobody
answered). Navigating back to a view therefore shows the last in-memory envelope or an empty state; it never
refetches.

## Error Presentation Mapping

`ERROR_PRESENTATION: Record<BffErrorCode, ErrorPresentation>` is typed against the union imported from
`bff/src/errors.ts`. Adding a code upstream breaks `pnpm typecheck` until it is mapped; lookup goes through
`presentFor(code)` which returns the unmapped state for any runtime value absent from the record. That
type + fallback pair is the artifact satisfying the shell requirement.

| `code`                  | Presentation                                                                          | Placement              | Retry affordance                   |
| ----------------------- | ------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------- |
| `gate_unauthorized`     | Session expired / not authenticated; re-authenticate action                           | Full-view interstitial | Re-auth, not tool retry            |
| `gate_unavailable`      | Dashboard access is misconfigured; operator action named                              | Full-view interstitial | Manual retry enabled               |
| `invalid_input`         | Field-level validation message on the submitting form; focus first invalid field      | Inline in form         | Fix and resubmit                   |
| `upstream_unauthorized` | Dashboard cannot authenticate to the MCP server; operator action, not a user action   | Panel                  | Disabled (retry cannot help)       |
| `upstream_rate_limited` | Shared bucket exhausted + `retryAfter` countdown + shared-bucket explanation          | Panel                  | Disabled until countdown reaches 0 |
| `upstream_unavailable`  | MCP server temporarily unavailable                                                    | Panel                  | Enabled                            |
| `upstream_forbidden`    | Target URL rejected by host/origin policy; actionable "use a different URL"           | Inline near URL field  | Fix and resubmit                   |
| `upstream_protocol`     | Unexpected reply from the MCP server; report-to-operator hint                         | Panel                  | Enabled                            |
| `tool_failed`           | Tool reported a failure, forwarded `message` verbatim (already redacted by the BFF)   | Panel                  | Enabled                            |
| `result_invalid`        | Server returned a result the dashboard cannot trust; **no partial render**            | Panel                  | Enabled                            |
| `bff_timeout`           | Request exceeded its time budget; for `crawl_site` adds "lower `limit`/`concurrency`" | Panel                  | Enabled                            |
| _unrecognized_          | Explicit unmapped-error state naming the raw `code` and `message`                     | Panel                  | Enabled                            |

No branch of this table renders a result region. `page-report-view`, `broken-links-view` and `site-crawl-view`
all render `ErrorPanel` in place of their data regions, so no error path can present as `broken: 0`, a
zero-issue report, or an empty crawl.

## The Bound-Versus-Empty Mechanism

One type, one derivation module, three consumers (views, badges, export).

```ts
export type BoundKind =
  "output_bytes" | "sample_cap" | "group_cap" | "probe_cap";
export interface Bound {
  kind: BoundKind;
  scope: string; // e.g. "summary.duplicateTitles[0].sample"
  limitName: string;
  limitValue: number; // e.g. "DomainCategory.sample", 25
  shown: number;
  total?: number; // total absent => bound inferred from the cap
}
export type Cardinality =
  | { state: "none" } // count === 0 -> explicit "none found"
  | { state: "complete"; total: number } // shown === total
  | { state: "bounded"; bound: Bound }
  | { state: "unknown" }; // could not be determined (never "none")
```

`bounds.ts` exposes pure derivations — `describeCategory`, `describeDuplicateGroups`, `describeSitemaps`,
`describeOrphans`, `describeTopLinked`, `describeProbeSet`, `describeOutputBytes` — plus
`collectBounds(tool, result): Bound[]`. Panels render `Cardinality` through `SampleBadge`/`SampleList`; export
calls the **same** `collectBounds` for provenance. There is no second badge implementation to drift.

Real caps, read from source:

| Field                                                                      | Cap                             | Evidence                           |
| -------------------------------------------------------------------------- | ------------------------------- | ---------------------------------- |
| `SiteCrawlResult.outputBytes`                                              | `maxSiteOutputBytes` 256,000    | `src/config.ts:15`                 |
| `DuplicateGroup.sample`                                                    | 10 URLs, independent of `count` | `src/crawl/site.ts:192`            |
| `duplicateTitles` / `duplicateDescriptions` list                           | 20 groups                       | `src/crawl/site.ts:199`            |
| `DomainCategory.sample` (missingH1, multipleH1, thinContent, nonIndexable) | 25, independent of `count`      | `src/crawl/site.ts:203`            |
| `crawlPolicy.sitemapsDeclared`                                             | 20                              | `src/crawl/site.ts:297`            |
| `crawlPolicy.disallowedSkipped.sample`                                     | 25                              | `src/crawl/site.ts:300`            |
| `linkGraph.orphanPages.sample`                                             | 25                              | `src/crawl/site.ts:120`            |
| `linkGraph.topLinkedPages`                                                 | 10, **no total is returned**    | `src/crawl/site.ts:134`            |
| `LinkCheckResult.checked`                                                  | `maxLinkChecks` 50              | `src/config.ts:24`, `links.ts:108` |

Two cases have no explicit total and are handled deliberately, not silently: `topLinkedPages` at length 10 and
a duplicate-group list at length 20 yield `state: "bounded"` with `total` omitted (the badge names the cap, not
a missing total); below the cap they are `complete`. `outputBytes` produces an `output_bytes` bound when it is
at or near 256,000 **and** `crawled + failed < requested` — surfaced at crawl-result level, independently of and
in addition to per-category sample labels, per `site-crawl-view`. `checked === 50` yields `probe_cap` naming
50; below 50 yields `complete`, so the "no bound indicator below the bound" scenario holds by construction.

## Long-Running Crawl UX

```mermaid
sequenceDiagram
  autonumber
  participant U as User
  participant C as SiteCrawlContainer
  participant W as CrawlForm (+ confirm)
  participant B as BFF GET /api/tools/crawl_site
  participant M as seo-mcp crawl_site
  U->>W: limit 5 / concurrency 2 (defaults), Submit
  W->>W: limit 20 or concurrency 4? -> warned confirm step (~40s, shared bucket)
  W->>C: userIntent(event) + validated input
  C->>C: abort previous controller, requestId++, submit DISABLED, in-flight state
  alt Resolution A — bounded JSON response (today)
    C->>B: fetch(?url&limit&concurrency, signal) — GET, query-string input, no body
    B->>M: service binding, AbortSignal.timeout(55s)
    Note over C,B: view shows an explicit indeterminate "crawl in progress" state, never a frozen UI
    M-->>B: SiteCrawlResult (~40s worst case)
    B-->>C: { data, cacheStatus, resultAge }
  else Resolution B — SSE progress on the SAME path
    C->>B: fetch(body, signal) — Accept: text/event-stream
    B-->>C: progress frames { crawled, requested }
    Note over C,B: view shows DETERMINATE progress from the frames
    B-->>C: terminal frame = the same BffOk envelope
  else BFF timeout (either resolution)
    B-->>C: { error: { code: "bff_timeout" } }
    C->>C: ErrorPanel + "lower limit/concurrency" guidance; submit re-enabled
  end
  C->>C: store envelope, derive Bound[], move focus to the results region heading
```

The route shape survives either resolution: the container reads the response through one
`readToolResponse(response)` seam that dispatches on `content-type` and yields
`AsyncIterable<Progress> & Promise<Envelope>`; a bounded JSON response simply yields zero progress frames. The
view's progress component takes `Progress | "indeterminate"`, so choosing B later changes one argument, not the
view. Resubmission of the same `{ site, limit, concurrency }` is blocked while its request is in flight, keyed
by the in-flight input, so a second site can still be crawled but a duplicate cannot.

## Charting Primitives

Two hand-rolled SVG components, both pure presentational.

- `charts/BarChart.tsx` — horizontal bars for `linkGraph.topLinkedPages`. Authored as a real
  `<table>` of URL and inbound count with the SVG bars `aria-hidden="true"` decoration layered over it. The data
  is therefore natively accessible and screen-reader-navigable; the chart cannot become the only channel. Order
  is the result's order, never re-sorted client-side.
- `charts/ScoreGauge.tsx` — one per PageSpeed category. Renders `role="img"` with an `aria-label` of
  "{category}: {score} of 100, {band}", **plus always-visible text** for the numeric score and the band label
  ("Good" / "Needs improvement" / "Poor"). Band is encoded by three redundant channels — text label, arc
  fill, and stroke dash pattern — so color alone never carries meaning. Nothing is hover-only or
  tooltip-only. An absent score renders `Absent` ("unavailable"), never a 0-value arc.
  `prefers-reduced-motion: reduce` suppresses the arc transition.

Both components accept explicit dimensions in relative units and no fixed pixel width, so they survive the
narrow-viewport requirement.

## Export Implementation

`export/json.ts` emits `{ result, provenance }` where `result` is the rendered `data` **verbatim** — no
reshaping, renaming, dropping, or added fields inside it — and `provenance` is a sibling object carrying
`{ exportedAt, tool, cacheStatus, resultAge, bounds: Bound[], omittedFields: string[] }`. Alternative rejected:
merging markers into the result object (violates the fidelity requirement) or a separate sidecar file (a
download the user can lose). Export always reads the container's current envelope, so a refreshed view exports
the new result by construction.

`export/csv.ts` resolves an open decision through a seam rather than pre-empting it:

```ts
export interface CsvShape<T> {
  readonly id: string;
  readonly columns: readonly string[];
  rows(result: T): ReadonlyArray<ReadonlyArray<string>>;
  readonly omitted: readonly string[]; // declared, never silent
}
export const CSV_SHAPES: {
  crawl_page: CsvShape<PageAnalysis>;
  crawl_site: CsvShape<SiteCrawlResult>; /* ... */
};
```

Each candidate resolution — one flat per-page sheet, or multiple sections concatenated with section headers —
is a different `CsvShape<SiteCrawlResult>` implementation registered under the same key. Nothing else changes.
Two invariants are binding regardless: identical input yields identical `columns` and rows (golden test), and
`columns ∪ omitted` must cover every key of the published result type (an exhaustiveness test, so a new server
field fails the suite instead of vanishing). `omitted` is written into the provenance block and, for CSV, into
a leading comment row plus a companion provenance section.

`SiteCrawlResult.pages` entries are `{ url; result?; error? }` — a discriminated XOR — so "no result" is a
first-class row state, not a gap: every row carries `rowState` ∈ `analyzed | failed`; a failed row populates
`error` and leaves issue-derived columns **empty**, never `0`. A sampled group's rows carry a `sampleOf` column
naming its `count`, satisfying the CSV sample-marker scenario.

Delivery is client-side: `Blob` → `URL.createObjectURL` → anchor click → `revokeObjectURL` in the same handler.
Export never issues a request, so it never spends the shared bucket, and it is never blocked by a bound —
a bound only adds provenance.

## Secret Handling in the UI

The PageSpeed `apiKey` is never a value the application holds.

1. `PageSpeedForm` renders an **uncontrolled** `<input type="password" name="apiKey" autoComplete="off">`. The
   value is read from `FormData` inside the submit handler and never enters React state, so it never appears in
   a render tree, a devtools state snapshot, or a serialized route.
2. It is immediately wrapped in a one-shot cell: `SecretCell = { take(): string | undefined }` whose backing
   value is cleared on first `take()`. `client.ts` takes it once to build the request body. Nothing downstream
   can re-read it — not a cache key, not a log line, not a retry.
3. The container's state type `PageSpeedViewState` has **no** `apiKey` field, so retaining the key is a
   compile error rather than a review finding.
4. Transport is the POST body only, matching the real implementation exactly: `requestTool()` sends the
   whole request as `POST` with a JSON body whenever `opts.secrets` is present, never appending anything to
   the query string. There is no separate `stripSecrets()` function — that speculative mechanism was never
   built, and isn't needed: `PageSpeedViewState` simply has no `apiKey` field (point 3 above) and nothing
   else in the UI constructs navigation state from form input, so there is no boundary left for a key to
   leak through.
5. The key input is cleared after submit; there is no client-side result cache to key on (see the decision
   above), and foundations already bypasses KV caching for keyed requests.
6. The UI renders only fields declared by `PageSpeedResult`. An echoing response therefore cannot surface the
   key in the view even if the BFF regressed; the response-echo prohibition itself is a BFF property, and the
   UI's contribution is the integration test with an echoing stub.

Verified by tests, not intention: after a keyed submit, `localStorage`, `sessionStorage`, `document.cookie` and
`location.href` contain no substring of the key; `JSON.stringify(containerState)` contains none; both JSON and
CSV exports contain none; a second `take()` returns `undefined`; no `console.*` call exists on the submission
path (structural test). `MCP_AUTH_TOKEN` is never in the browser at all — the SPA never sees a token and has no
code path that could carry one.

## Quota and Freshness

`UsageContainer` fetches `GET /api/usage` **once per explicit user action** (initial mount is itself a user
navigation, and this route does not spend the MCP bucket — it reads the BFF's own accounting). `HeadroomIndicator`
renders the figure with a visible "estimate" qualifier and an expandable explanation stating that the figure
covers only BFF-observed traffic because the Workers rate-limit binding reports success/failure and never a
remaining count. Display semantics remain open; the component takes
`{ observed, windowSeconds, limit, asOf }` so any of the candidate semantics renders without a redesign.

## File Changes

| File                                                                          | Action          | Description                                                                 |
| ----------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------- |
| `bff/ui/{index.html,vite.config.ts,tsconfig.json}`                            | Create          | SPA entry, Vite build to `ui/dist`, DOM-typed TS project                    |
| `bff/ui/src/{app,atoms,molecules,organisms,containers,charts,data,export}/**` | Create          | SPA per the layout above                                                    |
| `bff/wrangler.jsonc`                                                          | Modify          | `assets` binding with `run_worker_first: true`                              |
| `bff/worker-configuration.d.ts`                                               | Regenerate      | `pnpm types:bff` — never hand-edited                                        |
| `bff/src/router.ts`, `bff/src/index.ts`                                       | Modify          | `env.ASSETS.fetch` fallback after gate; `GET /api/usage`                    |
| `bff/src/usage.ts`                                                            | Create          | Read-only observed-call accounting for `quota-visibility`                   |
| `vitest.ui.config.ts`, `vitest.config.ts`                                     | Create / Modify | Fourth `ui` project (jsdom), composed into `projects`                       |
| `package.json`                                                                | Modify          | `build:ui`, `dev:ui`, `typecheck` (two projects), `deploy:bff` prerequisite |
| `.gitignore`, `.prettierignore`                                               | Modify          | `bff/ui/dist`                                                               |
| `src/**`, root `wrangler.jsonc`, `src/http/*`, `src/security/*`               | Unchanged       | Any drift here is a scope escalation                                        |

New devDependencies: `vite`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/react`,
`@testing-library/user-event`, `axe-core`; dependencies: `react`, `react-dom`.

## Testing Strategy

Strict TDD: every row's RED test precedes implementation, and each RED test is written directly from a spec
scenario.

| Layer                                            | What to Test                                                                                                                                                                                                                                                                                                                                                                  | Approach                                                                                                                                                                                                                      |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit — pure logic (`ui` project)                 | `bounds.ts` for every capped field incl. `count === sample.length` (not a sample), `count === 0` (none, not unknown), `topLinkedPages` at 10, `outputBytes` at cap with `crawled+failed < requested`; `errors.ts` exhaustiveness + unmapped fallback; CSV golden, stability, and `columns ∪ omitted` coverage; JSON fidelity                                                  | Fixtures built from the published types in `src/types/index.ts`; no DOM needed                                                                                                                                                |
| Unit — components (`ui` project)                 | Every spec scenario per view: absent-vs-zero (`Absent` for missing `canonical`/`speedIndexMs`, literal `0` for `cumulativeLayoutShift: 0`), all 13 issue codes and their emitted severities plus an unknown code, `checked/ok/broken/errors` simultaneously visible, broken-vs-error rendering, `robotsFound: false` distinct, failed page row shows error not an issue count | `@testing-library/react` render + assertions on accessible roles/names, not class names                                                                                                                                       |
| Unit — structural invariants                     | No `visibilitychange`/`focus`/`blur`/`setInterval` listener anywhere; no `useEffect` referencing `requestTool`; presentational layers import no `data/client`, storage API or `window.location`; no `console.*` on the submission path                                                                                                                                        | Source-scanning tests over `bff/ui/src` — these are the tests that make the no-polling and secret rules structural                                                                                                            |
| Unit — accessibility                             | `axe-core` violations = 0 on every view in loading, empty, bound, error and populated states; full Tab/Shift+Tab order reaches every control; `document.activeElement` lands in the new region after an async transition; `BarChart` data readable from its `<table>` with the SVG `aria-hidden`; gauge band legible from text alone                                          | `axe-core` + `user-event` in jsdom; charts asserted through the table fallback so "perceivable without color or hover" is a real assertion                                                                                    |
| Unit — secrets                                   | After a keyed submit: no key in `localStorage`/`sessionStorage`/`document.cookie`/`location.href`, none in serialized container state, none in either export; second `take()` returns `undefined`                                                                                                                                                                             | jsdom with real storage APIs; stub `fetch` capturing the request body                                                                                                                                                         |
| Integration (Miniflare, `bff/test/integration/`) | **Gate-before-assets ordering, RED first**: unauthenticated `GET /`, `/index.html`, `/assets/<hashed>.js`, `/favicon.ico`, and an unknown deep link each return `gate_unauthorized` and reach no asset; with a session each returns 200. `GET /api/usage` behind the gate. An echoing PageSpeed stub proves the view renders no key                                           | `defineWorkersProject` on `bff/wrangler.jsonc` with a built `ui/dist` fixture. The RED run must fail **because assets are served before the worker**, proving `run_worker_first: true` is load-bearing rather than decorative |
| Not automated                                    | Responsive layout at 360px and 1440px                                                                                                                                                                                                                                                                                                                                         | jsdom cannot lay out. Partially covered by asserting no fixed-pixel width in data regions; the remainder is a documented manual check per view. Stated honestly rather than claimed as automated                              |

## Threat Matrix

Applicable boundary: HTTP routing (a new asset route and a new usage route on the token-holding Worker) and
secret handling in a browser-reachable surface. Reference rows: documentation-like paths — **N/A**, no file
classification or execution; Git repository selection, commit state, push state, PR commands — **N/A**, no VCS
or PR automation; shell/subprocess — **N/A**. Substituted applicable cases, each with a RED test:

| Case                                                                               | Expected behavior                                                | RED test                                               |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------ |
| Unauthenticated request to any asset path (`/`, hashed bundle, deep link, favicon) | `gate_unauthorized`; `env.ASSETS.fetch` never invoked            | Integration, before the `assets` binding is configured |
| Unauthenticated `GET /api/usage`                                                   | `gate_unauthorized`; no accounting disclosed                     | Integration                                            |
| A view issues a fetch without a user gesture                                       | Impossible: no `UserIntent` can be minted                        | Unit structural + type test                            |
| A submitted `apiKey` reaches storage, a URL, an export, or a second read           | Absent everywhere; one-shot cell exhausted                       | Unit secrets suite                                     |
| An unknown `BffErrorCode` arrives                                                  | Explicit unmapped state naming raw `code`/`message`; never empty | Unit `errors.ts`                                       |
| A bounded result is presented as complete                                          | `Bound` derived and badge rendered; export carries provenance    | Unit `bounds.ts` + component + export                  |

## Migration / Rollout

Six slices behind the shell, each independently revertable and each within the 800-line review budget:
(1) build/test wiring + `assets` binding + gate-ordering tests + shell (nav, `StateRegion`, `errors.ts`,
`bounds.ts`, atoms); (2) `page-report-view`; (3) `broken-links-view`; (4) `site-crawl-view` + `BarChart`;
(5) `pagespeed-view` + `ScoreGauge` + secret handling; (6) `result-export` + `quota-visibility` +
`GET /api/usage`. Slice 1 ships the gate ordering test **before** any asset exists to be served. The shell
renders a disabled-view state for a reverted view rather than a broken route. Rollback per the proposal:
`wrangler rollback` on `seo-dashboard-bff`; removing the `assets` binding and rerunning `pnpm types:bff` leaves
the JSON API serving. The gate is never rolled back while the BFF lives.

## Open Questions

- [ ] Bounded response vs SSE for `crawl_site` progress — **kept open**; `readToolResponse` and the
      `Progress | "indeterminate"` prop are the seam, and neither resolution changes the route or the view.
- [ ] CSV column layout for `SiteCrawlResult` — **kept open**; each resolution is one `CsvShape` implementation
      registered under `CSV_SHAPES.crawl_site`. The no-silent-loss and stability invariants bind either way.
- [ ] Per-tool cache TTLs — inherited from foundations; the UI only displays `resultAge`.
- [ ] Gate mechanism (`shared-secret-cookie` vs `bearer-allowlist` vs `local-only`) — inherited; the SPA needs
      only "the gate rejected me" (`gate_unauthorized`) and a re-authenticate entry point, so any strategy works.
- [ ] Quota display semantics (absolute observed count, percentage of 60, or a coarse band) — **kept open**;
      `HeadroomIndicator` takes `{ observed, windowSeconds, limit, asOf }` and renders any of them.
- [ ] Whether an unauthenticated asset request should return 401 JSON or redirect to a login route. 401 is
      assumed here because it is the same envelope every API route uses; a redirect is a nicer browser UX and is
      compatible with the same ordering test.
