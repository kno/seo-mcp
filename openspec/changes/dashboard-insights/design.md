# Design: Dashboard Insights (authenticated and analytical views)

## Technical Approach

The change splits along the verified/anticipatory line the proposal draws, and the split is a **type-system
boundary, not a paragraph**:

- **Slice A — buildable now.** One additive `seo-mcp` edit (a Zod object output schema for
  `search_console_query`, per the one-schema-source rule from `dashboard-bff-foundations`), plus a new
  BFF _authenticated route class_ carrying three mechanisms that are testable today: credential containment,
  two separate staleness axes, and an upstream-quota ledger. On top of it, the `search-console-view` designed
  against the real input schema, real row shape and real 250-row bound read from source (cited below).
- **Slice B — the remaining four views, now reconciled rather than anticipatory.** After four reconciliation
  passes every capability is grounded in a shipped tool whose shape was read from source, so no result shape is
  invented anywhere. The route registry is still **derived from the published schema map** and is an explicit
  allowlist, so a view remains unbuildable until its tool has an `outputSchema` — the reconciliation gate is a
  typecheck failure, not a review note. Each family therefore ships as a schema slice followed by a view slice.

Satisfies all six capabilities: `authenticated-source-contract` and `search-console-view` first, then
`gsc-insight-views`, `keyword-research-view`, `seo-intelligence-view` and `history-comparison-view` over their
real shapes. The six `business_*` tools are **out of scope by explicit user decision** and appear in no registry
row, route, view or task. `src/http/*`, `src/security/*` and `src/google/auth.ts` stay byte-unchanged; drift
there is a scope escalation, as is any edit to tool _behavior_ — the only `src/` changes are additive schemas.

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

### Verified source facts — fourth reconciliation pass (`seo-intelligence-view` + tool inventory)

| Fact                                                                                                                                                                                                                                                                | Evidence                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **28 tools registered**: 22 in scope + 6 `business_*` (out of scope by user decision).                                                                                                                                                                              | `grep 'server.registerTool(' src/server.ts`                                                                                             |
| **Only 5 tools declare an `outputSchema`** (`health`, `crawl_page`, `crawl_site`, `check_links`, `analyze_pagespeed`). The other 17 in-scope tools have none; `jsonResult` still has a legacy single-argument form for exactly those.                               | `src/server.ts:113, 131, 152, 174, 201`; `:52-63`                                                                                       |
| The five intelligence tools return `{ siteUrl, startDate, endDate, count, <array> }` with **no `criteria` echo**, unlike `OpportunityResult`. `count` is always the post-`slice` array length.                                                                      | `src/seo/intelligence.ts:211-218, 256-263`; `src/seo/keyword-pages.ts:162-169, 211-218`; cf. `src/google/opportunities.ts:79, 136, 190` |
| Their thresholds/limits are resolved **inside** the synthesis helpers and never surface: `maxOpportunities` 10, `maxCannibalizationGroups` 50, `maxKeywordPages` 100, `maxContentGaps` 100, `minPosition ?? 21`, `minImpressions ?? 10`, `topQueriesPerPage ?? 10`. | `src/seo/intelligence.ts:52-53, 110`; `src/seo/keyword-pages.ts:39-40, 90-92`; `src/config.ts:32-33, 47-48`                             |
| All five synthesize over a **hardcoded** `dimensions: ["query","page"], rowLimit: maxGscRows` (250) GSC pull. No output field records this pre-truncation bound.                                                                                                    | `src/seo/intelligence.ts:193-204, 239-250`; `src/seo/keyword-pages.ts:144-155, 192-203`                                                 |
| `CannibalGroup.pages` is capped at 10 **after** `pageCount`/totals are computed from the full set, so `pages.length < pageCount` is reachable.                                                                                                                      | `src/seo/intelligence.ts:46, 88-94`                                                                                                     |
| `Opportunity.effort` is a fixed per-type constant (1/2/3); `priorityScore = impact / effort`; `page` is always `null` for `cannibalization`.                                                                                                                        | `src/seo/intelligence.ts:116-157`                                                                                                       |
| **`analyze_domain` returns GSC failure inside a SUCCESS payload**: `gscError` is a raw upstream `Error.message` on a 200-OK `DomainReport`, never an `isError` result. Its three enrichment states are mutually exclusive.                                          | `src/seo/domain-report.ts:34-48, 77-99`                                                                                                 |
| **Three `business_*` tools are live public writes**, gated only by a `confirm: true` input — the server is no longer read-only.                                                                                                                                     | `src/server.ts:899-982`                                                                                                                 |

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

### Decision: the authenticated registry is an allowlist, and Business Profile is not in it

