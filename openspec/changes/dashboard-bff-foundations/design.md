# Design: Dashboard BFF Foundations

## Technical Approach

Two independently deployable Workers in one repo. `seo-mcp` (unchanged entry, `src/index.ts`) gains one
source of truth for result shapes: Zod schemas whose inferred types replace the hand-written result
interfaces, wired into `registerTool` as `outputSchema` and used to validate `structuredContent` in place of
the cast at `src/server.ts:8-11`. A new `bff/` Worker holds `MCP_AUTH_TOKEN`, calls `seo-mcp` over a service
binding, gates every request before any upstream work, caches results in its own KV namespace, and translates
every failure into one envelope. Satisfies `mcp-result-contract`, `dashboard-bff`, `bff-result-cache`,
`dashboard-access-gate`, `mcp-error-contract`.

`src/http/*` and `src/security/*` are not touched. The BFF **imports** `verifyTokens`
(`src/http/auth.ts:43-69`) rather than duplicating it — that function is pure, `Env`-free and already tested,
so reuse needs no edit there.

## Architecture Decisions

### Decision: BFF layout and binding ownership

| Option                                                                                   | Tradeoff                                                                  | Decision   |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------- |
| `bff/` dir, own `bff/wrangler.jsonc`, service + KV bindings declared **on the BFF side** | One repo, two deploy units; `wrangler.jsonc` at root stays byte-identical | **Chosen** |
| KV + service binding declared in root `wrangler.jsonc`                                   | Couples rollback of a BFF-only concern to the MCP Worker config           | Rejected   |
| Separate repo                                                                            | Loses shared schemas/types without publishing a package                   | Rejected   |

**Correction to the proposal**: it listed root `wrangler.jsonc` as Modified for the KV namespace. Service
bindings are declared by the **caller**, and the cache belongs to the BFF, so root `wrangler.jsonc` needs no
change. Root `Env` (`src/config.ts:1-5`) is hand-written and stays as-is (out of scope); the BFF `Env` MUST
come from `wrangler types -c bff/wrangler.jsonc` and MUST NOT be hand-written.

```jsonc
// bff/wrangler.jsonc (shape)
{
  "name": "seo-dashboard-bff",
  "main": "src/index.ts",
  "compatibility_date": "2026-08-10",
  "services": [{ "binding": "SEO_MCP", "service": "seo-mcp" }],
  "kv_namespaces": [{ "binding": "RESULT_CACHE", "id": "<ID>" }],
  "vars": {
    "GATE_STRATEGY": "shared-secret-cookie",
    "MCP_ORIGIN": "https://seo-mcp.internal",
    "CACHE_TTL_SECONDS": {/* per tool */},
    "TOOL_TIMEOUT_MS": {/* per tool */},
  },
  "observability": { "enabled": true },
}
```

### Decision: one schema source, types derived

**Choice**: Zod v4 object schemas (`import * as z from "zod/v4"`, matching `src/server.ts:2`) live in
`src/schemas/{page,site,pagespeed,links,health}.ts`. Each existing result interface becomes
`export type PageAnalysis = z.infer<typeof pageAnalysisSchema>` **in its current file**, so every import path
in `src/crawl/*` and `src/seo/*` keeps working.
**Alternatives rejected**: interfaces plus parallel hand-written schemas (two artifacts to drift — the
`mcp-result-contract` "no separate manually maintained copy" scenario forbids it); `zod-to-json-schema` from
interfaces (impossible direction).
**Rationale**: one edit point, and inferred alias types are assignable to `Record<string, unknown>` where
`interface` declarations are not — which is precisely what lets the cast disappear:

```ts
const jsonResult = <T>(schema: z.ZodType<T>, value: T) => {
  const parsed = schema.parse(value); // throws -> caught -> errorResult
  return {
    content: [{ type: "text" as const, text: JSON.stringify(parsed, null, 2) }],
    structuredContent: parsed,
  };
};
```

`outputSchema` sits beside `inputSchema` in the `registerTool` config object.

**VALIDATED against the installed `@modelcontextprotocol/server@2.0.0` declarations** (orchestrator check,
this session). Three facts settled:

- The published JSDoc example registers a tool with `inputSchema: z.object({...})` and
  `outputSchema: z.object({ bmi: z.number() })` in the same config object
  (`dist/createMcpHandler-CLhGwQTn.d.mts:3284-3288`), so the assumed field placement is correct and a Zod
  schema is accepted directly.
