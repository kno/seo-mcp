/**
 * MCP client — full implementation for all five in-scope tools.
 *
 * `callTool` sends a self-contained JSON-RPC `tools/call` request to
 * `seo-mcp` over the `SEO_MCP` service binding, injecting the shared
 * bearer token only on this fetch (never anywhere else, and never
 * present in the returned result). It re-validates the returned
 * `structuredContent` against the SAME Zod schema published in
 * `src/schemas/*` (Phase 1's artifact) — no second, parallel schema is
 * ever written here. Re-validation is gated by `validateUpstreamResults`
 * (the `VALIDATE_UPSTREAM_RESULTS` env var, default on) per design's
 * CPU-cost mitigation for large payloads on the Free plan.
 *
 * Every failure this module can observe is mapped to a `BffErrorCode`
 * directly, so callers (the router) never have to re-derive a code from
 * an HTTP status themselves:
 * - Transport-level non-2xx statuses: 401 -> upstream_unauthorized,
 *   429 -> upstream_rate_limited (retryAfter from the `retry-after`
 *   header), 503 -> upstream_unavailable, 403 -> upstream_forbidden,
 *   any other non-2xx -> upstream_protocol.
 * - Non-JSON or JSON-RPC-shaped-wrong replies (missing both `result` and
 *   `error`) -> upstream_protocol.
 * - A tool result with `isError: true` (the shape `src/server.ts`'s
 *   `errorResult` produces, including the `check_links` platform
 *   subrequest-ceiling failure) -> tool_failed. This is a normalized
 *   error, never reported as an empty success.
 * - `structuredContent` failing re-validation against the shared schema
 *   -> result_invalid.
 * - The `AbortSignal.timeout(TOOL_TIMEOUT_MS[tool])` race aborting before
 *   the upstream call completes -> bff_timeout, distinct from
 *   upstream_unavailable (upstream 503).
 */

import type * as z from "zod/v4";
import type { BffErrorCode } from "./errors";
import { redactSecrets } from "./errors";
import { withTimeout, type ToolName } from "./timeout";

export interface McpClientDependencies {
  seoMcp: Fetcher;
  mcpOrigin: string;
  token: string;
  timeoutMs: number;
  validateUpstreamResults?: boolean;
}

export type McpClientResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: BffErrorCode; retryAfter?: number };

interface JsonRpcSuccessResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

interface JsonRpcReply {
  jsonrpc?: string;
  id?: string;
  result?: JsonRpcSuccessResult;
  error?: { code: number; message: string };
}

function statusToErrorCode(status: number): BffErrorCode {
  switch (status) {
    case 401:
      return "upstream_unauthorized";
    case 429:
      return "upstream_rate_limited";
    case 503:
      return "upstream_unavailable";
    case 403:
      return "upstream_forbidden";
    default:
      return "upstream_protocol";
  }
}

function isJsonRpcReply(value: unknown): value is JsonRpcReply {
  return typeof value === "object" && value !== null;
}

/**
 * Sends a single JSON-RPC `tools/call` request over `dependencies.seoMcp`,
 * validates and normalizes the reply, and returns a typed result — never
 * throwing on an upstream failure.
 */
export async function callTool<T>(
  toolName: ToolName,
  args: Record<string, unknown>,
  schema: z.ZodType<T>,
  dependencies: McpClientDependencies,
): Promise<McpClientResult<T>> {
  const timeoutOutcome = await withTimeout(
    (signal) =>
      dependencies.seoMcp.fetch(
        new Request(`${dependencies.mcpOrigin}/mcp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            authorization: `Bearer ${dependencies.token}`,
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: crypto.randomUUID(),
            method: "tools/call",
            params: { name: toolName, arguments: args },
          }),
          signal,
        }),
      ),
    dependencies.timeoutMs,
  );

  if (!timeoutOutcome.ok) return { ok: false, code: "bff_timeout" };
  const response = timeoutOutcome.data;

  if (!response.ok) {
    const retryAfterHeader = response.headers.get("retry-after");
    const code = statusToErrorCode(response.status);
    return code === "upstream_rate_limited"
      ? {
          ok: false,
          code,
          retryAfter: retryAfterHeader ? Number(retryAfterHeader) : 60,
        }
      : { ok: false, code };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, code: "upstream_protocol" };
  }

  if (!isJsonRpcReply(payload) || (!payload.result && !payload.error)) {
    return { ok: false, code: "upstream_protocol" };
  }
  if (payload.error) {
    return { ok: false, code: "upstream_protocol" };
  }

  const result = payload.result as JsonRpcSuccessResult;
  if (result.isError) {
    return { ok: false, code: "tool_failed" };
  }

  const structuredContent = result.structuredContent;
  if (dependencies.validateUpstreamResults === false) {
    return { ok: true, data: structuredContent as T };
  }

  const parsed = schema.safeParse(structuredContent);
  if (!parsed.success) return { ok: false, code: "result_invalid" };
  return { ok: true, data: parsed.data };
}

// Re-exported so `redactSecrets` stays the single source of truth for
// scrubbing `Bearer` sequences from any upstream-derived text this module
// might ever need to surface (e.g. a future tool_failed message).
export { redactSecrets };