**Choice**: `bff/src/authenticated/registry.ts` is an explicit, exhaustively enumerated allowlist of tool
names. A tool the dashboard does not name is unreachable through the BFF — not merely un-navigated.

**Why this stopped being cosmetic (fourth pass)**: the server registers three live public **write** tools
(`business_reply_review`, `business_update_info`, `business_create_post`, `src/server.ts:899-982`), gated only
by a `confirm: true` input. Any BFF route shape that forwards an arbitrary tool name, or derives its route set
from "every registered tool", would put a live mutation of the owner's public Business Profile one request
behind the dashboard gate. The proposal's read-only premise is now a **BFF** property, not a server property,
so it has to be enforced where it is claimed.

**Scope decision (explicit user decision, fourth reconciliation pass)**: all six `business_*` tools are
**out of scope for this change**. No spec, no view, no route, no registry row, no navigation entry, no task.
A future SDD change owns that domain, including whatever confirmation/undo affordance a live public write
needs — which is a different design problem from anything in this change. The registry's RED test asserts the
allowlist contains no `business_*` name, so silent inclusion later is a test failure rather than a review miss.

### Decision: `analyze_domain`'s `gscError` is classified like a failure, though it arrives as a success

**The problem the fourth pass found**: every other authenticated failure path in this design arrives as an
`isError` text result, which the classifier intercepts. `analyze_domain` does not. `buildDomainReport` sets
`gscError` to a raw upstream `Error.message` on an otherwise-successful 200-OK `DomainReport`
(`src/seo/domain-report.ts:34-48, 95-98`). A classifier that only inspects `isError` results would forward
Google's verbatim text to the browser through a **success** envelope — defeating the classify-and-discard rule
by routing around it.

**Choice**: the authenticated route for `analyze_domain` treats a present `gscError` as an embedded failure:
it runs the same classifier over that string, replaces it with the fixed per-code constant message, and
surfaces the class as a distinct field on the envelope (e.g. `enrichmentError: { code }`) while keeping the
`crawl` portion a normal success. The raw string is **discarded at the BFF** and never enters the response
body, the cache value, an export, or a log line.

Consequences the implementation MUST carry:

1. The containment RED test asserts the decoy-credential sweep over `analyze_domain`'s success payload, not
   only over its error payload — this is the one authenticated tool where upstream text rides a 200.
2. The three enrichment states stay distinguishable after classification: absent-both (not requested),
   `search` present (succeeded), classified `enrichmentError` (failed). A classified error MUST NOT collapse
   into the not-requested state, which is what silently dropping the field would produce.
3. Cache semantics: a report whose enrichment failed is cached at the **`open`** TTL, not `closed` — the
   failure is transient in a way the crawl portion is not.

### Decision: effective request criteria are echoed by the BFF, because five tools echo none

**The asymmetry**: `find_striking_distance_keywords` and `find_low_ctr_opportunities` return
`criteria: Record<string, number>` (`src/google/opportunities.ts:79, 136, 190`), which is what
`gsc-insight-views`' "applied criteria are shown alongside results" requirement reads. The five
`seo-intelligence-view` tools return **no such field** — only `count` — and resolve their thresholds inside the
synthesis helpers (`limit ?? LIMITS.maxOpportunities` 10, `?? maxCannibalizationGroups` 50,
`?? maxKeywordPages` 100, `?? maxContentGaps` 100, `minPosition ?? 21`, `minImpressions ?? 10`,
`topQueriesPerPage ?? 10`). So the same UI requirement has two mechanisms behind it.

| Option                                                 | Assessment                                                                                                                                                                                                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Add `criteria` to the five tools' results              | Correct long-term, but it is a **tool behavior change** in `src/seo/*` — outside this change's additive-only boundary. Recommended follow-up.                                                                                                                |
| Have the view hardcode the defaults                    | **Rejected.** A UI-side copy of a server default silently lies the moment `src/config.ts` changes.                                                                                                                                                           |
| **BFF echoes the effective request criteria** (chosen) | The BFF already validates the inputs; it resolves omitted ones against one documented default table co-located with the registry row, and emits `criteria` with `basis: "request"` — textually distinguished from the tools that report `basis: "reported"`. |

Bound detection follows the same split: `count === effectiveLimit` for these five, `rowCount === criteria.limit`
for the two opportunity tools, `bucket.length === LIMITS.maxDiffRows` for each diff bucket. All three are the
same "bound reached, not necessarily complete" statement, computed at the BFF so the rule lives in one tested
place. Independently of any limit, every one of the five synthesizes over a **hardcoded 250-row** GSC pull that
no output field records, so their views carry an unconditional "derived from at most 250 Search Console rows"
caveat — stated, never inferred from a field.

