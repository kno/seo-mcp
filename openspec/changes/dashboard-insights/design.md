# Design: Dashboard Insights (authenticated and analytical views)

## Technical Approach

The change splits along the verified/anticipatory line the proposal draws, and the split is a **type-system
boundary, not a paragraph**:

- **Slice A — buildable now.** One additive `seo-mcp` edit (a Zod object output schema for
  `search_console_query`, per the one-schema-source rule from `dashboard-bff-foundations`), plus a new
  BFF _authenticated route class_ carrying three mechanisms that are testable today: credential containment,
  two separate staleness axes, and an upstream-quota ledger. On top of it, the `search-console-view` designed
  against the real input schema, real row shape and real 250-row bound read from source (cited below).
- **Slice B — anticipatory.** No result shapes are invented. Instead the route registry is **derived from the
  published schema map**, so a provisional view is unbuildable until its tool has an `outputSchema`. The
  reconciliation gate is therefore a typecheck failure, not a review note.

Satisfies `authenticated-source-contract` and `search-console-view` concretely; `gsc-insight-views`,
`keyword-research-view`, `seo-intelligence-view` and `history-comparison-view` get seams only.
`src/http/*`, `src/security/*` and `src/google/auth.ts` stay byte-unchanged; drift there is a scope escalation.

### Verified source facts (re-read this session)

| Fact                                                                                                                                                                                                                                 | Evidence                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Inputs: `siteUrl` (min 1), `startDate`/`endDate` `/^\d{4}-\d{2}-\d{2}$/`, optional `dimensions` enum `query\|page\|country\|device\|date\|searchAppearance`, optional `rowLimit` int 1–250. No other input; no list-properties tool. | `src/server.ts:126-153`                                                                       |
| Result: `{ siteUrl, startDate, endDate, dimensions: string[], rowCount: number, rows: GscRow[] }`; `GscRow = { keys: string[], clicks, impressions, ctr, position }`                                                                 | `src/google/search-console.ts:12-19`, `:4-10`                                                 |
| `dimensions` defaults server-side to `["query","page"]`                                                                                                                                                                              | `src/google/search-console.ts:36-38`                                                          |
| `rowLimit` clamped to `[1, 250]`; `rows` truncated to 250 again; `rowCount === rows.length`                                                                                                                                          | `src/google/search-console.ts:39-42, 82-83, 97`; `src/config.ts:28`                           |
| Bounds: `maxGscRows 250`, `gscTimeoutMs 15_000`, `googleTokenTimeoutMs 10_000`                                                                                                                                                       | `src/config.ts:28-30`                                                                         |
| Both failure paths throw plain `Error` → one undifferentiated `isError` text failure                                                                                                                                                 | `src/google/search-console.ts:76-81`, `src/google/auth.ts:19, 50-54`, `src/server.ts:162-164` |
| Access token cached in a module-level variable                                                                                                                                                                                       | `src/google/auth.ts:3`                                                                        |
| **No as-of / freshness field is returned by the tool.** The reporting lag must be derived, not read.                                                                                                                                 | absence in `src/google/search-console.ts:92-99`                                               |

## Architecture Decisions

### Decision: credential containment is structural, not procedural

**Choice**: the BFF **never receives a Google credential binding**. `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET` and `GOOGLE_REFRESH_TOKEN` exist only in the `seo-mcp` `Env` (`src/config.ts:5-7`); the
BFF reaches Google exclusively through `env.SEO_MCP.fetch(...)`. There is no code path in `bff/` that could
serialize a Google credential, because none is in scope there.

