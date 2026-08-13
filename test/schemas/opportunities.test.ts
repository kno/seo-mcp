import { describe, expect, it } from "vitest";
import { opportunityResultSchema } from "../../src/schemas/opportunities";

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    keys: ["seo tool", "https://example.com/page"],
    clicks: 12,
    impressions: 340,
    ctr: 0.035,
    position: 4.2,
    ...overrides,
  };
}

describe("opportunityResultSchema", () => {
  it("accepts a real fixture shaped like OpportunityResult, incl. criteria: Record<string, number>", () => {
    const fixture = {
      siteUrl: "sc-domain:example.com",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      dimensions: ["query", "page"],
      criteria: {
        minPosition: 11,
        maxPosition: 20,
        minImpressions: 1,
        limit: 25,
      },
      rowCount: 1,
      rows: [row()],
    };
    expect(opportunityResultSchema.parse(fixture)).toEqual(fixture);
  });

  it("accepts the low-CTR criteria shape (different keys, still Record<string, number>)", () => {
    const fixture = {
      siteUrl: "sc-domain:example.com",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      dimensions: ["query", "page"],
      criteria: {
        maxPosition: 10,
        minImpressions: 10,
        maxCtr: 0.02,
        limit: 25,
      },
      rowCount: 0,
      rows: [],
    };
    expect(opportunityResultSchema.parse(fixture)).toEqual(fixture);
  });

  it("rejects a payload whose rows.length exceeds its own criteria.limit", () => {
    const fixture = {
      siteUrl: "sc-domain:example.com",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      dimensions: ["query", "page"],
      criteria: {
        minPosition: 11,
        maxPosition: 20,
        minImpressions: 1,
        limit: 1,
      },
      rowCount: 2,
      rows: [row(), row({ keys: ["other query"] })],
    };
    expect(() => opportunityResultSchema.parse(fixture)).toThrow();
  });

  it("accepts a payload with no criteria.limit at all (bound not applicable)", () => {
    const fixture = {
      siteUrl: "sc-domain:example.com",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      dimensions: ["query"],
      criteria: { minImpressions: 1 },
      rowCount: 3,
      rows: [row(), row(), row()],
    };
    expect(opportunityResultSchema.parse(fixture)).toEqual(fixture);
  });
});
