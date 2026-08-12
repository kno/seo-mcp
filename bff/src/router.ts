/**
 * BFF request router. The single most important property this module
 * upholds: `authenticate()` runs BEFORE any dispatch to the MCP client, for
 * every route — including unknown routes, which return 404 without ever
 * reaching `SEO_MCP`. `POST /auth/session` is the sole exception: it is
 * the login endpoint itself, so it cannot require a prior session.
 *
 * Each tool route validates its own inputs with a Zod schema mirroring
 * `src/server.ts`'s `inputSchema` for that tool exactly (same fields, same
 * bounds, same defaults) before any dispatch to `callTool`. Inputs arrive
 * as query string parameters on a `GET` request, coerced to the right
 * primitive type where needed (`limit`, `concurrency` arrive as strings).
 */

import * as z from "zod/v4";
import { authenticate, createSession } from "./gate";
import { bffErrorResponse } from "./errors";
import { callTool, type McpClientResult } from "./mcp-client";
import { TOOL_TIMEOUT_MS, type ToolName } from "./timeout";
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

function validateUpstreamResultsFlag(env: Env): boolean {
  return String(env.VALIDATE_UPSTREAM_RESULTS) !== "false";
}

function toolResponse<T>(result: McpClientResult<T>): Response {
  if (!result.ok) return bffErrorResponse(result.code, result.retryAfter);
  return Response.json({
    data: result.data,
    cacheStatus: "bypass",
    resultAge: 0,
  });
}

async function dispatch<TInput, TResult>(
  env: Env,
  toolName: ToolName,
  args: TInput,
  schema: z.ZodType<TResult>,
): Promise<Response> {
  const result = await callTool(
    toolName,
    args as Record<string, unknown>,
    schema,
    {
      seoMcp: env.SEO_MCP,
      mcpOrigin: env.MCP_ORIGIN,
      token: env.MCP_AUTH_TOKEN,
      timeoutMs: TOOL_TIMEOUT_MS[toolName],
      validateUpstreamResults: validateUpstreamResultsFlag(env),
    },
  );
  return toolResponse(result);
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

  if (request.method !== "GET") {
    return new Response("Not found", { status: 404 });
  }

  if (url.pathname === "/api/tools/health") {
    return dispatch(env, "health", {}, healthSchema);
  }

  if (url.pathname === "/api/tools/crawl_page") {
    const parsed = parseQuery(url, crawlPageInputSchema);
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    return dispatch(env, "crawl_page", parsed.data, pageAnalysisSchema);
  }

  if (url.pathname === "/api/tools/crawl_site") {
    const parsed = parseQuery(url, crawlSiteInputSchema);
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    return dispatch(env, "crawl_site", parsed.data, siteCrawlResultSchema);
  }

  if (url.pathname === "/api/tools/check_links") {
    const parsed = parseQuery(url, checkLinksInputSchema);
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    return dispatch(env, "check_links", parsed.data, linkCheckResultSchema);
  }

  if (url.pathname === "/api/tools/analyze_pagespeed") {
    const parsed = parseQuery(url, analyzePagespeedInputSchema);
    if (!parsed.ok) return bffErrorResponse("invalid_input");
    return dispatch(
      env,
      "analyze_pagespeed",
      parsed.data,
      pageSpeedResultSchema,
    );
  }

  return new Response("Not found", { status: 404 });
}
