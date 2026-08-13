/**
 * BFF request router. The single most important property this module
 * upholds: `authenticate()` runs BEFORE any dispatch to the MCP client and
 * BEFORE any static asset is served, for every route — including unknown
 * GET routes, which fall through to `env.ASSETS.fetch` (the SPA shell)
 * rather than reaching `SEO_MCP`; unknown non-GET routes return 404.
 * `POST /auth/session` is the sole exception: it is the login endpoint
 * itself, so it cannot require a prior session.
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
 */

import * as z from "zod/v4";
import { authenticate, createSession } from "./gate";
import { bffErrorResponse } from "./errors";
import { callTool, type McpClientResult } from "./mcp-client";
import { TOOL_TIMEOUT_MS, type ToolName } from "./timeout";
import {
  CACHE_TTL_SECONDS,
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

const analyzePagespeedInputSchema = z.object({
  url: z.url().describe("Public HTTP or HTTPS page URL"),
  strategy: z.enum(["mobile", "desktop"]).default("mobile"),
  apiKey: z.string().min(1).optional(),
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

export async function handleRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/auth/session") {
    return createSession(request, env);
  }

  const outcome = await authenticate(request, env);
  if (outcome === "unavailable") return bffErrorResponse("gate_unavailable");
  if (outcome === "denied") return bffErrorResponse("gate_unauthorized");

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

  // An unmatched `/api/*` path is a bad API call, not a page — return 404
  // rather than silently falling back to the SPA shell.
  if (url.pathname.startsWith("/api/")) {
    return new Response("Not found", { status: 404 });
  }

  // Every other GET request (SPA pages, hashed assets, unknown deep
  // links) falls through to the static SPA bundle. Safe only because
  // `authenticate()` above already ran unconditionally for this request;
  // the `assets` binding's `run_worker_first: true` (`bff/wrangler.jsonc`)
  // is what makes that ordering hold at the platform level too — without
  // it the Asset Worker would answer this request before this Worker
  // (and this gate check) ever ran.
  return env.ASSETS.fetch(request);
}