### Decision: `outputSchema` for `search_console_query` — the first of eighteen

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

**Schema inventory (fourth pass) — this is what actually sizes the change.** The reconciliation gate is a
typed registry keyed by the published schema map, so every tool with a view needs an object-root `outputSchema`
first. Only 5 exist (`src/server.ts:113, 131, 152, 174, 201`), all owned by foundations. The 17 remaining
in-scope tools, grouped into the slices `tasks.md` uses:

| Schema module (new)              | Tools covered                                                                                          | Capability                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| `src/schemas/search-console.ts`  | `search_console_query`                                                                                 | `search-console-view`                           |
| `src/schemas/opportunities.ts`   | `find_striking_distance_keywords`, `find_low_ctr_opportunities`                                        | `gsc-insight-views`                             |
| `src/schemas/gsc-snapshots.ts`   | `snapshot_search_console`, `list_search_console_snapshots`, `compare_search_console`                   | `gsc-insight-views` + `history-comparison-view` |
| `src/schemas/keywords.ts`        | `get_keyword_metrics`, `discover_keywords`, `cluster_keywords`                                         | `keyword-research-view`                         |
| `src/schemas/intelligence.ts`    | `find_keyword_cannibalization`, `find_seo_opportunities`, `map_keywords_to_pages`, `find_content_gaps` | `seo-intelligence-view`                         |
| `src/schemas/domain-report.ts`   | `analyze_domain`                                                                                       | `seo-intelligence-view`                         |
| `src/schemas/crawl-snapshots.ts` | `snapshot_crawl`, `list_crawl_snapshots`, `compare_crawls`                                             | `history-comparison-view`                       |
| — none —                         | 6 × `business_*`                                                                                       | **out of scope**                                |

Every one is additive and follows the same in-place `z.infer` alias rule: the existing interfaces stay where
they are, import paths are unchanged, and no tool's behavior changes. `analyze_domain` gets its own module
because `DomainReport.crawl` must reuse `siteCrawlResultSchema`'s existing `summary`/`crawlPolicy`/`linkGraph`
sub-schemas rather than restate them — the one place a new schema depends on a foundations schema.

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