- The SDK converts the schema itself via `standardSchemaToJsonSchema(tool.outputSchema, "output")`
  (`dist/mcp-DXXb3Vv3.mjs:1391`). Zod v4 implements Standard Schema, so **no manual `z.toJSONSchema()` call
  is needed**.
- The SDK already validates the payload: `validateStandardSchema(tool.outputSchema, result.structuredContent)`
  (`dist/mcp-DXXb3Vv3.mjs:1443`). Declaring the schema therefore delivers the runtime validation the
  `mcp-result-contract` spec requires; the `schema.parse` above is a belt-and-braces local check, not the
  only line of defense.

One constraint this surfaces: a non-object schema root triggers a legacy `{result:…}` wire wrap
(`d.mts:1113-1119`), so every tool's output schema root MUST be an object. All five current result shapes are
objects, so this costs nothing today.

There are **five** tools, not four. `check_links` (`src/server.ts:79`) landed in commit `614d21e` during this
planning chain. **Confirmed IN SCOPE by the user**, so it gets the same treatment as the other four: a Zod
output schema (`LinkCheckResult`/`LinkProbe`), a published type, a BFF route, a TTL and a timeout. The delta
specs were amended accordingly.

`check_links` carries one defect the dashboard must design around, found while specifying it: its budget is
`LIMITS.linkCheckSubrequestBudget: 60`, while `README.md:109` states the `crawl_site` budget of 48 exists to
keep bounds "below the Free-plan ceilings" of 50 external subrequests per invocation. With
`maxLinkChecks: 50`, one page fetch plus up to 50 probes (each able to consume up to `maxRedirects + 1 = 4`
subrequests) means the 60 budget does not protect the invocation — the platform ceiling is reached first, and
the failure is a platform error rather than the tool's graceful fail-closed. This is a server-side defect in
freshly committed code, **out of scope for this change to fix**, but the BFF MUST surface it as a normalized
upstream error (see the `dashboard-bff` spec) rather than as an empty success.

### Decision: published result-types module

`src/types/index.ts` — type-only re-exports (`export type { ... }`) of `PageAnalysis`, `SiteCrawlResult` and
nested types, `PageSpeedResult`, `Strategy`, `LinkCheckResult`, `HealthResult`. Under
`verbatimModuleSyntax` these erase entirely, so a consumer importing it pulls in **zero** Worker runtime code.
A second entry `src/types/schemas.ts` re-exports the runtime Zod schemas for consumers that want validation
(depends only on `zod`, never on `src/http`, `src/crawl`, `src/seo` runtime modules). The BFF imports both by
relative path; no npm publish and no pnpm workspace is introduced.

### Decision: KV cache first, DO behind a named trigger

Escalate to a Durable Object coalescer when **either** holds over a rolling 24 h with ≥1000 upstream calls:
upstream 429s exceed **1 %** of upstream calls, or duplicate upstream calls for the same cache key inside a
10 s window exceed **5 %**. Measured from structured logs (`{"event":"bff.upstream","tool","keyHash","status"}`)
via Workers Logs. Until then KV is accepted as eventually consistent and single-flight as isolate-local.

## Data Flow

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant G as bff/gate.ts
  participant R as bff/router.ts
  participant K as RESULT_CACHE (KV)
  participant F as bff/single-flight.ts
  participant C as bff/mcp-client.ts
  participant M as seo-mcp /mcp
  B->>G: POST /api/tools/crawl_site (session cookie, NO token)
  G-->>B: 401 gate_unauthorized (no upstream work)
  G->>R: allowed
  R->>R: Zod input parse + defaults -> 400 invalid_input on failure
  R->>K: get(v1:crawl_site:<sha256>)
  K-->>R: hit -> envelope + resultAge  (miss/throw -> continue)
  R->>F: acquire(key)
  F->>C: leader only; followers await same promise
  C->>M: env.SEO_MCP.fetch(Request + Authorization: Bearer MCP_AUTH_TOKEN)
  Note over C,M: TOKEN INJECTED HERE ONLY — service binding, no public hop
  M-->>C: JSON-RPC result | isError | 401/429/503
  C->>C: validate structuredContent vs shared schema
  C-->>R: result | typed failure
  R->>K: ctx.waitUntil(put(..., { expirationTtl }))
  R-->>B: { data, cacheStatus, resultAge } | { error: { code, message, retryAfter? } }
  Note over R,B: TOKEN NEVER HERE — not in body, headers, cache value, log or envelope
