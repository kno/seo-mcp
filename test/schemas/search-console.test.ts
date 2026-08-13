import { describe, expect, it } from "vitest";
import { gscQueryResultSchema } from "../../src/schemas/search-console";
import { LIMITS } from "../../src/config";

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

describe("gscQueryResultSchema", () => {
  it("accepts a real fixture shaped like searchConsoleQuery's result", () => {
    const fixture = {
      siteUrl: "sc-domain:example.com",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      dimensions: ["query", "page"],
      rowCount: 2,
      rows: [
        row(),
        row({
          keys: ["mcp server"],
          clicks: 3,
          impressions: 90,
          ctr: 0.033,
          position: 7.5,
        }),
      ],
    };
    expect(gscQueryResultSchema.parse(fixture)).toEqual(fixture);
  });

  it("rejects a payload with more rows than LIMITS.maxGscRows", () => {
    const fixture = {
      siteUrl: "sc-domain:example.com",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      dimensions: ["query"],
      rowCount: LIMITS.maxGscRows + 1,
      rows: Array.from({ length: LIMITS.maxGscRows + 1 }, () => row()),
    };
    expect(() => gscQueryResultSchema.parse(fixture)).toThrow();
  });

  it("rejects an unknown dimension", () => {
    const fixture = {
      siteUrl: "sc-domain:example.com",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      dimensions: ["query", "not-a-real-dimension"],
      rowCount: 0,
      rows: [],
    };
    expect(() => gscQueryResultSchema.parse(fixture)).toThrow();
  });

  it("places no upper bound on rowCount", () => {
    const fixture = {
      siteUrl: "sc-domain:example.com",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      dimensions: ["query"],
      rowCount: 999_999,
      rows: [],
    };
    expect(gscQueryResultSchema.parse(fixture).rowCount).toBe(999_999);
  });
});
