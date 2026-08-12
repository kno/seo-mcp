import { describe, expect, it } from "vitest";
import {
  bffError,
  bffErrorResponse,
  ERROR_TABLE,
  redactSecrets,
  type BffErrorCode,
} from "../src/errors";

const ALL_CODES: BffErrorCode[] = [
  "gate_unauthorized",
  "gate_unavailable",
  "invalid_input",
  "upstream_unauthorized",
  "upstream_rate_limited",
  "upstream_unavailable",
  "upstream_forbidden",
  "upstream_protocol",
  "tool_failed",
  "result_invalid",
  "bff_timeout",
];

describe("BFF error code table", () => {
  it("maps every documented code to an HTTP status and a non-empty message", () => {
    for (const code of ALL_CODES) {
      const entry = ERROR_TABLE[code];
      expect(entry.status).toBeGreaterThanOrEqual(400);
      expect(entry.status).toBeLessThan(600);
      expect(entry.message.length).toBeGreaterThan(0);
    }
  });

  it("distinguishes gate rejection from any upstream failure code", () => {
    expect(ERROR_TABLE.gate_unauthorized.status).not.toBe(
      ERROR_TABLE.upstream_unauthorized.status,
    );
    expect("gate_unauthorized" as BffErrorCode).not.toBe(
      "upstream_unauthorized" as BffErrorCode,
    );
  });

  it("distinguishes different upstream failures from each other", () => {
    expect(ERROR_TABLE.upstream_unauthorized.status).not.toBe(
      ERROR_TABLE.upstream_unavailable.status,
    );
  });

  it("distinguishes a BFF timeout from upstream unavailability", () => {
    expect(ERROR_TABLE.bff_timeout.status).not.toBe(
      ERROR_TABLE.upstream_unavailable.status,
    );
  });

  it("builds a normalized error without retryAfter by default", () => {
    expect(bffError("gate_unauthorized")).toEqual({
      code: "gate_unauthorized",
      message: ERROR_TABLE.gate_unauthorized.message,
    });
  });

  it("builds a normalized error carrying retryAfter when provided", () => {
    expect(bffError("upstream_rate_limited", 42)).toEqual({
      code: "upstream_rate_limited",
      message: ERROR_TABLE.upstream_rate_limited.message,
      retryAfter: 42,
    });
  });

  it("builds a Response using the code's mapped HTTP status", async () => {
    const response = bffErrorResponse("bff_timeout");
    expect(response.status).toBe(504);
    const body = await response.json();
    expect(body).toEqual({
      error: { code: "bff_timeout", message: ERROR_TABLE.bff_timeout.message },
    });
  });

  it("includes retryAfter on the Response body when provided", async () => {
    const response = bffErrorResponse("upstream_rate_limited", 60);
    const body = (await response.json()) as { error: { retryAfter?: number } };
    expect(body.error.retryAfter).toBe(60);
  });
});

describe("redactSecrets", () => {
  it("redacts a Bearer token embedded in free text", () => {
    const text = "Upstream error: Authorization: Bearer abc123.def456 rejected";
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain("abc123.def456");
    expect(redacted).toContain("[redacted]");
  });

  it("redacts a raw www-authenticate header value", () => {
    const text = 'www-authenticate: Bearer realm="seo-mcp"';
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain('realm="seo-mcp"');
  });

  it("leaves text without credential material untouched", () => {
    const text = "tool crawl_page failed: fetch timed out";
    expect(redactSecrets(text)).toBe(text);
  });
});
