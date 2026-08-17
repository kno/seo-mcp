/**
 * BFF request router. The single most important property this module
 * upholds: `authenticate()` runs BEFORE any dispatch to the MCP client, for
 * every `/api/*` route. The SPA shell itself (`/`, hashed assets, unknown
 * deep links) is deliberately NOT gated — a fresh visitor must be able to
 * load the page containing the login form, or they could never submit it;
 * the shell holds no data of its own, only `/api/*` ever reaches `SEO_MCP`
 * or any credential. Three `/api/`-adjacent exceptions exist: `POST
 * /auth/session` (the login endpoint itself, so it cannot require a prior
 * session), `GET /auth/google/callback` (`google-account-connect-flow`'s
 * OAuth callback — pre-gate, authorized by the signed `state` token rather
 * than the session cookie, since Google's cross-site redirect to it is not
 * guaranteed to carry one), and `GET /auth/google/authorize` (gated by
 * `authenticate()`, same as `/api/*`, but its own path is not under
 * `/api/` since it manages the `state` round-trip rather than proxying an
 * MCP tool call).
 *
 * Each tool route validates its own inputs with a Zod schema mirroring
 * `src/server.ts`'s `inputSchema` for that tool exactly (same fields, same
 * bounds, same defaults) before any dispatch to `callTool`. Inputs arrive
 * as query string parameters on a `GET` request, coerced to the right
 * primitive type where needed (`limit`, `concurrency` arrive as strings).
 * The one exception: `POST /api/tools/analyze_pagespeed` accepts the same
 * inputs as a JSON body instead, so a caller supplying the secret `apiKey`
 * field never sends it as a query-string parameter (visible in DevTools'
 * Network tab and in any access log). `GET` on that same route remains
 * available for the no-`apiKey` case.
 *
 * Every route (except `analyze_pagespeed` with an explicit `apiKey`, see
 * `isCacheable`) is cached in `env.RESULT_CACHE` and deduplicated via
 * `single-flight.ts` before ever reaching `callTool`. Cache reads/writes
 * are wrapped by `cache.ts` itself so a missing/throwing KV binding never
 * fails the request — it degrades to a direct upstream call and reports
 * `cacheStatus: "unavailable"`.
 *
 * Manual-snapshot-deletion follow-up: `POST /api/tools/delete_search_console_snapshot`
 * and `POST /api/tools/delete_crawl_snapshot` are a SECOND, deliberate
 * deviation from the GET convention — unlike `analyze_pagespeed`'s reason
 * (a secret input), this one is about the HTTP method's own safety
 * semantics. Deletion is irreversible, and a GET request can be triggered
 * unintentionally (link prefetching, browser history navigation, crawlers)
 * in a way a POST cannot — GET is conventionally treated as safe/
 * idempotent-to-retry by browsers and infrastructure, so an accidental GET
 * to a delete endpoint is a real risk a POST does not share. Both routes
 * are POST-ONLY: a GET to either path is rejected as 404 by the same
 * `request.method !== "GET"` early-return below, never silently accepted
 * the way `snapshot_search_console`/`snapshot_crawl` accept GET for their
 * own (safe, re-crawlable) writes. The request body carries
 * `{ snapshotId, confirm: true }` as JSON — the same transport shape
 * `analyze_pagespeed`'s POST path already uses via `parseBody`. `confirm`
 * is typed as `z.literal(true)` in each input schema, so `confirm: false`
 * or an omitted `confirm` fails validation and is rejected with
 * `invalid_input` before `dispatch()` — and therefore before any D1 call —
 * ever runs. Neither route is cacheable (`cache.ts#isCacheable`) — a
 * mutation's response must never be served stale. `POST
 * /api/tools/delete_site` (domain-management follow-up) is a THIRD,
 * identical POST-ONLY deviation, for the same reason.
 *
 * `handleRequest`'s optional third parameter, `ctx` (the Worker's
 * `ExecutionContext`), exists solely so `dispatchAuthenticated()` can fire
 * its upstream-quota-ledger increment via `ctx.waitUntil` — fire-and-
 * forget, never adding latency to the response. `bff/src/index.ts` always
 * supplies it in production; it is optional here only so existing unit
 * tests that call `handleRequest(request, env)` directly, without a
 * Workers runtime, keep compiling (see
 * `authenticated/quota-ledger.ts#recordUpstreamAttempt` for the inline-
 * await fallback that keeps those tests deterministic).
 */

import * as z from "zod/v4";
import { authenticate, createSession } from "./gate";
import { handleOauthAuthorize } from "./oauth/authorize";
import { handleOauthCallback } from "./oauth/callback";
import { bffErrorResponse, type BffErrorCode } from "./errors";
import { callTool, type McpClientResult } from "./mcp-client";
import { TOOL_TIMEOUT_MS, type ToolName } from "./timeout";
import {
  CACHE_TTL_SECONDS,
  authRangeState,
  authenticatedTtlSeconds,
  cacheKey,
  getCached,
  isCacheable,
  putCached,
  shouldBypassCacheRead,
} from "./cache";
import { withSingleFlight } from "./single-flight";
import { getUsageSnapshot } from "./usage";
import type { BffOk } from "./errors";
import { healthSchema } from "../../src/schemas/health";
import { pageAnalysisSchema } from "../../src/schemas/page";
import { siteCrawlResultSchema } from "../../src/schemas/site";
import { linkCheckResultSchema } from "../../src/schemas/links";
import { pageSpeedResultSchema } from "../../src/schemas/pagespeed";
import { gscDimensionSchema } from "../../src/schemas/search-console";
import { clusterResultSchema } from "../../src/schemas/keywords";
import {
  snapshotCrawlResultSchema,
  listCrawlSnapshotsResultSchema,
  compareCrawlsResultSchema,
  deleteCrawlSnapshotResultSchema,
} from "../../src/schemas/crawl-snapshots";
import { deleteSearchConsoleSnapshotResultSchema } from "../../src/schemas/gsc-snapshots";
import {
  listSitesResultSchema,
  addSiteResultSchema,
  deleteSiteResultSchema,
  disconnectGoogleAccountResultSchema,
  checkSiteCredentialsResultSchema,
} from "../../src/schemas/sites";
import { getAuthenticatedRoute } from "./authenticated/registry";
import {
  GSC_REPORTING_LAG_DAYS,
  deriveSourceFreshness,
} from "./authenticated/freshness";
import {
  classifyStorageFailure,
  classifyUpstreamFailure,
} from "./authenticated/classify";
import {
  getQuotaEstimate,
  recordUpstreamAttempt,
  type QuotaEstimate,
} from "./authenticated/quota-ledger";
import type { EffectiveCriteria } from "./authenticated/criteria";
import {
  deleteSiteAccountEntry,
  gateSiteCredential,
  refreshSiteAccountMap,
  resolveAccountForRoute,
  type AccountResolution,
} from "./authenticated/account-scope";

