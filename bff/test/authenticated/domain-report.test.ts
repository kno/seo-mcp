import { describe, expect, it } from "vitest";
import { classifyDomainReportGscError } from "../../src/authenticated/domain-report";

/**
 * Task 10.9/10.10 (threat row g): `analyze_domain`'s `gscError` rides an
 * otherwise-successful 200-OK payload, so it must be classified and
 * discarded HERE — the one authenticated tool where upstream failure text
 * never reaches `mcp-client.ts`'s `isError` classifier at all.
 */
describe("classifyDomainReportGscError", () => {
  it("passes a report through unchanged when gscError is absent", () => {
    const report = { url: "https://example.com", crawl: { crawled: 1 } };
    const result = classifyDomainReportGscError(report);
    expect(result).toEqual({ data: report, forceOpenTtl: false });
  });

  it("passes a report through unchanged when search succeeded instead", () => {
    const report = {
      url: "https://example.com",
      crawl: { crawled: 1 },
      search: {
        startDate: "2026-01-01",
        endDate: "2026-01-28",
        opportunities: [],
      },
    };
    const result = classifyDomainReportGscError(report);
    expect(result).toEqual({ data: report, forceOpenTtl: false });
  });

  it("classifies a not-configured gscError and discards the raw text", () => {
    const report = {
      url: "https://example.com",
      crawl: { crawled: 1 },
      gscError: "Google credentials are not configured",
    };
    const result = classifyDomainReportGscError(report);
    expect(result.forceOpenTtl).toBe(true);
    expect(result.data).toEqual({
      url: "https://example.com",
      crawl: { crawled: 1 },
      enrichmentError: { code: "upstream_source_not_configured" },
    });
    expect(JSON.stringify(result.data)).not.toContain("not configured");
  });

  it("classifies a credential-shaped gscError without echoing the decoy credential", () => {
    const DECOY = "Bearer decoy-token-xyz";
    const report = {
      url: "https://example.com",
      crawl: { crawled: 1 },
      gscError: `OAuth token exchange failed: invalid_grant ${DECOY}`,
    };
    const result = classifyDomainReportGscError(report);
    expect(result.data).toEqual({
      url: "https://example.com",
      crawl: { crawled: 1 },
      enrichmentError: { code: "upstream_credential_failure" },
    });
    expect(JSON.stringify(result.data)).not.toContain(DECOY);
    expect(JSON.stringify(result)).not.toContain(DECOY);
  });

  it("classifies a quota-shaped gscError as upstream_source_quota", () => {
    const report = {
      url: "https://example.com",
      crawl: { crawled: 1 },
      gscError:
        "Search Analytics API error: quota exceeded Bearer decoy-token-xyz",
    };
    const result = classifyDomainReportGscError(report);
    expect(result.data).toEqual({
      url: "https://example.com",
      crawl: { crawled: 1 },
      enrichmentError: { code: "upstream_source_quota" },
    });
  });

  it("falls back to tool_failed for an unrecognized gscError shape, still discarding the text", () => {
    const DECOY = "Bearer decoy-token-xyz";
    const report = {
      url: "https://example.com",
      crawl: { crawled: 1 },
      gscError: `Unexpected upstream failure ${DECOY}`,
    };
    const result = classifyDomainReportGscError(report);
    expect(result.data).toEqual({
      url: "https://example.com",
      crawl: { crawled: 1 },
      enrichmentError: { code: "tool_failed" },
    });
    expect(JSON.stringify(result.data)).not.toContain(DECOY);
  });
});
