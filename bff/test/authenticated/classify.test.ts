/**
 * Threat matrix row (d): an unclassifiable upstream failure renders
 * non-retryable, never a retry loop against a broken credential or an
 * exhausted quota. `classifyUpstreamFailure` returns ONLY a `BffErrorCode`
 * — the matched upstream text itself is discarded by construction (the
 * function signature has no way to leak it back to the caller).
 */
import { describe, expect, it } from "vitest";
import {
  classifyStorageFailure,
  classifyUpstreamFailure,
} from "../../src/authenticated/classify";

describe("classifyUpstreamFailure", () => {
  it("matches the exact not-configured constant", () => {
    expect(
      classifyUpstreamFailure("Google credentials are not configured"),
    ).toBe("upstream_source_not_configured");
  });

  it("does not match a near-miss variant of the not-configured text", () => {
    expect(
      classifyUpstreamFailure("Google credentials are NOT configured!"),
    ).not.toBe("upstream_source_not_configured");
  });

  it.each(["invalid_grant", "invalid_client", "unauthorized_client"])(
    "classifies an OAuth error containing %s as a credential failure",
    (marker) => {
      expect(
        classifyUpstreamFailure(`OAuth token exchange failed: ${marker}`),
      ).toBe("upstream_credential_failure");
    },
  );

  it.each(["quota", "rateLimitExceeded", "userRateLimitExceeded"])(
    "classifies an upstream message containing %s as a source quota failure",
    (marker) => {
      expect(
        classifyUpstreamFailure(
          `Search Analytics API error: ${marker} exceeded`,
        ),
      ).toBe("upstream_source_quota");
    },
  );

  it("classifies an unmatched message as the non-retryable safe default", () => {
    expect(classifyUpstreamFailure("Something went wrong upstream")).toBe(
      "tool_failed",
    );
  });

  it("classifies an empty string as the non-retryable safe default", () => {
    expect(classifyUpstreamFailure("")).toBe("tool_failed");
  });

  it("matches the exact Google Ads developer-token not-configured constant (task 8.6)", () => {
    expect(
      classifyUpstreamFailure("Google Ads developer token is not configured"),
    ).toBe("upstream_source_not_configured");
  });

  it("matches the exact Google Ads customer-ID not-configured constant — the second real 'operator forgot to configure this' guard in src/google/ads.ts", () => {
    expect(
      classifyUpstreamFailure("Google Ads customer ID is not configured"),
    ).toBe("upstream_source_not_configured");
  });

  it("does not match a near-miss variant of the Ads not-configured text", () => {
    expect(
      classifyUpstreamFailure("Google Ads developer token is NOT configured!"),
    ).not.toBe("upstream_source_not_configured");
  });

  it("discards the matched upstream text — only the class is observable", () => {
    const decoy = "invalid_grant DECOY_REFRESH_TOKEN_xyz789";
    const result = classifyUpstreamFailure(decoy);
    expect(result).toBe("upstream_credential_failure");
    expect(JSON.stringify(result)).not.toContain("DECOY_REFRESH_TOKEN_xyz789");
  });
});

/**
 * `gsc-insight-views`' D1-backed snapshot tools (task 6.7): the two texts
 * `classifyStorageFailure` matches are OUR OWN constants (`src/server.ts`),
 * never Google-shaped, so this is a separate classifier from
 * `classifyUpstreamFailure` rather than a shared match table.
 */
describe("classifyStorageFailure", () => {
  it("classifies the exact D1-not-configured constant", () => {
    expect(classifyStorageFailure("D1 storage is not configured")).toBe(
      "upstream_storage_not_configured",
    );
  });

  it("classifies the exact fewer-than-two-snapshots constant", () => {
    expect(
      classifyStorageFailure("Need at least two snapshots to compare"),
    ).toBe("insufficient_snapshots");
  });

  // `history-comparison-view` (PR11): `compare_crawls` throws a DIFFERENT
  // insufficient-snapshots text than `compare_search_console` — both must
  // classify identically, distinct from `tool_failed`.
  it("classifies compare_crawls' own fewer-than-two-snapshots text identically", () => {
    expect(
      classifyStorageFailure("Need at least two crawl snapshots to compare"),
    ).toBe("insufficient_snapshots");
  });

  it("does not classify a near-miss variant of either constant", () => {
    expect(classifyStorageFailure("D1 storage is NOT configured!")).not.toBe(
      "upstream_storage_not_configured",
    );
    expect(
      classifyStorageFailure("Need at least 2 snapshots to compare"),
    ).not.toBe("insufficient_snapshots");
  });

  it("classifies an unmatched message as the non-retryable safe default, never one of the two distinct codes", () => {
    expect(classifyStorageFailure("Something went wrong")).toBe("tool_failed");
  });

  it("never returns a Google-classifier code for either D1 text", () => {
    const notConfigured = classifyStorageFailure(
      "D1 storage is not configured",
    );
    const insufficient = classifyStorageFailure(
      "Need at least two snapshots to compare",
    );
    expect(notConfigured).not.toBe("upstream_source_not_configured");
    expect(insufficient).not.toBe("upstream_source_quota");
  });
});