const crawlPageInputSchema = z.object({
  url: z.url().describe("Public HTTP or HTTPS page URL"),
});

const crawlSiteInputSchema = z.object({
  url: z.url().describe("Public HTTP or HTTPS site URL"),
  limit: z.coerce.number().int().min(1).max(20).default(10),
  concurrency: z.coerce.number().int().min(1).max(4).default(4),
});

const checkLinksInputSchema = z.object({
  url: z.url().describe("Public HTTP or HTTPS page URL"),
});

// `history-comparison-view` (PR11). Mirrors `src/server.ts`'s
// `snapshot_crawl`/`list_crawl_snapshots`/`compare_crawls` inputSchemas
// exactly. NOT authenticated — see `authenticated/registry.ts`'s doc
// comment for why: `snapshot_crawl` calls `crawlSite` internally (no
// Google credential, no Google quota, exactly like `crawl_site` itself),
// and `list_crawl_snapshots`/`compare_crawls` only read/diff D1-stored
// crawl data with no Google linkage at all — unlike their GSC-snapshot
// siblings, there is no "search-console"-source freshness fact to derive
// for this family (crawled pages have no Google reporting-lag concept).
const snapshotCrawlInputSchema = z.object({
  url: z.url().describe("Public HTTP or HTTPS site URL"),
  limit: z.coerce.number().int().min(1).max(20).optional(),
  concurrency: z.coerce.number().int().min(1).max(4).optional(),
  label: z.string().min(1).optional(),
});

