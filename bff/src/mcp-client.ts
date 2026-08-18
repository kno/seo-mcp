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
 *   error, never reported as an empty success. An authenticated tool's
 *   caller may supply `dependencies.classifyFailureText` (see
 *   `bff/src/authenticated/classify.ts`) to further classify this text
 *   into `upstream_source_not_configured` / `upstream_credential_failure`
 *   / `upstream_source_quota` before it is discarded — the raw upstream
 *   text is NEVER retained past this call, classified or not.
 * - `structuredContent` failing re-validation against the shared schema
 *   -> result_invalid.
 * - The `AbortSignal.timeout(TOOL_TIMEOUT_MS[tool])` race aborting before
 *   the upstream call completes -> bff_timeout, distinct from
 *   upstream_unavailable (upstream 503).
 *
 * Every upstream call — regardless of outcome — is recorded via
 * `usage.ts`'s `recordUpstreamCall()` (the BFF's own observed call volume,
 * see `bff/src/usage.ts`) and logged as one structured `bff.upstream` line
 * (`{"event":"bff.upstream","tool","keyHash","status"}`). This is NOT the
 * Durable Object escalation decision itself — that DO is explicitly
 * deferred by `design.md` — it is only the log line a future DO consumer
 * would read to compute the 1% 429s / 5% duplicate-key-per-10s thresholds
 * from the log stream. `keyHash` is `dependencies.keyHash`, the SAME
 * content-hash `cache.ts#cacheKey()` value the router already computed for
 * this call — never a hash derived independently here.
 */

import type * as z from "zod/v4";
import type { BffErrorCode } from "./errors";
import { redactSecrets } from "./errors";
import { withTimeout, type ToolName } from "./timeout";
import { recordUpstreamCall } from "./usage";

export interface McpClientDependencies {
  seoMcp: Fetcher;
  mcpOrigin: string;
  token: string;
  timeoutMs: number;
  validateUpstreamResults?: boolean;
  /**
   * The content-hash cache key for this call (`cache.ts#cacheKey()`'s
   * return value), reused verbatim as the structured log line's
   * `keyHash` — never independently re-derived here.
   */
  keyHash?: string;
  /**
   * Authenticated-tool only. When provided, an `isError: true` result's
   * text is passed through this function and the RETURNED CODE is used
   * instead of the blind `tool_failed` default — the matched text itself
   * is discarded immediately after, never stored, logged, or returned.
   * Absent for every non-authenticated tool, which keeps their existing
   * `tool_failed` mapping unchanged.
   */
  classifyFailureText?: (text: string) => BffErrorCode;
  /**
   * Threat Matrix row g: the currently-selected site's URL, carried as the
   * `x-seo-active-site` transport header rather than a tool argument — see
   * `router.ts#dispatchAuthenticated`'s doc comment. Omitted entirely
   * (never an empty header) when absent or empty.
   */
  activeSiteUrl?: string;
}

/** Emits one structured `bff.upstream` log line per upstream call — the
 * shape a future Durable Object escalation consumer would read from the
 * log stream to compute the 429/duplicate-key thresholds. `status` is
 * `"ok"` on success, otherwise the `BffErrorCode` the call resolved to. */
function logUpstreamEvent(
  toolName: ToolName,
  keyHash: string | undefined,
  status: "ok" | BffErrorCode,
): void {
  console.log(
    JSON.stringify({
      event: "bff.upstream",
      tool: toolName,
      keyHash,
      status,
    }),
  );
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
 * The real `seo-mcp` SDK's legacy stateless transport (a one-shot
 * `tools/call` with no prior `initialize` handshake — exactly what this
 * client sends) always responds over SSE, regardless of the `Accept`
 * header: only the "modern", session-based era path respects
 * `createMcpHandler`'s `responseMode: "json"` option. For a single-shot
 * call there is exactly one `event: message` block; its `data:` line(s)
 * carry the JSON-RPC reply this function extracts and parses.
 */
function parseSseJsonRpc(text: string): unknown {
  const dataLines = text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());
  if (dataLines.length === 0) {
    throw new Error("SSE body contained no data: line");
  }
  return JSON.parse(dataLines.join("\n"));
}

/**
 * Sends a single JSON-RPC `tools/call` request over `dependencies.seoMcp`,
 * validates and normalizes the reply, and returns a typed result — never
 * throwing on an upstream failure. Every call is counted in `usage.ts`'s
 * accounting and logged as one structured `bff.upstream` line, regardless
 * of outcome (see this module's doc comment).
 */
export async function callTool<T>(
  toolName: ToolName,
  args: Record<string, unknown>,
  schema: z.ZodType<T>,
  dependencies: McpClientDependencies,
): Promise<McpClientResult<T>> {
  recordUpstreamCall();
  const result = await performCall(toolName, args, schema, dependencies);
  logUpstreamEvent(
    toolName,
    dependencies.keyHash,
    result.ok ? "ok" : result.code,
  );
  return result;
}

async function performCall<T>(
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
            accept: "application/json, text/event-stream",
            authorization: `Bearer ${dependencies.token}`,
            ...(dependencies.activeSiteUrl
              ? { "x-seo-active-site": dependencies.activeSiteUrl }
              : {}),
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
    payload = response.headers
      .get("content-type")
      ?.includes("text/event-stream")
      ? parseSseJsonRpc(await response.text())
      : await response.json();
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
    if (dependencies.classifyFailureText) {
      // The raw text lives only in this local variable, for the duration
      // of this one function call, and is never assigned anywhere else —
      // the classifier returns a code, discarding the text by construction.
      const text = result.content?.[0]?.text ?? "";
      return { ok: false, code: dependencies.classifyFailureText(text) };
    }
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