```

## File Changes

| File                                                                                   | Action          | Description                                                        |
| -------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------ |
| `src/schemas/*.ts`                                                                     | Create          | Zod object schema per result shape; single source of truth         |
| `src/seo/html.ts`, `src/crawl/site.ts`, `src/crawl/links.ts`, `src/pagespeed/types.ts` | Modify          | Interfaces become `z.infer` aliases; import paths unchanged        |
| `src/server.ts`                                                                        | Modify          | `outputSchema` on all five tools; typed `jsonResult`; cast removed |
| `src/types/index.ts`, `src/types/schemas.ts`                                           | Create          | Published type entry + schema entry                                |
| `bff/wrangler.jsonc`, `bff/worker-configuration.d.ts`                                  | Create          | Config; `Env` **generated** by `wrangler types`                    |
| `bff/src/{index,router,gate,session,mcp-client,cache,single-flight,errors,timeout}.ts` | Create          | BFF implementation                                                 |
| `bff/.dev.vars`, `.gitignore`                                                          | Create / Modify | Local secrets; `.dev.vars` MUST be git-ignored                     |
| `tsconfig.json`                                                                        | Modify          | `include` += `bff`, `vitest.bff-integration.config.ts`             |
| `vitest.config.ts`                                                                     | Modify          | `unit.include` += `bff/test/**/*.test.ts`; third project added     |
| `vitest.bff-integration.config.ts`                                                     | Create          | `defineWorkersProject`, `configPath: "./bff/wrangler.jsonc"`       |
| `package.json`                                                                         | Modify          | `dev:bff`, `deploy:bff`, `types:bff` (`-c bff/wrangler.jsonc`)     |
| `wrangler.jsonc`, `src/http/*`, `src/security/*`                                       | Unchanged       | Any drift here is a scope escalation                               |

Prettier needs no config change: `bff/` is not in `.prettierignore`, so `pnpm format:check` covers it.

## Interfaces / Contracts

```ts
// bff/src/errors.ts
export type BffErrorCode =
  | "gate_unauthorized"
  | "gate_unavailable"
  | "invalid_input"
  | "upstream_unauthorized"
  | "upstream_rate_limited"
  | "upstream_unavailable"
  | "upstream_forbidden"
  | "upstream_protocol"
  | "tool_failed"
  | "result_invalid"
  | "bff_timeout";
export interface BffError {
  code: BffErrorCode;
  message: string;
  retryAfter?: number;
}
export interface BffOk<T> {
  data: T;
  cacheStatus: "hit" | "miss" | "bypass" | "unavailable";
  resultAge: number;
}
```

| Source                                  | Evidence                | `code`                  | HTTP | `retryAfter`            |
| --------------------------------------- | ----------------------- | ----------------------- | ---- | ----------------------- |
| Gate rejection (before any MCP call)    | this design             | `gate_unauthorized`     | 401  | –                       |
| Gate crypto/secret missing              | mirrors `auth.ts:78-86` | `gate_unavailable`      | 503  | –                       |
| BFF input Zod failure                   | this design             | `invalid_input`         | 400  | –                       |
| Upstream 401 + `www-authenticate`       | `auth.ts:90-101`        | `upstream_unauthorized` | 502  | –                       |
| Upstream 429 + `retry-after: 60`        | `auth.ts:108`           | `upstream_rate_limited` | 429  | from header, default 60 |
| Upstream 503                            | `auth.ts:86,96,111`     | `upstream_unavailable`  | 503  | –                       |
| Upstream 403 host/origin policy         | `request-policy.ts:5-8` | `upstream_forbidden`    | 502  | –                       |
| Malformed / non-JSON-RPC reply          | this design             | `upstream_protocol`     | 502  | –                       |
| Tool `isError: true` plain text         | `server.ts:13-21`       | `tool_failed`           | 422  | –                       |
| `structuredContent` fails shared schema | BFF re-validation       | `result_invalid`        | 502  | –                       |
| Timeout awaiting upstream               | this design             | `bff_timeout`           | 504  | –                       |

`result_invalid` is produced by BFF-side re-validation against the same schema, so it stays distinguishable
from `tool_failed` without inventing a new MCP payload. Every `message` is a fixed per-code constant; only
`tool_failed` forwards upstream text, after redacting `Bearer` sequences and `authorization`/
`www-authenticate` values. Tokens never enter logs.

**Cache**: key `v1:{tool}:{sha256(canonicalJson(parsedInputsWithDefaults))}`. `analyze_pagespeed` requests
carrying an explicit `apiKey` are **never cached** — a secret must not derive a KV key. Value
`{ storedAt, tool, result }`; `resultAge = now - storedAt`. TTL from `CACHE_TTL_SECONDS[tool]`, clamped to
`[60, 86400]` (KV minimum is 60 s). `?refresh=1` or `cache-control: no-cache` skips the read, still writes.
Any KV absence or throw yields `cacheStatus: "unavailable"` and a direct upstream call — never fail closed.

**Single-flight**: a module-level `Map<string, Promise<Result>>`. This is the one permitted module-level
mutable value, under invariants: keyed only by the content hash, never by caller identity; entries deleted in
`finally`; values hold no credentials. Results are non-user-specific under one shared credential, so sharing
a leader's promise leaks nothing across callers.

**Gate seam** (mechanism deliberately left open): `interface GateStrategy { authenticate(request, env): Promise<"allowed" | "denied" | "unavailable"> }`, selected by `env.GATE_STRATEGY`.
`shared-secret-cookie` — `POST /auth/session` verifies `DASHBOARD_SECRET` via `verifyTokens`, then sets an
HttpOnly/Secure/SameSite=Strict cookie carrying `HMAC-SHA-256(sub|exp, DASHBOARD_SESSION_KEY)`, never the raw
secret. `bearer-allowlist` — per-user digests in one secret, timing-safe compared. `local-only` — allowed
only when `GATE_MODE === "local"`, refuses in production. All three plug into the same `authorize()` call at
router entry. Secrets via `wrangler secret put <NAME> -c bff/wrangler.jsonc`; `bff/.dev.vars` locally.

**Timeouts**: `AbortSignal.timeout(TOOL_TIMEOUT_MS[tool])` on the service-binding fetch; `AbortError` →
`bff_timeout`. `health` 5 s, `crawl_page` 15 s, `analyze_pagespeed` 30 s, `crawl_site` 55 s, `check_links`
55 s (50 probes × 6 s ÷ concurrency 6), ceiling 55 s. `crawl_site`'s ~40 s bound (8 s `fetchTimeoutMs`,
20 pages ÷ concurrency 4) is I/O-bound, so wall clock is not the binding constraint — **CPU is**. Validating a
256 KB `crawl_site` payload twice (server + BFF) is real CPU against the Free-plan budget, so BFF
re-validation is gated by `VALIDATE_UPSTREAM_RESULTS` (default on) with the cost recorded as telemetry.
Route shape survives the open SSE decision: `POST /api/tools/{tool}` returns JSON today and MAY later
negotiate `Accept: text/event-stream` on the same path, streaming progress frames that terminate in this same
envelope. Only the terminal result is ever cached.

## Testing Strategy

Strict TDD: every row's RED test precedes implementation.

| Layer                                 | What to Test                                                                                                                                                                                                            | Approach                                                                                                                                                                                                                                     |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit (`test/`)                        | Each schema accepts real fixtures and tolerates optional fields; cast-free `jsonResult` returns validated content; a non-conforming result becomes a tool failure                                                       | Reuse existing fixtures; `pnpm typecheck` proves the cast is gone                                                                                                                                                                            |
| Unit (`bff/test/`)                    | Gate outcomes (allowed/denied/unavailable) incl. timing-safe path; cache key normalization + `apiKey` bypass; TTL clamping; the full code-mapping table; timeout race; single-flight leader/follower with a fake client | Pure functions with injected deps, mirroring the `AuthDependencies` pattern (`auth.ts:16-18`)                                                                                                                                                |
| Integration (`bff/test/integration/`) | Service-binding wiring, token injection, real KV read/write/TTL, gate-before-upstream ordering                                                                                                                          | `defineWorkersProject` on `bff/wrangler.jsonc`; upstream is a **stub MCP auxiliary worker** (`poolOptions.workers.miniflare.workers`) that asserts the `Authorization` header and returns canned JSON-RPC frames; `isolatedStorage` per test |
| Integration (`test/integration/`)     | Tool registration exposes `outputSchema`; structured content round-trips                                                                                                                                                | Existing project, unchanged config                                                                                                                                                                                                           |

Respecting `ROADMAP.md:20`, the real `/mcp` auth path stays out of integration tests because the ratelimit
binding is not reliably simulated. The stub upstream is what makes 401/429/503 mapping testable at all: it
returns those statuses directly, exercising the BFF's translation without depending on the real limiter.

## Threat Matrix

Applicable boundaries here are HTTP routing and secret handling, not shell/VCS. Rows from the reference
matrix: Documentation-like paths — **N/A**, no file classification or execution. Git repository selection —
**N/A**, no VCS automation. Commit state — **N/A**. Push state — **N/A**. PR commands — **N/A**, no PR
automation. Substituted applicable cases, each carrying a RED test: (a) unauthenticated request to every
route reaches no upstream; (b) token absent from every response body, header, cache value and log line;
(c) unknown `/api/tools/{tool}` returns 404, never a proxied upstream call; (d) KV absent or throwing serves
a live result instead of failing closed.

## Migration / Rollout

Four slices, each independently revertable: (1) schemas + inferred types + `src/types` (additive; old clients
ignoring `structuredContent` are unaffected); (2) BFF skeleton + gate + service binding — **the gate ships in
the same slice as the first route**, never after; (3) KV cache + single-flight; (4) observability for the DO
trigger. Rollback per the proposal: `wrangler rollback` for `seo-mcp`, delete the BFF deployment for the BFF,
drop the KV binding and rerun `wrangler types -c bff/wrangler.jsonc` for the cache. The gate is never rolled
back while the BFF lives.

## Open Questions

- [x] ~~**MCP v2 `outputSchema` signature is UNVALIDATED.**~~ **RESOLVED** by the orchestrator against the
      installed `@modelcontextprotocol/server@2.0.0` declarations. `node_modules/` is in fact present; the
      design phase simply had no shell access to read it. `outputSchema` IS a `registerTool` config field, it
      accepts a Zod schema directly (Standard Schema), the SDK converts it to JSON Schema itself, and the SDK
      validates `structuredContent` against it at runtime. No `z.toJSONSchema()` call is needed. See the
      validated evidence in the output-schema decision section above. **New constraint:** every output schema
      root MUST be an object, or the SDK applies a legacy `{result:…}` wire wrap.
- [x] ~~Delta specs enumerate four tools; `check_links` is a fifth.~~ **RESOLVED: the user confirmed
      `check_links` is IN SCOPE.** Delta specs amended: output schema and published type in
      `mcp-result-contract`, route in `dashboard-bff`, plus a new requirement covering platform-subrequest
      failures. It landed in commit `614d21e` during this chain, which is why the first spec pass missed it —
      a concurrency artifact, not a spec-authoring error.
- [x] **Three authenticated tools have landed since this design was first written**, all explicitly DEFERRED
      from this change and now routed by `dashboard-insights` instead: `search_console_query` (commit
      `9e570a3`, with Google single-tenant OAuth in `e5fa342`), plus `find_striking_distance_keywords` and
      `find_low_ctr_opportunities` (commit `a5b4f22`). The server registers **eight** tools today. All three
      deferred tools depend on an external authenticated data source (a Google refresh token), which raises
      secret-handling, per-property authorization and cacheability questions this change does not answer.
      Their OAuth is **Google's**, not MCP-client OAuth, so the Phase 6/7 gating in `DASHBOARD_ROADMAP.md` is
      unaffected. The five tools this change actually scopes — `health`, `crawl_page`, `crawl_site`,
      `check_links`, `analyze_pagespeed` — are unchanged.
- [ ] **Server-side defect to raise separately (not this change):** `LIMITS.linkCheckSubrequestBudget: 60`
      exceeds the Free-plan ceiling of 50 that `README.md:109` says the budgets stay below, and `check_links`
      is undocumented in `README.md`. Needs its own change against `ROADMAP.md`.
- [ ] Gate mechanism: `shared-secret-cookie` is the designed default; `bearer-allowlist` and `local-only`
      exist as strategies. Needs confirmation.
- [ ] Per-tool cache TTL values need a product answer on acceptable staleness; the design only fixes the
      clamp `[60, 86400]`.
- [ ] Bounded response vs SSE for crawl progress stays open; the route shape above survives either.
- [ ] `src/seo/html.ts` and `src/crawl/page.ts` currently carry uncommitted work from another actor
      (per-page timings). Slice 1 edits `src/seo/html.ts`, so merge order must be settled before it starts.