const listCrawlSnapshotsInputSchema = z.object({
  url: z.url(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

const compareCrawlsInputSchema = z.object({
  url: z.url(),
  baseSnapshotId: z.coerce.number().int().positive().optional(),
  currentSnapshotId: z.coerce.number().int().positive().optional(),
});

// Manual-snapshot-deletion follow-up. Mirrors `src/server.ts`'s
// `delete_search_console_snapshot`/`delete_crawl_snapshot` inputSchemas
// exactly, EXCEPT `confirm` is narrowed to `z.literal(true)` rather than
// `z.boolean()`: this route's transport is a POST JSON body (see this
// file's top-of-file doc comment), so — unlike a GET route's coerced
// query-string fields — there is no reason to accept `confirm: false` or
// omit it only to re-check it deeper in the pipeline. Narrowing here means
// `parseBody` itself rejects an unconfirmed request as `invalid_input`
// before `dispatch()` — and therefore before any D1 call — ever runs.
const deleteSearchConsoleSnapshotInputSchema = z.object({
  snapshotId: z.number().int().positive(),
  confirm: z.literal(true),
});

const deleteCrawlSnapshotInputSchema = z.object({
  snapshotId: z.number().int().positive(),
  confirm: z.literal(true),
});

// Domain-management follow-up. Mirrors `src/mcp-tools/sites.ts`'s
// `list_sites`/`add_site`/`delete_site` inputSchemas. `list_sites`/
// `add_site` stay GET (a duplicate `add_site` is a safe no-op, undoable via
// `delete_site` — the same "safe/idempotent-ish" reasoning
// `snapshot_crawl`/`snapshot_search_console` already get GET for). Only
// `delete_site` is POST-only, with `confirm` narrowed to `z.literal(true)`
// for the same reason `deleteSearchConsoleSnapshotInputSchema` narrows it —
// see this file's top-of-file doc comment.
const listSitesInputSchema = z.object({});

const addSiteInputSchema = z.object({
  url: z.string().min(1),
  label: z.string().min(1).optional(),
});

const deleteSiteInputSchema = z.object({
  siteId: z.number().int().positive(),
  confirm: z.literal(true),
});

// Phase 4b (`site-google-credentials`, `dashboard-bff`). Mirrors
// `src/mcp-tools/site-credentials.ts`'s `disconnect_google_account`/
// `check_site_credentials` inputSchemas. Both are POST-only JSON body
// routes: `disconnect_google_account` for the same irreversibility reason
// `deleteSiteInputSchema` narrows `confirm` above; `check_site_credentials`
// for consistency with its sibling and because it can trigger a live
// probe call with `forceRecheck: true`, which — like a mutation — must
// never be served from or written to the cache (`cache.ts#isCacheable`).
const disconnectGoogleAccountInputSchema = z.object({
  siteId: z.number().int().positive(),
  confirm: z.literal(true),
});

const checkSiteCredentialsInputSchema = z.object({
  siteId: z.number().int().positive(),
  forceRecheck: z.boolean().optional(),
});

const analyzePagespeedInputSchema = z.object({
  url: z.url().describe("Public HTTP or HTTPS page URL"),
  strategy: z.enum(["mobile", "desktop"]).default("mobile"),
  apiKey: z.string().min(1).optional(),
});

// Mirrors `src/server.ts`'s `search_console_query` inputSchema exactly:
// `siteUrl` free-text (no list-properties tool exists), `startDate`/
// `endDate` as `YYYY-MM-DD`, optional `dimensions` (comma-separated on the
// query string since a GET route carries no repeated-key array support
// here), optional `rowLimit` 1-250.
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const searchConsoleQueryInputSchema = z.object({
  siteUrl: z.string().min(1),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
  dimensions: z
    .string()
    .optional()
    .transform((value) =>
      value === undefined
        ? undefined
        : value.split(",").filter((part) => part.length > 0),
    )
    .pipe(z.array(gscDimensionSchema).optional()),
  rowLimit: z.coerce.number().int().min(1).max(250).optional(),
});

// Mirrors `src/server.ts`'s `find_striking_distance_keywords` inputSchema
// exactly (`gsc-insight-views`, PR6).
const strikingDistanceInputSchema = z.object({
  siteUrl: z.string().min(1),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
  minPosition: z.coerce.number().min(1).max(100).optional(),
  maxPosition: z.coerce.number().min(1).max(100).optional(),
  minImpressions: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(250).optional(),
});

// Mirrors `src/server.ts`'s `find_low_ctr_opportunities` inputSchema exactly.
const lowCtrOpportunitiesInputSchema = z.object({
  siteUrl: z.string().min(1),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
  maxPosition: z.coerce.number().min(1).max(100).optional(),
  minImpressions: z.coerce.number().int().min(0).optional(),
  maxCtr: z.coerce.number().min(0).max(1).optional(),
  limit: z.coerce.number().int().min(1).max(250).optional(),
});

// Mirrors `src/server.ts`'s `snapshot_search_console` inputSchema exactly.
const snapshotSearchConsoleInputSchema = z.object({
  siteUrl: z.string().min(1),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
  dimensions: z
    .string()
    .optional()
    .transform((value) =>
      value === undefined
        ? undefined
        : value.split(",").filter((part) => part.length > 0),
    )
    .pipe(z.array(gscDimensionSchema).optional()),
  label: z.string().min(1).optional(),
});

// Mirrors `src/server.ts`'s `list_search_console_snapshots` inputSchema
// exactly.
const listSearchConsoleSnapshotsInputSchema = z.object({
  siteUrl: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

// Mirrors `src/server.ts`'s `compare_search_console` inputSchema exactly.
// Neither ID is a `dateOnlySchema` field — `dispatchAuthenticated()` derives
// this tool's `sourceFreshness` from today's date rather than from any
// request field (see `authenticated/registry.ts`'s doc comment).
const compareSearchConsoleInputSchema = z.object({
  siteUrl: z.string().min(1),
  baseSnapshotId: z.coerce.number().int().positive().optional(),
  currentSnapshotId: z.coerce.number().int().positive().optional(),
});

// Mirrors `src/server.ts`'s `find_seo_opportunities` inputSchema exactly
// (`seo-intelligence-view`, PR10).
const findSeoOpportunitiesInputSchema = z.object({
  siteUrl: z.string().min(1),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// Mirrors `src/server.ts`'s `find_keyword_cannibalization` inputSchema
// exactly.
const findKeywordCannibalizationInputSchema = z.object({
  siteUrl: z.string().min(1),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
  minImpressions: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

// Mirrors `src/server.ts`'s `map_keywords_to_pages` inputSchema exactly.
const mapKeywordsToPagesInputSchema = z.object({
  siteUrl: z.string().min(1),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
  limit: z.coerce.number().int().min(1).max(100).optional(),
  topQueriesPerPage: z.coerce.number().int().min(1).max(50).optional(),
});

// Mirrors `src/server.ts`'s `find_content_gaps` inputSchema exactly.
const findContentGapsInputSchema = z.object({
  siteUrl: z.string().min(1),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
  minPosition: z.coerce.number().min(1).max(100).optional(),
  minImpressions: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// Mirrors `src/server.ts`'s `analyze_domain` inputSchema exactly.
// `startDate`/`endDate`/`gscProperty`/`opportunityLimit` are all optional —
// GSC enrichment only runs when `gscProperty`+both dates are given
// (`src/seo/domain-report.ts#analyzeDomain`).
const analyzeDomainInputSchema = z.object({
  url: z.url(),
  limit: z.coerce.number().int().min(1).max(20).optional(),
  concurrency: z.coerce.number().int().min(1).max(4).optional(),
  gscProperty: z.string().min(1).optional(),
  startDate: dateOnlySchema.optional(),
  endDate: dateOnlySchema.optional(),
  opportunityLimit: z.coerce.number().int().min(1).max(100).optional(),
});

// A GET route carries no repeated-key array support here (same constraint
// `dimensions` above already works around), so every array-shaped input for
// the three `keyword-research-view` tools below travels as a single
// comma-separated query parameter, split and trimmed here.
function commaSeparatedList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

const requiredKeywordListSchema = (max: number) =>
  z
    .string()
    .transform(commaSeparatedList)
    .pipe(z.array(z.string().min(1)).min(1).max(max));

const optionalKeywordListSchema = z
  .string()
  .optional()
  .transform((value) =>
    value === undefined ? undefined : commaSeparatedList(value),
  )
  .pipe(z.array(z.string().min(1)).optional());

const optionalGeoTargetIdsSchema = z
  .string()
  .optional()
  .transform((value) =>
    value === undefined ? undefined : commaSeparatedList(value),
  )
  .pipe(z.array(z.string()).optional());

// Mirrors `src/server.ts`'s `get_keyword_metrics` inputSchema exactly.
const getKeywordMetricsInputSchema = z.object({
  keywords: requiredKeywordListSchema(100),
  geoTargetIds: optionalGeoTargetIdsSchema,
  languageId: z.string().optional(),
  customerId: z.string().optional(),
});

// Mirrors `src/server.ts`'s `discover_keywords` inputSchema exactly. The
// "at least one of seedKeywords/seedUrl" cross-field constraint is enforced
// tool-side (`discoverKeywords` throws "Provide seedKeywords or seedUrl") —
// this route deliberately does not duplicate it, the same "let the tool's
// own validation classify" precedent every other route in this file follows
// for a non-Google-shaped, our-own-text failure.
const discoverKeywordsInputSchema = z.object({
  seedKeywords: optionalKeywordListSchema,
  seedUrl: z.string().optional(),
  geoTargetIds: optionalGeoTargetIdsSchema,
  languageId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  customerId: z.string().optional(),
});

// Mirrors `src/server.ts`'s `cluster_keywords` inputSchema exactly. Not
// authenticated — no Google Ads call, no credential, no quota — so this
// route is dispatched via the ordinary `dispatch()` path below, never
// `dispatchAuthenticated()`.
const clusterKeywordsInputSchema = z.object({
  keywords: requiredKeywordListSchema(500),
});

function parseQuery<T>(
  url: URL,
  schema: z.ZodType<T>,
): { ok: true; data: T } | { ok: false } {
  const raw: Record<string, string> = {};
  for (const [key, value] of url.searchParams) raw[key] = value;
  const parsed = schema.safeParse(raw);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false };
}

/**
 * Parses a JSON request body against a tool's input schema. This is the
 * transport used ONLY for a route carrying a secret input (currently just
 * `analyze_pagespeed`'s optional `apiKey`) — a query string is visible in
 * browser DevTools' Network tab and in any access log the request passes
 * through, which a POST body is not. Every other route stays GET +
 * query-string, unchanged, to avoid touching their already-verified
 * cache/single-flight behavior.
 */
async function parseBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false };
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false };
}

function validateUpstreamResultsFlag(env: Env): boolean {
  return String(env.VALIDATE_UPSTREAM_RESULTS) !== "false";
}

function toolResponse<T>(
  result: McpClientResult<T>,
  cacheStatus: BffOk<T>["cacheStatus"],
  resultAge: number,
): Response {
  if (!result.ok) return bffErrorResponse(result.code, result.retryAfter);
  return Response.json({
    data: result.data,
    cacheStatus,
    resultAge,
  });
}

async function dispatch<TInput, TResult>(
  request: Request,
  url: URL,
  env: Env,
  toolName: ToolName,
  args: TInput,
  schema: z.ZodType<TResult>,
  /**
   * `history-comparison-view` (PR11) only. `snapshot_crawl`/
   * `list_crawl_snapshots`/`compare_crawls` need `classifyStorageFailure`
   * (D1-not-configured vs. insufficient-snapshots, task 11.6) despite being
   * routed through the ordinary, NON-authenticated `dispatch()` path — see
   * `authenticated/registry.ts`'s doc comment for why the crawl-snapshot
   * family, unlike its GSC-snapshot sibling, is not in that allowlist at
   * all. Every other `dispatch()` caller omits this, preserving their
   * existing blind `tool_failed` mapping unchanged.
   */
  classifyFailureText?: (text: string) => BffErrorCode,
): Promise<Response> {
  // Computed unconditionally, even for the non-cacheable (bypass) branch:
  // this is the SAME content-hash `cacheKey()` used for KV lookups, reused
  // as `keyHash` for the structured `bff.upstream` log line so a future
  // consumer can correlate log lines with cache keys without re-deriving
  // anything. Hashing an apiKey-bearing input does not leak the secret
  // itself (it is a one-way digest), even though that hash is never used
  // to read or write the cache for this route.
  const key = await cacheKey(toolName, args);

  const callUpstream = () =>
    callTool(toolName, args as Record<string, unknown>, schema, {
      seoMcp: env.SEO_MCP,
      mcpOrigin: env.MCP_ORIGIN,
      token: env.MCP_AUTH_TOKEN,
      timeoutMs: TOOL_TIMEOUT_MS[toolName],
      validateUpstreamResults: validateUpstreamResultsFlag(env),
      keyHash: key,
      ...(classifyFailureText ? { classifyFailureText } : {}),
    });

  const inputs = args as Record<string, unknown>;
  if (!isCacheable(toolName, inputs)) {
    // Secret input (e.g. an explicit analyze_pagespeed apiKey) — never
    // read from or written to the cache, and never single-flighted under
    // a key that excludes the secret (that would leak one caller's
    // result to another with a different apiKey).
    const result = await callUpstream();
    return toolResponse(result, "bypass", 0);
  }

  let cacheStatus: BffOk<TResult>["cacheStatus"] = "miss";

  if (!shouldBypassCacheRead(request, url)) {
    const cached = await getCached<TResult>(env.RESULT_CACHE, key);
    if (cached.status === "hit") {
      return toolResponse(
        { ok: true, data: cached.data },
        "hit",
        cached.resultAge,
      );
    }
    cacheStatus = cached.status;
  }

  const result = await withSingleFlight(key, callUpstream);
  if (result.ok) {
    await putCached(
      env.RESULT_CACHE,
      key,
      toolName,
      result.data,
      CACHE_TTL_SECONDS[toolName],
    );
  }
  return toolResponse(result, cacheStatus, 0);
}

/**
 * Authenticated-route response helper — same envelope shape as
 * `toolResponse`, plus:
 * - the REQUIRED `sourceFreshness` field (`authenticated-source-contract`).
 *   Always recomputed at request time, even on a cache hit — it must never
 *   be treated as a cached fact about "when we fetched this" (that is
 *   `resultAge`'s job), only about how stale the upstream data itself is.
 * - `quota`, the BFF-observed Google-side call-volume estimate
 *   (`authenticated/quota-ledger.ts`), independent of and never merged
 *   with the MCP bucket's `usage.ts` figure. Present on every successful
 *   response — hit or miss — including when its own `basis` is
 *   `"unavailable"` (threat matrix row e: a KV failure degrades the
 *   ESTIMATE, never the request).
 * - `currencyLabel`, present ONLY for a `"google-ads"`-source route with an
 *   operator-configured `env.ADS_BID_CURRENCY_LABEL`
 *   (`keyword-research-view`'s "Monetary Values Are Never Rendered Without a
 *   Currency Label" requirement). Omitted entirely — never an empty string —
 *   when unset, so the view's "configuration needed" state (task 8.2) can
 *   distinguish "no label configured" from "label is an empty string" by the
 *   field's mere presence, the same optional-field discipline
 *   `sourceFreshness` uses for its own REQUIRED-ness in the other direction.
 *   This is a BFF-ENVELOPE field sourced from config, never read from the
 *   tool's own payload — `KeywordMetric` carries no currency field at all
 *   (verified: `src/google/ads.ts:9-16`).
 * - `credential`, REQUIRED on every response (`domain-google-credentials`,
 *   Phase 5, `authenticated-source-contract` "Every Authenticated Result
 *   Carries Credential Provenance"): `{ source: "site" | "global",
 *   accountKey, accountLabel, basis: "bff-resolved" }`, sourced from
 *   `account-scope.ts#resolveAccountForRoute` — itself reusing `list_sites`'
 *   already-computed `credential` field (`credentialStatusForSite`,
 *   `src/google/health.ts`) rather than re-deriving anything (design.md,
 *   "Decision: provenance rides the BFF envelope, not sixteen output
 *   schemas"). `basis: "bff-resolved"` is deliberate, honest labelling: the
 *   value comes from the BFF's 300s-TTL map, not from the code path that
 *   actually chose the credential.
 * - `criteria`, present ONLY for a `seo-intelligence-view` route with an
 *   `effectiveCriteria` resolver (`authenticated/registry.ts`, PR10) — the
 *   BFF-echoed EFFECTIVE (post-default-resolution) request criteria, `basis:
 *   "request"`, distinct from `OpportunityResult.criteria` which the TOOL
 *   itself echoes (design.md's "two mechanisms behind the same UI
 *   requirement"). Present on every successful response for these five
 *   tools, hit or miss, so a request that omitted a limit still gets a
 *   correct bound label (task 10.2, threat row h).
 */
function authenticatedToolResponse<T>(
  result: McpClientResult<T>,
  cacheStatus: BffOk<T>["cacheStatus"],
  resultAge: number,
  sourceFreshness: ReturnType<typeof deriveSourceFreshness>,
  quota: QuotaEstimate,
  account: AccountResolution,
  currencyLabel?: string,
  criteria?: EffectiveCriteria,
): Response {
  if (!result.ok) return bffErrorResponse(result.code, result.retryAfter);
  return Response.json({
    data: result.data,
    cacheStatus,
    resultAge,
    sourceFreshness,
    quota,
    credential: {
      source: account.source,
      accountKey: account.accountKey,
      accountLabel: account.accountLabel,
      basis: "bff-resolved",
    },
    ...(currencyLabel !== undefined ? { currencyLabel } : {}),
    ...(criteria !== undefined ? { criteria } : {}),
  });
}

/**
 * A result is treated as "zero-row" for cache-TTL purposes (see
 * `cache.ts#authenticatedTtlSeconds`'s `resultIsEmpty` parameter) across
 * every one of the six authenticated tools' differently-shaped results:
 * `rowCount` (the GSC/opportunity/snapshot-capture shapes), `count` (the
 * snapshot-list shape), or — for `compare_search_console`'s `diff`, which
 * has neither — all four decay buckets being empty.
 */
function isZeroResultLike(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  const record = data as Record<string, unknown>;
  if (typeof record.rowCount === "number") return record.rowCount === 0;
  if (typeof record.count === "number") return record.count === 0;
  if (record.diff && typeof record.diff === "object") {
    const diff = record.diff as Record<string, unknown>;
    return (["decayed", "improved", "lost", "gained"] as const).every(
      (bucket) =>
        Array.isArray(diff[bucket]) && (diff[bucket] as unknown[]).length === 0,
    );
  }
  return false;
}

/**
 * Dispatches an authenticated route. Differs from `dispatch()` in four
 * ways required by `authenticated-source-contract`:
 * (1) the tool MUST be present in `authenticated/registry.ts`'s allowlist
 * — a `business_*` or otherwise unregistered name is rejected with a 404
 * before any cache read or upstream call (threat row f);
 * (2) upstream `isError` text is classified instead of collapsing to a
 * blind `tool_failed`, and the matched text is discarded (threat row d) —
 * via `classify.ts#classifyUpstreamFailure` for a route with
 * `callsGoogleUpstream: true`, or `classify.ts#classifyStorageFailure`
 * otherwise (`gsc-insight-views`' two D1-only tools, task 6.7);
 * (3) every response — hit, miss, or error — carries a freshly-derived
 * `sourceFreshness`, never merged with `resultAge`; the calendar date it is
 * derived from comes from `route.freshnessDate(args, data)`, since not
 * every registered tool has a request-level `endDate`
 * (`authenticated/registry.ts`'s doc comment);
 * (4) caching uses the `authenticated-delayed` class (`cache.ts`), TTL
 * selected per-source and per-range-state rather than per-tool, and the
 * upstream quota ledger is incremented exactly once per real upstream
 * ATTEMPT for a route with `callsGoogleUpstream: true` — never on a cache
 * hit, a gate rejection, an input-validation failure, or a D1-only route
 * that never touches Google at all (`authenticated/quota-ledger.ts`).
 *
 * `ctx` (the Worker's `ExecutionContext`) is threaded through so the
 * ledger increment can run via `ctx.waitUntil` — see
 * `quota-ledger.ts#recordUpstreamAttempt` for what happens when it is
 * absent (test-only fallback, never a production path).
 */
async function dispatchAuthenticated(
  request: Request,
  url: URL,
  env: Env,
  ctx: ExecutionContext | undefined,
  toolName: ToolName,
  args: Record<string, unknown>,
): Promise<Response> {
  const route = getAuthenticatedRoute(toolName);
  if (!route) return new Response("Not found", { status: 404 });

  // `domain-google-credentials`, Phase 5: resolved BEFORE the cache key, so
  // the key itself can be scoped by the account that will answer the call
  // (`account-scope.ts`'s doc comment — the second cross-account leak). Only
  // routes with a `siteUrl` argument are site-scoped at all today —
  // `get_keyword_metrics`/`discover_keywords` have none yet (threat matrix
  // row g, deferred), so they resolve `resolveAccountForRoute`'s
  // `siteUrl === undefined` fallback, unchanged from their pre-Phase-5
  // behavior in every observable way except carrying the new `credential`
  // envelope field.
  const siteUrl = typeof args.siteUrl === "string" ? args.siteUrl : undefined;
  const account = await resolveAccountForRoute(env.RESULT_CACHE, siteUrl, {
    seoMcp: env.SEO_MCP,
    mcpOrigin: env.MCP_ORIGIN,
    token: env.MCP_AUTH_TOKEN,
    validateUpstreamResults: validateUpstreamResultsFlag(env),
  });

  // Task 5.6: a site-scoped call resolving to no usable credential at all,
  // or to a site whose Search Console health is unhealthy, is rejected
  // BEFORE any cache read or upstream call — see `gateSiteCredential`'s doc
  // comment for why Ads health never gates.
  const gateCode = gateSiteCredential(account);
  if (gateCode) return bffErrorResponse(gateCode);

  const key = await cacheKey(toolName, args, account.accountKey);
  const budget = env.AUTH_SOURCE_BUDGET[route.source] ?? 0;
  const lagDays = route.lagDays ?? GSC_REPORTING_LAG_DAYS;

  // See `authenticatedToolResponse`'s doc comment: omitted (never an empty
  // string) whenever the operator has not configured a label, so the view
  // can distinguish "not configured" from "configured as empty" by the
  // field's mere presence.
  const currencyLabel =
    route.source === "google-ads" &&
    typeof env.ADS_BID_CURRENCY_LABEL === "string" &&
    env.ADS_BID_CURRENCY_LABEL.length > 0
      ? env.ADS_BID_CURRENCY_LABEL
      : undefined;

  const readQuotaEstimate = () =>
    getQuotaEstimate(
      env.RESULT_CACHE,
      route.source,
      budget,
      account.accountKey,
    );

  // `seo-intelligence-view` (PR10) only — see `authenticatedToolResponse`'s
  // doc comment. Computed once from the validated request args, reused on
  // every response branch below (cache hit and fresh fetch alike).
  const criteria = route.effectiveCriteria?.(args);

  const classifyFailureText = route.callsGoogleUpstream
    ? classifyUpstreamFailure
    : classifyStorageFailure;

  // `route.schema` is typed as the UNION of every published schema (so the
  // registry can only ever hold a schema literal imported from
  // `src/types/schemas.ts`, per `registry.ts`'s doc comment) — narrowing it
  // back to `callTool`'s single-schema generic requires this cast. Runtime
  // behavior is unaffected: `callTool` still re-validates the real
  // `structuredContent` against this exact schema value.
  const callUpstream = () =>
    callTool(toolName, args, route.schema as z.ZodType<unknown>, {
      seoMcp: env.SEO_MCP,
      mcpOrigin: env.MCP_ORIGIN,
      token: env.MCP_AUTH_TOKEN,
      timeoutMs: route.timeoutMs,
      validateUpstreamResults: validateUpstreamResultsFlag(env),
      classifyFailureText,
      keyHash: key,
    });

  // Records the ledger increment IMMEDIATELY BEFORE the real upstream
  // call, and only for a route that actually calls Google
  // (`callsGoogleUpstream: true`) — this is the single call site that runs
  // exactly when `withSingleFlight` invokes it as the leader (never for a
  // follower awaiting the same in-flight promise, never when a cache hit or
  // an earlier validation failure returns before reaching this line, and
  // never for a D1-only route, which spends no Google quota at all).
  const trackedCallUpstream = async () => {
    if (route.callsGoogleUpstream) {
      await recordUpstreamAttempt(
        ctx,
        env.RESULT_CACHE,
        route.source,
        account.accountKey,
      );
    }
    return callUpstream();
  };

  // `list_search_console_snapshots` (and, via the ordinary `dispatch()`
  // path, `list_crawl_snapshots`) are never cached — see `isCacheable`'s
  // doc comment. Unlike `dispatch()`, this function had no `isCacheable`
  // check at all until this fix: every authenticated route unconditionally
  // read/wrote the cache, so a `delete_*_snapshot` mutation could leave a
  // now-stale list result served as a "hit" for up to that route's own TTL.
  // `sourceFreshness`/`quota`/`currencyLabel` are unaffected — the response
  // still carries them, only the `cacheStatus` and its underlying KV
  // read/write are skipped.
  if (!isCacheable(toolName, args)) {
    const result = await trackedCallUpstream();
    const sourceFreshness = deriveSourceFreshness(
      route.source,
      route.freshnessDate(args, result.ok ? result.data : undefined),
      undefined,
      lagDays,
    );
    return authenticatedToolResponse(
      result,
      "bypass",
      0,
      sourceFreshness,
      await readQuotaEstimate(),
      account,
      currencyLabel,
      criteria,
    );
  }

  if (!shouldBypassCacheRead(request, url)) {
    const cached = await getCached(env.RESULT_CACHE, key);
    if (cached.status === "hit") {
      const sourceFreshness = deriveSourceFreshness(
        route.source,
        route.freshnessDate(args, cached.data),
        undefined,
        lagDays,
      );
      return authenticatedToolResponse(
        { ok: true, data: cached.data },
        "hit",
        cached.resultAge,
        sourceFreshness,
        await readQuotaEstimate(),
        account,
        currencyLabel,
        criteria,
      );
    }
  }

  const upstreamResult = await withSingleFlight(key, trackedCallUpstream);

  // `analyze_domain` only (PR10): classifies and discards a nested
  // `gscError` on an otherwise-successful result BEFORE it is cached or
  // returned — see `authenticated/domain-report.ts`'s doc comment. Every
  // other route has no `transformSuccess`, so `result`/`forceOpenTtl` are
  // exactly `upstreamResult`/`false`, unchanged behavior.
  let result = upstreamResult;
  let forceOpenTtl = false;
  if (upstreamResult.ok && route.transformSuccess) {
    const transformed = route.transformSuccess(upstreamResult.data);
    result = { ok: true, data: transformed.data };
    forceOpenTtl = transformed.forceOpenTtl;
  }

  if (result.ok) {
    const rangeState = forceOpenTtl
      ? "open"
      : authRangeState(route.freshnessDate(args, result.data), lagDays);
    await putCached(
      env.RESULT_CACHE,
      key,
      toolName,
      result.data,
      authenticatedTtlSeconds(
        env.AUTH_SOURCE_TTL_SECONDS,
        route.source,
        rangeState,
        isZeroResultLike(result.data),
      ),
    );
  }
  const sourceFreshness = deriveSourceFreshness(
    route.source,
    route.freshnessDate(args, result.ok ? result.data : undefined),
    undefined,
    lagDays,
  );
  return authenticatedToolResponse(
    result,
    "miss",
    0,
    sourceFreshness,
    await readQuotaEstimate(),
    account,
    currencyLabel,
    criteria,
  );
}

export async function handleRequest(
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/auth/session") {
    return createSession(request, env);
  }

  // `google-account-connect-flow`: the OAuth callback is a SECOND pre-gate
  // route, in the same spirit as `POST /auth/session` above — Google's
  // cross-site 302 to this route is not guaranteed to carry the dashboard
  // session cookie, so this route authorizes itself via the signed,
  // single-use `state` token instead (`bff/src/oauth/callback.ts`), never
  // via `authenticate()`. Explicitly enumerated, never reachable through
  // the generic `/api/tools/{tool}` dispatch path below.
  if (request.method === "GET" && url.pathname === "/auth/google/callback") {
    return handleOauthCallback(request, env, undefined);
  }

  // The SPA shell itself (`/`, hashed assets, unknown deep links) is
  // never gated — a fresh visitor must be able to load the page
  // containing the login form, or they could never submit it. Only
  // `/api/*` (and the OAuth authorize route below, which manages its own
  // `site_credentials` state rather than proxying a tool call) ever
  // reaches SEO_MCP or any credential, so only those are gated.
  // `run_worker_first: true` on the `assets` binding still routes this
  // request to this Worker rather than letting the Asset Worker's own SPA
  // fallback intercept it.
  const requiresGate =
    url.pathname.startsWith("/api/") ||
    url.pathname === "/auth/google/authorize";
  if (requiresGate) {
    const outcome = await authenticate(request, env);
    if (outcome === "unavailable") return bffErrorResponse("gate_unavailable");
    if (outcome === "denied") return bffErrorResponse("gate_unauthorized");
  } else {
    return env.ASSETS.fetch(request);
  }

  // `google-account-connect-flow`: authorize route, explicitly enumerated
  // (never pattern-matched), a second route class distinct from the
  // tool-proxy routes below — it manages the `state` token round-trip, not
  // an MCP tool call.
  if (request.method === "GET" && url.pathname === "/auth/google/authorize") {
    return handleOauthAuthorize(request, env, undefined);
  }

  // The one secret-bearing route accepts POST with a JSON body, so a
  // caller supplying apiKey never sends it as a query-string parameter.
  // GET remains available on this same route for the no-apiKey case,
  // preserving cache/single-flight behavior for that common path.
  if (
    request.method === "POST" &&
    url.pathname === "/api/tools/analyze_pagespeed"
  ) {
    const parsed = await parseBody(request, analyzePagespeedInputSchema);
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    return dispatch(
      request,
      url,
      env,
      "analyze_pagespeed",
      parsed.data,
      pageSpeedResultSchema,
    );
  }

  // Manual-snapshot-deletion follow-up. POST-only, JSON body — see this
  // file's top-of-file doc comment for the full irreversibility/GET-safety
  // reasoning. `classifyStorageFailure` mirrors `snapshot_crawl`/
  // `list_crawl_snapshots`/`compare_crawls`'s own precedent so a
  // D1-not-configured failure still renders as its own distinct state.
  if (
    request.method === "POST" &&
    url.pathname === "/api/tools/delete_search_console_snapshot"
  ) {
    const parsed = await parseBody(
      request,
      deleteSearchConsoleSnapshotInputSchema,
    );
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    return dispatch(
      request,
      url,
      env,
      "delete_search_console_snapshot",
      parsed.data,
      deleteSearchConsoleSnapshotResultSchema,
      classifyStorageFailure,
    );
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/tools/delete_crawl_snapshot"
  ) {
    const parsed = await parseBody(request, deleteCrawlSnapshotInputSchema);
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    return dispatch(
      request,
      url,
      env,
      "delete_crawl_snapshot",
      parsed.data,
      deleteCrawlSnapshotResultSchema,
      classifyStorageFailure,
    );
  }

  // Domain-management follow-up. POST-only, JSON body — a THIRD deliberate
  // GET-deviation, mirroring `delete_search_console_snapshot`/
  // `delete_crawl_snapshot` exactly (see this file's top-of-file doc
  // comment for the full irreversibility/GET-safety reasoning).
  if (request.method === "POST" && url.pathname === "/api/tools/delete_site") {
    const parsed = await parseBody(request, deleteSiteInputSchema);
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    return dispatch(
      request,
      url,
      env,
      "delete_site",
      parsed.data,
      deleteSiteResultSchema,
    );
  }

  // `site-google-credentials`, Phase 4b. POST-only, JSON body — same
  // irreversibility/GET-safety reasoning as `delete_site` above.
  if (
    request.method === "POST" &&
    url.pathname === "/api/tools/disconnect_google_account"
  ) {
    const parsed = await parseBody(request, disconnectGoogleAccountInputSchema);
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    const response = await dispatch(
      request,
      url,
      env,
      "disconnect_google_account",
      parsed.data,
      disconnectGoogleAccountResultSchema,
    );
    // `domain-google-credentials`, Phase 5: `disconnect_google_account`'s own
    // result carries no `siteUrl` (`disconnectGoogleAccountResultSchema` has
    // only `siteId`/`disconnected`) to key a single `ak1:{siteUrl}` delete
    // on, unlike `connect_google_account` (`bff/src/oauth/callback.ts`) — a
    // blanket `refreshSiteAccountMap` refresh instead overwrites every
    // site's entry, including the just-disconnected one, with current
    // truth. Fire-and-forget via `ctx.waitUntil` when available, mirroring
    // `quota-ledger.ts#recordUpstreamAttempt`'s own ctx-present/absent split.
    if (response.ok) {
      const refresh = refreshSiteAccountMap(env.RESULT_CACHE, {
        seoMcp: env.SEO_MCP,
        mcpOrigin: env.MCP_ORIGIN,
        token: env.MCP_AUTH_TOKEN,
        validateUpstreamResults: validateUpstreamResultsFlag(env),
      });
      if (ctx) ctx.waitUntil(refresh);
      else await refresh;
    }
    return response;
  }

  // `site-google-credentials`, Phase 4b. POST-only, JSON body — mirrors its
  // sibling above; `forceRecheck: true` triggers a live probe call that,
  // like a mutation, must never be served from or written to the cache
  // (`cache.ts#isCacheable`).
  if (
    request.method === "POST" &&
    url.pathname === "/api/tools/check_site_credentials"
  ) {
    const parsed = await parseBody(request, checkSiteCredentialsInputSchema);
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    return dispatch(
      request,
      url,
      env,
      "check_site_credentials",
      parsed.data,
      checkSiteCredentialsResultSchema,
    );
  }

  if (request.method !== "GET") {
    return new Response("Not found", { status: 404 });
  }

  if (url.pathname === "/api/usage") {
    return Response.json(getUsageSnapshot());
  }

  if (url.pathname === "/api/tools/health") {
    return dispatch(request, url, env, "health", {}, healthSchema);
  }

  if (url.pathname === "/api/tools/crawl_page") {
    const parsed = parseQuery(url, crawlPageInputSchema);
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    return dispatch(
      request,
      url,
      env,
      "crawl_page",
      parsed.data,
      pageAnalysisSchema,
    );
  }

  if (url.pathname === "/api/tools/crawl_site") {
    const parsed = parseQuery(url, crawlSiteInputSchema);
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    return dispatch(
      request,
      url,
      env,
      "crawl_site",
      parsed.data,
      siteCrawlResultSchema,
    );
  }

  if (url.pathname === "/api/tools/check_links") {
    const parsed = parseQuery(url, checkLinksInputSchema);
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    return dispatch(
      request,
      url,
      env,
      "check_links",
      parsed.data,
      linkCheckResultSchema,
    );
  }

  if (url.pathname === "/api/tools/analyze_pagespeed") {
    // An apiKey supplied over GET would travel as a query-string parameter
    // — exactly what the POST + JSON body path above exists to avoid.
    // Reject rather than silently accept it, so this route cannot be used
    // insecurely even by a caller other than this project's own UI.
    if (url.searchParams.has("apiKey")) {
      return bffErrorResponse("invalid_input");
    }
    const parsed = parseQuery(url, analyzePagespeedInputSchema);
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    return dispatch(
      request,
      url,
      env,
      "analyze_pagespeed",
      parsed.data,
      pageSpeedResultSchema,
    );
  }

  if (url.pathname === "/api/tools/search_console_query") {
    const parsed = parseQuery(url, searchConsoleQueryInputSchema);
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    return dispatchAuthenticated(
      request,
      url,
      env,
      ctx,
      "search_console_query",
      parsed.data as Record<string, unknown>,
    );
  }

  if (url.pathname === "/api/tools/find_striking_distance_keywords") {
    const parsed = parseQuery(url, strikingDistanceInputSchema);
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    return dispatchAuthenticated(
      request,
      url,
      env,
      ctx,
      "find_striking_distance_keywords",
      parsed.data as Record<string, unknown>,
    );
  }

  if (url.pathname === "/api/tools/find_low_ctr_opportunities") {
    const parsed = parseQuery(url, lowCtrOpportunitiesInputSchema);
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    return dispatchAuthenticated(
      request,
      url,
      env,
      ctx,
      "find_low_ctr_opportunities",
      parsed.data as Record<string, unknown>,
    );
  }

  if (url.pathname === "/api/tools/snapshot_search_console") {
    const parsed = parseQuery(url, snapshotSearchConsoleInputSchema);
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    return dispatchAuthenticated(
      request,
      url,
      env,
      ctx,
      "snapshot_search_console",
      parsed.data as Record<string, unknown>,
    );
  }

  if (url.pathname === "/api/tools/list_search_console_snapshots") {
    const parsed = parseQuery(url, listSearchConsoleSnapshotsInputSchema);
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    return dispatchAuthenticated(
      request,
      url,
      env,
      ctx,
      "list_search_console_snapshots",
      parsed.data as Record<string, unknown>,
    );
  }

  if (url.pathname === "/api/tools/compare_search_console") {
    const parsed = parseQuery(url, compareSearchConsoleInputSchema);
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    return dispatchAuthenticated(
      request,
      url,
      env,
      ctx,
      "compare_search_console",
      parsed.data as Record<string, unknown>,
    );
  }

  if (url.pathname === "/api/tools/get_keyword_metrics") {
    const parsed = parseQuery(url, getKeywordMetricsInputSchema);
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    return dispatchAuthenticated(
      request,
      url,
      env,
      ctx,
      "get_keyword_metrics",
      parsed.data as Record<string, unknown>,
    );
  }

  if (url.pathname === "/api/tools/discover_keywords") {
    const parsed = parseQuery(url, discoverKeywordsInputSchema);
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    return dispatchAuthenticated(
      request,
      url,
      env,
      ctx,
      "discover_keywords",
      parsed.data as Record<string, unknown>,
    );
  }

  if (url.pathname === "/api/tools/find_seo_opportunities") {
    const parsed = parseQuery(url, findSeoOpportunitiesInputSchema);
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    return dispatchAuthenticated(
      request,
      url,
      env,
      ctx,
      "find_seo_opportunities",
      parsed.data as Record<string, unknown>,
    );
  }

  if (url.pathname === "/api/tools/find_keyword_cannibalization") {
    const parsed = parseQuery(url, findKeywordCannibalizationInputSchema);
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    return dispatchAuthenticated(
      request,
      url,
      env,
      ctx,
      "find_keyword_cannibalization",
      parsed.data as Record<string, unknown>,
    );
  }

  if (url.pathname === "/api/tools/map_keywords_to_pages") {
    const parsed = parseQuery(url, mapKeywordsToPagesInputSchema);
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    return dispatchAuthenticated(
      request,
      url,
      env,
      ctx,
      "map_keywords_to_pages",
      parsed.data as Record<string, unknown>,
    );
  }

  if (url.pathname === "/api/tools/find_content_gaps") {
    const parsed = parseQuery(url, findContentGapsInputSchema);
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    return dispatchAuthenticated(
      request,
      url,
      env,
      ctx,
      "find_content_gaps",
      parsed.data as Record<string, unknown>,
    );
  }

  if (url.pathname === "/api/tools/analyze_domain") {
    const parsed = parseQuery(url, analyzeDomainInputSchema);
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    return dispatchAuthenticated(
      request,
      url,
      env,
      ctx,
      "analyze_domain",
      parsed.data as Record<string, unknown>,
    );
  }

  // NOT authenticated — no Google Ads call, no credential, no quota. Routed
  // through the ordinary `dispatch()` path, exactly like `crawl_page`.
  if (url.pathname === "/api/tools/cluster_keywords") {
    const parsed = parseQuery(url, clusterKeywordsInputSchema);
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    return dispatch(
      request,
      url,
      env,
      "cluster_keywords",
      parsed.data,
      clusterResultSchema,
    );
  }

  // `history-comparison-view` (PR11). NOT authenticated — see this file's
  // input-schema comment above and `authenticated/registry.ts`'s doc
  // comment for the full reasoning. All three pass `classifyStorageFailure`
  // so a D1-not-configured or fewer-than-two-snapshots failure still
  // renders as its own distinct state (task 11.6), despite being routed
  // through the ordinary, non-authenticated `dispatch()` path.
  if (url.pathname === "/api/tools/snapshot_crawl") {
    const parsed = parseQuery(url, snapshotCrawlInputSchema);
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    return dispatch(
      request,
      url,
      env,
      "snapshot_crawl",
      parsed.data,
      snapshotCrawlResultSchema,
      classifyStorageFailure,
    );
  }

  if (url.pathname === "/api/tools/list_crawl_snapshots") {
    const parsed = parseQuery(url, listCrawlSnapshotsInputSchema);
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    return dispatch(
      request,
      url,
      env,
      "list_crawl_snapshots",
      parsed.data,
      listCrawlSnapshotsResultSchema,
      classifyStorageFailure,
    );
  }

  if (url.pathname === "/api/tools/compare_crawls") {
    const parsed = parseQuery(url, compareCrawlsInputSchema);
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    return dispatch(
      request,
      url,
      env,
      "compare_crawls",
      parsed.data,
      compareCrawlsResultSchema,
      classifyStorageFailure,
    );
  }

  if (url.pathname === "/api/tools/list_sites") {
    const parsed = parseQuery(url, listSitesInputSchema);
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    return dispatch(
      request,
      url,
      env,
      "list_sites",
      parsed.data,
      listSitesResultSchema,
    );
  }

  if (url.pathname === "/api/tools/add_site") {
    const parsed = parseQuery(url, addSiteInputSchema);
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    return dispatch(
      request,
      url,
      env,
      "add_site",
      parsed.data,
      addSiteResultSchema,
    );
  }

  // An unmatched `/api/*` path is a bad API call, not a page — return 404
  // rather than silently falling back to the SPA shell. This is also the
  // rejection path for every `business_*` tool name and any other tool the
  // authenticated registry does not name (threat row f): no route below
  // ever dispatches to `SEO_MCP` for an unrecognized tool name.
  // Every request reaching this point has `/api/` as its pathname prefix
  // (every non-`/api/` request already returned via the SPA-shell branch
  // above) — an unmatched `/api/*` path is a bad API call, not a page.
  // This is also the rejection path for every `business_*` tool name and
  // any other tool the authenticated registry does not name (threat row
  // f): no route above ever dispatches to `SEO_MCP` for an unrecognized
  // tool name.
  return new Response("Not found", { status: 404 });
}