| File                                                                                                                                                                          | Action        | Description                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/schemas/{search-console,opportunities,gsc-snapshots,keywords,intelligence,domain-report,crawl-snapshots}.ts`                                                             | Create        | Zod object schemas + inferred types for the 18 tools with a view (inventory above)                                                         |
| `src/google/{search-console,opportunities,ads}.ts`, `src/seo/{intelligence,keyword-pages,domain-report,keywords,gsc-diff,crawl-diff}.ts`, `src/db/{gsc-store,crawl-store}.ts` | Modify        | Result interfaces become `z.infer` aliases **in place**; logic byte-unchanged in every file                                                |
| `src/server.ts`                                                                                                                                                               | Modify        | Additive `outputSchema` on 18 tools, one slice at a time. **Higher risk: MCP tool surface.** No `business_*` tool is touched.              |
| `src/types/index.ts`, `src/types/schemas.ts`                                                                                                                                  | Modify        | Publish the result types and schemas per slice                                                                                             |
| `bff/src/authenticated/{registry,freshness,quota-ledger,classify,criteria}.ts`                                                                                                | Create        | Allowlist registry keyed by published schema; freshness model; KV ledger; classifier; effective-criteria resolver                          |
| `bff/src/{router,cache,errors}.ts`                                                                                                                                            | Modify        | Authenticated route class, TTL class + range-state, three new codes                                                                        |
| `bff/ui/{search-console,gsc-insights,keyword-research,seo-intelligence,history}/*`, `bff/ui/src/charts/*`                                                                     | Create        | The five views plus hand-rolled SVG trend/bar primitives (no charting library)                                                             |
| `bff/test/**`, `test/**`                                                                                                                                                      | Create        | RED tests per the strategy below                                                                                                           |
| `src/http/*`, `src/security/*`, `src/google/auth.ts`, root `wrangler.jsonc`                                                                                                   | **Unchanged** | Drift is a scope escalation                                                                                                                |
| `bff/wrangler.jsonc`                                                                                                                                                          | Modify        | `AUTH_SOURCE_TTL_SECONDS`, `AUTH_SOURCE_BUDGET`, `GSC_REPORTING_LAG_DAYS`, `TOOL_TIMEOUT_MS.search_console_query = 27_000` (> 15 s + 10 s) |

## Seams for the anticipatory capabilities

The reconciliation gate is **enforceable**: `bff/src/authenticated/registry.ts` is typed as
`Record<AuthenticatedToolName, AuthenticatedRoute<…>>` where `AuthenticatedToolName` is derived from the
published schema module. A view for a tool with no `outputSchema` therefore **cannot be wired without a
typecheck error**, and the reconciliation checklist below is what removes that error.

Reconciliation checklist (all four required before a provisional view is implemented): (1) tool registered in
`src/server.ts` with an object-root `outputSchema`; (2) type published from `src/types/index.ts`; (3) the
capability's spec edited to cite the real shape by `file:line`, replacing every provisional statement;
(4) route added to the registry with its cache class, TTL, timeout and quota source.

| Capability                | Already decided by the shared contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Must be settled by the real output schema                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gsc-insight-views`       | **`find_striking_distance_keywords` and `find_low_ctr_opportunities` are RECONCILED** (`src/google/opportunities.ts`, commit `a5b4f22`): both return `OpportunityResult { siteUrl, startDate, endDate, dimensions, criteria, rowCount, rows }`, `rowCount === rows.length` with no total-match count, and a raw GSC pull capped at 250 rows before filtering — so the view must never claim exhaustiveness, per the amended `gsc-insight-views` spec. Credential containment; GSC quota source and ledger; shared property/date-range controls; cache class `authenticated-delayed` apply to all three tools.                                                                                                                                                                              | **Content-decay / period-over-period comparison remains fully unbuilt.** Whether a bound exists at all and how it is signalled; the decay/change indicator's name, unit, sign convention and "no material change" threshold; whether the comparison baseline is a tool input or a client-side second call; the two staleness axes for a comparison's baseline period specifically                                                                                                                                                                                                                       |
| `keyword-research-view`   | **All three tools are RECONCILED** (`src/google/ads.ts`, `src/seo/keywords.ts`, commit `1044d82`/`ef5b0d2`): `get_keyword_metrics` and `discover_keywords` share `{ customerId, count, keywords: KeywordMetric[] }`; `cluster_keywords` returns `ClusterResult` and is credential-free (no Ads call, no quota). Containment; export/staleness rules; a **second, separate** `google-ads` quota source, never touched by `cluster_keywords`.                                                                                                                                                                                                                                                                                                                                                | **Confirmed, not open**: no currency field exists anywhere, so the view needs an operator-configured currency label. `normalizeMetric` already collapses absent-vs-zero into `0` at the source — that requirement was withdrawn in favor of a hedged-zero label. Clustering IS already inspectable (`KeywordCluster.keywords` lists members) — no seam needed there.                                                                                                                                                                                                                                    |
| `seo-intelligence-view`   | **RECONCILED, re-verified field-by-field in the fourth pass** — all five tools shipped (`analyze_domain`, `find_seo_opportunities`, `find_keyword_cannibalization`, `map_keywords_to_pages`, `find_content_gaps`; commits `e8fe45f`/`b24d66d`/`1b82926`). Provenance concern resolved: `Opportunity.type`+`recommendation` already name the producing signal on every opportunity. `analyze_domain`'s `crawl` sub-object reuses `SiteCrawlResult` fields directly, so drill-down into `site-crawl-view`/`page-report-view` is concrete, not speculative. Three fourth-pass mechanisms are now designed, not open: BFF-echoed effective criteria (no tool-side `criteria` exists), classification of the nested `gscError` on a success payload, and the unconditional 250-row-pull caveat. | `impact`/`effort`/`priorityScore` are confirmed open-ended, unnormalized (`effort` is a fixed 1/2/3 per-type constant). Internal-linking recommendations verified genuinely unbuilt — no tool touches `linkGraph`. Adding a real `criteria` field to the five tools stays a recommended `src/seo/*` follow-up, outside this change's additive-only boundary.                                                                                                                                                                                                                                            |
| `history-comparison-view` | **RECONCILED** — both the GSC-snapshot family and crawl-snapshot family shipped and are D1-backed (commits `8d3640a`/`28d8066`); root `wrangler.jsonc` now has the `DB` binding. Comparison tools return a real `diff` (`GscDiff`/`CrawlDiff`), already bucketed by direction.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **Correction to this design's earlier assumption**: no tool carries a `retention: { windowDays, oldestAvailable }` field as this design originally speculated a future tool would. No retention field exists anywhere, and no retention enforcement exists in `src/db/*.ts` at all — snapshots accumulate indefinitely. The UI-side-constant rejection below still stands, but for a different reason now: not "it would disagree with the server", but "there is no server-side retention to reflect at all." Treat retention as unbounded until a dedicated server-side change adds real enforcement. |

**History and comparison — RECONCILED, superseding the blocker below.** This section originally described a
blocker (no D1 binding, no snapshot writer, no history tool) that no longer holds: D1 is bound
(`wrangler.jsonc`), both snapshot families are shipped, and `compare_search_console`/`compare_crawls` return
real bucketed diffs. Kept for the record, corrected: the retention-field mechanism this design proposed
(`retention: { windowDays, oldestAvailable }` as a required result field) was **not** what shipped — no tool
carries a retention field, and no retention enforcement exists in `src/db/gsc-store.ts` or
`src/db/crawl-store.ts` at all. The UI-side-constant rejection still applies, now for the correct reason: not
because it would drift from a real server-side window, but because there is no server-side window to
reflect. The view must present history as unbounded and accumulating, per `history-comparison-view`'s
reconciled spec, until a dedicated server-side change adds real retention enforcement.

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

Three rows added by the fourth reconciliation pass, each also carrying a RED test:

- (f) **No `business_*` tool is reachable through the BFF.** The authenticated registry is an allowlist; assert
  it contains no `business_*` name and that a request naming one is rejected before any upstream call. The
  concrete hazard is a live public write (`business_reply_review`/`update_info`/`create_post`), not a stray read.
- (g) **`analyze_domain`'s `gscError` never forwards upstream text.** Stub an enrichment failure whose message
  contains a decoy credential and assert the literal appears nowhere in the 200-OK response body, cache value,
  export or log line, and that the response carries a classified code instead of the original string.
- (h) **No result is presented as complete.** Assert the 250-row-pull caveat renders unconditionally for the
  five intelligence tools, and that `count === effectiveLimit` renders a bound label while `count < limit` does
  not — for a request that omitted the limit, so the _resolved default_ is the value compared against.

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

Independently revertable slices, each inside the 800-line review budget, in the order `tasks.md` uses:
(1) `src/schemas/search-console.ts` + inferred aliases + `outputSchema` + published types — additive, hosts
ignoring `structuredContent` are unaffected, revert = drop the field and `wrangler rollback`; (2) the BFF
authenticated route class (allowlist registry + containment + freshness + classifier) with the GSC route;
(3) quota ledger + cache class; (4) the `search-console-view` UI; then, per capability family, a schema slice
followed by a view slice — `gsc-insight-views`, `keyword-research-view`, `seo-intelligence-view`,
`history-comparison-view`. Every schema slice is additive and revertable on its own; every view slice reverts to
the shell's disabled-view state. The BFF MUST tolerate an output schema's absence rather than fail closed, so a
view slice can deploy against a rolled-back `seo-mcp`. Credential containment, the allowlist registry, and the
access gate are **never** rolled back while an authenticated route is live.

## Decisions Resolved Before Tasks

The proposal's decision table is closed; the values `tasks.md` implements are:

- **Cache TTL** — hours with explicit `?refresh=1`: `AUTH_SOURCE_TTL_SECONDS[source].closed` at the top of the
  inherited `[60, 86400]` clamp, `.open` short. No timer, no revalidate-on-focus.
- **Default GSC range** — last 28 days, compared against the previous 28.
- **Credential vs. quota failure** — BFF-side text classification with the safe default: unclassifiable ⇒
  non-retryable, operator-facing. Server-side codes remain the recommended follow-up (option (c) trajectory).
- **Quota accounting** — BFF-side approximate, same semantics `dashboard-views` accepted for the MCP bucket;
  wording "at least N calls used in this window", `basis: "bff-observed"`, never a remaining count.
- **Charting** — hand-rolled SVG per `dashboard-views`; no charting library.
- **Property list** — free-text `siteUrl` (no list-properties tool exists).
- **`outputSchema` ownership** — here; `dashboard-bff-foundations` is archived, so folding back is impossible.
- **Google Business Profile** — out of scope by explicit user decision; a future SDD change owns it.

## Open Questions

Only genuinely undecidable-here values remain; none blocks the task breakdown.

- [ ] `GSC_REPORTING_LAG_DAYS` numeric value, and whether the `dimensions: ["date"]` probe is worth one extra
      Google call to upgrade `basis` from `assumed` to `reported`. Deferred to apply time as a config constant.
- [ ] `AUTH_SOURCE_TTL_SECONDS` concrete numbers within the resolved "hours / short" shape.
- [ ] `AUTH_SOURCE_BUDGET[source]` daily figures for `search-console` and `google-ads`.
- [ ] Whether the server-side error-code change and the tool-side `criteria` field are scheduled as follow-up
      `seo-mcp` changes (both recommended; neither is a deliverable here).
