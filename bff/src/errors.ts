/**
 * Normalized error envelope for every failure the BFF surfaces to a
 * caller — dashboard gate rejection, upstream transport/tool failure, and
 * BFF-internal failure (input validation, output-schema mismatch, timeout).
 *
 * The full 11-code table mirrors `design.md`'s Interfaces/Contracts section
 * so the type is extensible without a breaking change. Phase 2 only wires
 * producers for `gate_unauthorized`, `gate_unavailable`, and a generic
 * `upstream_unavailable` (the `health` route's upstream-failure fallback);
 * the remaining codes are data-only until their producing call sites land
 * in later phases (routes, mcp-client, cache, timeout).
 */

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
  | "bff_timeout"
  | "upstream_source_not_configured"
  | "upstream_credential_failure"
  | "upstream_source_quota";

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

interface ErrorTableEntry {
  status: number;
  message: string;
}

export const ERROR_TABLE: Record<BffErrorCode, ErrorTableEntry> = {
  gate_unauthorized: {
    status: 401,
    message: "Authentication is required to access this resource.",
  },
  gate_unavailable: {
    status: 503,
    message: "The access gate is temporarily unavailable.",
  },
  invalid_input: {
    status: 400,
    message: "The request input failed validation.",
  },
  upstream_unauthorized: {
    status: 502,
    message: "The upstream service rejected the BFF's credentials.",
  },
  upstream_rate_limited: {
    status: 429,
    message: "The shared upstream rate limit has been exceeded.",
  },
  upstream_unavailable: {
    status: 503,
    message: "The upstream service is temporarily unavailable.",
  },
  upstream_forbidden: {
    status: 502,
    message: "The upstream service rejected the request.",
  },
  upstream_protocol: {
    status: 502,
    message: "The upstream service returned an unexpected response.",
  },
  tool_failed: {
    status: 422,
    message: "The requested tool call failed.",
  },
  result_invalid: {
    status: 502,
    message: "The upstream result failed validation.",
  },
  bff_timeout: {
    status: 504,
    message: "Timed out waiting for the upstream result.",
  },
  // The following three codes are specific to authenticated/analytical
  // sources (`authenticated-source-contract`): classified from upstream
  // Google failure text by `bff/src/authenticated/classify.ts`, which
  // discards the original text before it ever reaches this table.
  upstream_source_not_configured: {
    status: 503,
    message:
      "The Google credentials required for this data source are not configured.",
  },
  upstream_credential_failure: {
    status: 502,
    message:
      "The upstream Google credential was rejected. This requires operator action — retrying will not help.",
  },
  upstream_source_quota: {
    status: 429,
    message:
      "The upstream Google service's own quota has been exhausted for this window.",
  },
};

export function bffError(code: BffErrorCode, retryAfter?: number): BffError {
  const entry = ERROR_TABLE[code];
  return retryAfter === undefined
    ? { code, message: entry.message }
    : { code, message: entry.message, retryAfter };
}

export function bffErrorResponse(
  code: BffErrorCode,
  retryAfter?: number,
): Response {
  const entry = ERROR_TABLE[code];
  return Response.json(
    { error: bffError(code, retryAfter) },
    { status: entry.status },
  );
}

/**
 * Redacts `Bearer <credential>` sequences (the only shape the shared MCP
 * token or a `www-authenticate` challenge value ever takes in text this
 * module handles) before any upstream-derived text reaches a caller.
 */
const BEARER_PATTERN = /Bearer\s+\S+/gi;

export function redactSecrets(text: string): string {
  return text.replace(BEARER_PATTERN, "Bearer [redacted]");
}