**Alternatives rejected**: a thin Google passthrough route in the BFF (would require the refresh token in a
second Worker's secret store, doubling the blast radius of the single-tenant credential); calling Google from
the browser (immediate total exposure).

**Rationale**: absence beats redaction. Containment tests then assert a property that cannot regress silently.

Two consequences the implementation MUST carry:

1. **Authenticated failures never forward upstream text.** Foundations lets `tool_failed` forward upstream
   text after redacting `Bearer`/`authorization` values — but the BFF cannot redact a Google credential it
   does not hold. So for authenticated tools the BFF **classifies** the upstream text (below), maps it to a
   fixed per-code constant message, and **discards the original** rather than forwarding it. Google's OAuth
   errors do not currently echo the secret; the design does not depend on that remaining true.
2. **Cache keys are trivially credential-free.** The key stays `v1:{tool}:{sha256(canonicalJson(inputs))}` —
   inputs are `siteUrl`/dates/`dimensions`/`rowLimit`, none secret. The `apiKey` no-cache rule has no
   analogue here because no credential is ever an input to an authenticated tool.

**Flagged, deliberately not fixed — `src/google/auth.ts:3`.** This is module-level mutable state, which
`openspec/config.yaml` forbids for request state. Assessment: it holds a token derived from one shared
single-tenant credential, keyed by nothing and scoped per isolate, so it cannot leak _one caller's_ data to
another — there is only one identity. It is therefore acceptable today, but it is not safe under the rule's
intent, and it becomes an actual cross-tenant leak the moment a second Google identity exists. Constraints
this change accepts instead of editing it: (a) no new module-level credential cache anywhere, in `src/` or
`bff/`; (b) no test in this change asserts on its contents; (c) it is recorded here as a precondition of any
future multi-identity change. Fixing it is a separate `src/google/*` change.

### Decision: two staleness axes are separated by type, not by discipline

The requirement most likely to be quietly violated, so the mechanism is the design.

```ts
// bff/src/authenticated/freshness.ts
export interface SourceFreshness {
  source: "search-console"; // upstream identity, extended per source
  asOf: string; // YYYY-MM-DD — latest date the upstream data actually covers
  lagDays: number; // whole days between asOf and the request date
  basis: "reported" | "assumed"; // GSC reports none today -> "assumed"
}
export interface AuthenticatedOk<T> extends BffOk<T> {
  sourceFreshness: SourceFreshness; // REQUIRED — no default, no optional
}
```

Four mechanisms, in order of strength:

1. **Required field.** `sourceFreshness` is non-optional on the authenticated envelope, so a route that omits
   it does not typecheck and a view that renders without it has nothing to read.
2. **Incommensurable units.** `resultAge` is seconds-since-cache-write (foundations); `asOf` is a calendar
   date and `lagDays` whole days. No arithmetic between them is meaningful, and **no combined field exists
   anywhere in the contract**, so a view cannot read one — it would have to invent one.
3. **Distinct presentations.** `resultAge` renders as a duration ("cached 4 min ago"); freshness renders as a
   date ("Search Console data through 2026-08-10, ~2 days behind"). Two accessible labels, two elements.
4. **RED test.** Assert both elements exist with distinct accessible names, and assert that **no single
   element contains both figures** — the collapse this forbids is a rendering fact, so it is test-visible.

**`asOf` derivation, honestly labelled.** The tool returns no freshness field, so:

| Option                                                                                           | Cost                                                          | Decision                                 |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ---------------------------------------- |
| Config constant `GSC_REPORTING_LAG_DAYS`; `asOf = min(endDate, today − lag)`, `basis: "assumed"` | zero extra Google calls; approximate                          | **Chosen default**                       |
| Probe with `dimensions: ["date"]` and take the latest date holding data, `basis: "reported"`     | exact, but one extra call against Google's quota per property | Optional refinement, off by default      |
| Have the tool return it                                                                          | `src/google/*` + schema change                                | Out of scope; the right long-term answer |

`basis` is the point: the UI can state "estimated" versus "reported by Search Console" mechanically, so an
assumed lag is never displayed as a fact Google asserted. The lag constant's value stays an open decision.

### Decision: a caching class for upstream-delayed data, distinct from the crawl class

**Choice**: `CacheClass = "crawl" | "authenticated-delayed"`, selected per tool from the authenticated-tool
registry, not per call site.

| Property             | `crawl` (existing)                      | `authenticated-delayed` (new)                                                                                                           |
| -------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Meaning of a refetch | may genuinely differ (the site changed) | usually byte-identical (Google's data for a closed range cannot change except by backfill)                                              |
| TTL source           | `CACHE_TTL_SECONDS[tool]`               | `AUTH_SOURCE_TTL_SECONDS[source][range-state]` — the per-source seam                                                                    |
| Range-state split    | n/a                                     | `closed` (`endDate` older than the lag window) → top of the clamp; `open` (`endDate` inside the lag window, data still landing) → short |
| Zero-row results     | cached normally                         | cached at the **`open`** TTL regardless — zero rows in a recent range usually means "not reported yet", not "no data"                   |
| Refresh              | `?refresh=1`                            | `?refresh=1` only; no revalidate-on-focus, no timer (`dashboard-shell`)                                                                 |

Clamp `[60, 86400]` from foundations is inherited unchanged (KV minimum / one day). **Alternatives rejected**:
copying the crawl TTL (spends both the MCP bucket and Google's quota to receive an identical answer); infinite
TTL for closed ranges (Google does backfill, and 86400 is the existing clamp ceiling — raising it is a
foundations concern, not this change's). Concrete TTL values remain an **open decision**; the seam is what is
designed here.

### Decision: BFF-side upstream quota ledger, reusing the `quota-visibility` pattern

**Choice**: the same substrate `quota-visibility` already uses for MCP-bucket headroom — the BFF's own
observed call volume in KV — with a per-source, per-window counter key `q1:{source}:{windowStart}`,
incremented via `ctx.waitUntil()`.

Mechanism details that make the estimate meaningful rather than decorative:

- **Incremented on the upstream attempt, not on success.** A failed Google call still spends Google's quota.
  Gate rejections and input-validation failures never reach Google, so they never increment.
- **A cache hit never increments.** It consumed no Google quota; counting it would make the estimate drift
  upward for free.
- **Under-estimate by construction.** KV is eventually consistent and concurrent increments can be lost, so
  the display wording must be "at least N calls used in this window", never a remaining count. `basis:
"bff-observed"` is carried alongside, matching the existing estimate-labelling requirement.
- **Exhaustion** compares against `AUTH_SOURCE_BUDGET[source]` from config; at or over budget the submit
  control is disabled with reason `upstream_quota_estimated`, textually distinct from the MCP-bucket disabled
  reason. Two indicators, two labels, neither implying the other.
- **No Durable Object.** Foundations already fixed the DO escalation trigger; the same trigger governs this
  counter. No parallel coordination mechanism is invented.

**Alternatives rejected**: relying on the MCP's 60/60s bucket (it is ours, Google's quota is Google's, and
they are independently exhaustible); a module-level counter (violates the no-module-mutable-request-state
rule and dies with the isolate); reading a remaining-count from Google (none is returned).

### Decision: classify failures at the BFF now; recommend server-side codes as a follow-up

| Option                                                                                                  | Cost / risk                                                                                                                                                                         | Reliability                                  | Decision                                                           |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| (a) Distinct machine-readable codes emitted by `seo-mcp`                                                | edits `src/server.ts` and `src/google/*` — a **request-facing MCP tool surface, flagged higher risk** by `openspec/config.yaml`; changes the error payload every existing host sees | mechanical, stable                           | **Rejected for this change**; recommended as its own server change |
| (b) Documented, tested text classification at the BFF                                                   | zero server risk; couples to Google's message text, which can change without notice                                                                                                 | brittle at the edges, but pinned by fixtures | **Chosen**                                                         |
| (c) (b) now, migrate to (a) when the server change lands; the BFF classifier collapses to a code lookup | one extra migration step                                                                                                                                                            | best end state                               | **Recommended trajectory**                                         |

Why (b) is less brittle than it first appears: two of the four classes match **strings we own**, and the
default is safe.

| Class → new `BffErrorCode`       | Match rule                                                                                                                                       | HTTP              | Presentation                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | ---------------------------------------------------------- |
| `upstream_source_not_configured` | exact `"Google credentials are not configured"` — **our own constant**, `src/google/auth.ts:19`                                                  | 503               | "not configured" state, distinct from error and from empty |
| `upstream_credential_failure`    | Google OAuth identifiers `invalid_grant`, `invalid_client`, `unauthorized_client` (from `error`/`error_description`, `src/google/auth.ts:44-54`) | 502               | operator action; **no retry affordance**                   |
| `upstream_source_quota`          | `quota`, `rateLimitExceeded`, `userRateLimitExceeded` in the upstream message                                                                    | 429               | wait state, distinct from credential failure               |
| unmatched                        | anything else                                                                                                                                    | 422 `tool_failed` | **non-retryable operator-action default**                  |

**Safe default, stated plainly**: when the class cannot be determined, the BFF MUST present a non-retryable
operator-action failure. A classification miss therefore degrades to "ask an operator", never to a retry loop
against a broken credential or an exhausted quota.

One consequence discovered at design time: Google returns **no `retry-after`** for quota rejections, while
`quota-visibility` requires a 429 to surface `retryAfter` and disable retry until it elapses. The design
**omits `retryAfter` rather than fabricating 60 s**, and the view must render a disabled-resubmit state with
an explicitly unknown duration. See the amendments section.

### Decision: `outputSchema` for `search_console_query` — the single server edit

```ts
// src/schemas/search-console.ts  (new)
import * as z from "zod/v4";
import { LIMITS } from "../config";

export const gscDimensionSchema = z.enum([
  "query",
  "page",
  "country",
  "device",
  "date",
  "searchAppearance",
]);
export const gscRowSchema = z.object({
  keys: z.array(z.string()),
  clicks: z.number(),
  impressions: z.number(),
  ctr: z.number(),
  position: z.number(),
});
export const gscQueryResultSchema = z.object({
  // OBJECT ROOT — required by the SDK
  siteUrl: z.string().min(1),
  startDate: z.string(),
  endDate: z.string(),
  dimensions: z.array(gscDimensionSchema),
  rowCount: z.number().int().min(0),
  rows: z.array(gscRowSchema).max(LIMITS.maxGscRows),
});
export type GscQueryResult = z.infer<typeof gscQueryResultSchema>;
export type GscRow = z.infer<typeof gscRowSchema>;
```

Fits the one-schema-source approach exactly as the other five tools do: the interfaces at
`src/google/search-console.ts:4-19` become `z.infer` aliases **in place** (import paths unchanged),
`src/types/index.ts` re-exports the types, `src/types/schemas.ts` re-exports the schema, and `outputSchema`
sits beside `inputSchema` in `registerTool`. Object root avoids the legacy `{result:…}` wire wrap foundations
identified. `GscQueryParams` (`:21-27`) stays a plain interface — it is input, already covered by
`inputSchema`.

Two deliberate choices: `rows` carries `.max(LIMITS.maxGscRows)` so an oversized payload becomes a loud
`result_invalid` at the BFF instead of a silently oversized table; and `dimensions` reuses the input enum
rather than `z.array(z.string())`, because the returned value is always either the caller's enum-validated
input or the server default (`:36-38`), so the tighter type is true and gives the view a closed set to render
against. `rowCount` gets **no** max — it is `rows.length` and must stay readable as the bound signal.

## Data Flow — Search Console query (project rule: sequence diagram)

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser (search-console view)
  participant G as bff gate.ts
  participant R as bff router.ts (authenticated class)
  participant Q as bff quota-ledger (KV)
  participant K as RESULT_CACHE (KV)
  participant C as bff mcp-client.ts
  participant M as seo-mcp /mcp
  participant A as src/google/auth.ts
  participant S as Search Console API
  B->>G: POST /api/tools/search_console_query {siteUrl,startDate,endDate,dimensions?,rowLimit?}
  G-->>B: 401 gate_unauthorized (no upstream work, no quota spend)
  G->>R: allowed
  R->>R: Zod input parse (real schema; rowLimit 1..250) -> 400 invalid_input
  R->>Q: read estimate -> at/over budget? -> 429 upstream_source_quota (never reaches Google)
  R->>K: get(v1:search_console_query:<sha256 inputs>)
  K-->>R: hit -> AuthenticatedOk + resultAge + sourceFreshness (recomputed asOf, not cached-as-truth)
  R->>C: miss / ?refresh=1
  R->>Q: ctx.waitUntil(increment q1:search-console:<window>)  %% attempt, not success
  C->>M: env.SEO_MCP.fetch(+ Authorization: Bearer MCP_AUTH_TOKEN)  %% only token the BFF holds
  M->>A: getGoogleAccessToken(env)  %% refresh token never leaves seo-mcp
  A->>S: POST /token (10s) then searchAnalytics/query (15s)
  S-->>M: rows | error
  M-->>C: structuredContent validated against gscQueryResultSchema | isError text
  C->>C: classify(text) -> not_configured | credential_failure | source_quota | tool_failed(default non-retryable)
  C->>C: DISCARD upstream text; emit fixed per-code message
  R->>R: derive sourceFreshness{asOf,lagDays,basis:"assumed"}; capped = rowCount === 250
  R->>K: ctx.waitUntil(put(..., TTL by range-state: closed | open))
  R-->>B: { data, cacheStatus, resultAge, sourceFreshness } | { error: { code, message } }
  Note over R,B: NO Google credential in body, header, cache key, cache value, export or client log
  B->>B: render rows(keys,clicks,impressions,ctr,position) + bound badge if capped + 2 staleness elements
```

**Bound detection and display**: `rowCount === LIMITS.maxGscRows` (250) is the only available signal, because
`rowCount` is the length of the already-truncated array (`:82-83, 97`). The view renders the same
capped/truncated mechanism `dashboard-views` defines for other caps, naming the limit ("first 250 rows —
more may exist"); `rowCount: 0` renders the empty state; `1..249` renders neither. The badge is derived at the
BFF (`capped: boolean` on the authenticated envelope) so the rule lives in one tested place instead of in
every view.

## File Changes

| File                                                                        | Action        | Description                                                                                                                                |
| --------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/schemas/search-console.ts`                                             | Create        | Zod object schema + inferred types (above)                                                                                                 |
| `src/google/search-console.ts`                                              | Modify        | `GscRow`/`GscQueryResult` become `z.infer` aliases; logic byte-unchanged                                                                   |
| `src/server.ts`                                                             | Modify        | `outputSchema: gscQueryResultSchema` on `search_console_query` only. **Higher risk: MCP tool surface**                                     |
| `src/types/index.ts`, `src/types/schemas.ts`                                | Modify        | Publish `GscQueryResult`, `GscRow`, the schema                                                                                             |
| `bff/src/authenticated/{registry,freshness,quota-ledger,classify}.ts`       | Create        | Tool registry keyed by published schema; freshness model; KV ledger; classifier                                                            |
| `bff/src/{router,cache,errors}.ts`                                          | Modify        | Authenticated route class, TTL class + range-state, three new codes                                                                        |
| `bff/ui/search-console/*`                                                   | Create        | The one non-provisional view                                                                                                               |
| `bff/test/**`, `test/**`                                                    | Create        | RED tests per the strategy below                                                                                                           |
| `src/http/*`, `src/security/*`, `src/google/auth.ts`, root `wrangler.jsonc` | **Unchanged** | Drift is a scope escalation                                                                                                                |
| `bff/wrangler.jsonc`                                                        | Modify        | `AUTH_SOURCE_TTL_SECONDS`, `AUTH_SOURCE_BUDGET`, `GSC_REPORTING_LAG_DAYS`, `TOOL_TIMEOUT_MS.search_console_query = 27_000` (> 15 s + 10 s) |

## Seams for the anticipatory capabilities

The reconciliation gate is **enforceable**: `bff/src/authenticated/registry.ts` is typed as
`Record<AuthenticatedToolName, AuthenticatedRoute<…>>` where `AuthenticatedToolName` is derived from the
published schema module. A view for a tool with no `outputSchema` therefore **cannot be wired without a
typecheck error**, and the reconciliation checklist below is what removes that error.

Reconciliation checklist (all four required before a provisional view is implemented): (1) tool registered in
`src/server.ts` with an object-root `outputSchema`; (2) type published from `src/types/index.ts`; (3) the
capability's spec edited to cite the real shape by `file:line`, replacing every provisional statement;
(4) route added to the registry with its cache class, TTL, timeout and quota source.

| Capability                | Already decided by the shared contract                                                                                                                                                      | Must be settled by the real output schema                                                                                                                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gsc-insight-views`       | Credential containment; two staleness axes (per period, for comparisons); GSC quota source and ledger; classifier; shared property/date-range controls; cache class `authenticated-delayed` | Whether a bound exists at all and how it is signalled; the decay/change indicator's name, unit, sign convention and "no material change" threshold; whether the comparison baseline is a tool input or a client-side second call                                                               |
| `keyword-research-view`   | Containment; export and staleness rules; a **second, separate** quota source (`google-ads`) with its own budget key and indicator; the Ads developer token stays in `seo-mcp` `Env` only    | Volume/CPC/competition field names, units and scales; the currency field and whether it is per-row or per-result; how an absent metric is represented (`null` vs omitted vs 0) — the requirement that absent ≠ zero cannot be implemented until this is known; cluster identity representation |
| `seo-intelligence-view`   | Containment; drill-down reuses the existing `site-crawl-view`/`page-report-view` pattern; provenance is a display requirement                                                               | The evidence/provenance field that names the producing tool — if the real schema omits it, the view **cannot** satisfy its provenance requirement and the tool must be amended, not the view; impact/effort input fields and score scale                                                       |
| `history-comparison-view` | Navigation shows a disabled "not yet available" entry driven by a capability-availability map, **not a route**                                                                              | Everything. See below.                                                                                                                                                                                                                                                                         |

**History and comparison — precise blocker.** `ROADMAP.md:81, 84` resolves storage (D1) and retention
(rolling 90 days) only. There is **no D1 binding, no snapshot schema, no snapshot writer, and no MCP tool
exposing history** today. Consuming seam designed here, and nothing more: a `capabilityAvailability` entry the
shell reads to render the disabled navigation state, so activating it issues no request. When the tool ships,
the retention window MUST arrive as a **required field on the result** (`retention: { windowDays,
oldestAvailable }`), reusing the same required-field mechanism as `sourceFreshness` — so a truncated history
physically cannot render without stating the boundary that truncated it, and "outside the retention window"
stays distinguishable from "no change". A UI-side retention constant is explicitly rejected: it would silently
disagree with the server's real retention.

## Testing Strategy (Strict TDD — RED first, `pnpm test`)

| Layer                               | Testable **today**                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Blocked until a tool exists                                |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Unit `test/`                        | `gscQueryResultSchema` accepts a real fixture, rejects a 251-row payload, rejects an unknown dimension; `searchConsoleQuery` via the injected `fetcher`/`now` (`search-console.ts:29-34`) with `resetGoogleTokenCache()` in `beforeEach` — **no real Google credentials needed**; token-exchange failure text shapes                                                                                                                                                              | —                                                          |
| Unit `bff/test/`                    | Classifier table incl. **unmatched → non-retryable** and the `"Google credentials are not configured"` exact match; freshness derivation (`asOf`, `lagDays`, `basis`); cache TTL by range-state incl. zero-row → `open`; ledger increments on attempt, **not on cache hit**; `capped` at 250 / 249 / 0                                                                                                                                                                            | Per-tool registry rows, once each schema is published      |
| Unit (view)                         | Two distinct staleness elements with distinct accessible names and **no element containing both**; bound badge at 250; empty vs not-configured vs credential-failure vs quota states all distinct; no timer/focus/visibility handler issues a request                                                                                                                                                                                                                             | Any provisional view's rendering                           |
| Integration `bff/test/integration/` | Stub MCP auxiliary worker (`poolOptions.workers.miniflare.workers`, the foundations pattern) returns canned JSON-RPC frames **and canned Google-shaped error texts per classifier row**. The BFF test env holds **no Google credential at all** — which is itself the containment assertion. Containment sweep: set decoy credential values in the _stub_ env and assert those literals appear in no response body, header, cache value, export artifact or client-bound log line | Real Google calls (never tested); routes for unbuilt tools |
| Integration `test/integration/`     | `search_console_query` registration exposes `outputSchema` and `structuredContent` round-trips                                                                                                                                                                                                                                                                                                                                                                                    | —                                                          |

Per the known constraint (`ROADMAP.md:20`), the real `/mcp` auth path stays out of integration tests because
the ratelimit binding is not reliably simulated; token-injection and 401/429/503 mapping are asserted against
the stub upstream, exactly as foundations established.

## Threat Matrix

Applicable boundary is HTTP routing and secret handling. **N/A with reason**: documentation-like path
classification, executable-file classification, shell/subprocess invocation, Git repository selection, commit
state, push state, PR automation — this change adds no shell, no subprocess, no VCS automation. Substituted
applicable rows, each carrying a RED test: (a) an unauthenticated request to every authenticated route
reaches neither Google nor the quota ledger; (b) no Google credential literal and no `MCP_AUTH_TOKEN` appears
in any response body, header, cache key, cache value, export or client-bound log; (c) upstream error text is
never forwarded verbatim on an authenticated route; (d) an unclassifiable failure renders non-retryable;
(e) KV absent or throwing serves a live result and an `unavailable` quota estimate rather than failing closed.

## Required Amendments To Sibling Changes (surfaced, not dropped)

Carried forward from `authenticated-source-contract` unchanged: `mcp-error-contract` (distinguishing codes or
the classification rule), `bff-result-cache` (long-TTL class + no credential-derived key), `quota-visibility`
(independent upstream estimate), `result-export` (as-of and bound provenance for authenticated results),
`dashboard-bff` (per-tool timeout ≥ 25 s and quota hooks). `gsc-insight-views`, `keyword-research-view`,
`seo-intelligence-view` and `history-comparison-view` each record "none identified".

**Two additional amendments discovered at design time:**

1. **`dashboard-shell`** — its "Every Normalized Error Code Has a Defined Presentation" requirement enumerates
   the foundations code set. The three new codes (`upstream_source_not_configured`,
   `upstream_credential_failure`, `upstream_source_quota`) need presentations added there, or the shell's
   completeness requirement is violated by construction the moment this change ships.
2. **`quota-visibility`** — its 429 requirement assumes a `retryAfter` value exists. Google quota rejections
   carry none, so it needs a "rate-limited without a known retry delay" case: resubmission disabled with an
   explicitly unknown duration. Fabricating 60 s would be a wrong statement to the user.

## Migration / Rollout

Four independently revertable slices, each inside the 800-line review budget: (1) `src/schemas/search-console.ts`

- inferred aliases + `outputSchema` + published types — additive, hosts ignoring `structuredContent` are
  unaffected, revert = drop the field and `wrangler rollback`; (2) BFF authenticated route class (containment +
  freshness + classifier) with the GSC route; (3) quota ledger + cache class; (4) the `search-console-view` UI.
  The BFF MUST tolerate the output schema's absence rather than fail closed, so slice 2 can deploy against a
  rolled-back `seo-mcp`. Credential containment and the access gate are **never** rolled back while an
  authenticated route is live.

## Open Questions

- [ ] `GSC_REPORTING_LAG_DAYS` value, and whether the `dimensions: ["date"]` probe is worth one extra Google
      call to upgrade `basis` from `assumed` to `reported`.
- [ ] `AUTH_SOURCE_TTL_SECONDS` concrete values for the `closed` and `open` range states.
- [ ] `AUTH_SOURCE_BUDGET["search-console"]` — the daily call figure the estimate compares against, and the
      exact display wording for an under-counting estimate.
- [ ] Whether the property list is a configured allowlist or a free-text `siteUrl` field (no list-properties
      tool exists, so free text is the only option that needs no new tool).
- [ ] Default date range for the view (recommended: last 28 days).
- [ ] Whether server-side error codes (option (a)) are scheduled now as a follow-up `seo-mcp` change, which
      would let the BFF classifier collapse to a lookup.
- [ ] Charting mechanism for trend lines (inherited; hand-rolled SVG recommended).
- [ ] Whether the `outputSchema` edit belongs here or folds back into `dashboard-bff-foundations` if that
      change has not archived.
