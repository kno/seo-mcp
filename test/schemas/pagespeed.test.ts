import { describe, expect, it } from "vitest";
import { pageSpeedResultSchema } from "../../src/schemas/pagespeed";

describe("pageSpeedResultSchema", () => {
  it("accepts a fixture with every optional field populated", () => {
    const fixture = {
      url: "https://example.com/",
      strategy: "mobile",
      fetchedAt: "2026-08-12T00:00:00.000Z",
      performanceScore: 92,
      accessibilityScore: 88,
      bestPracticesScore: 100,
      seoScore: 95,
      labMetrics: {
        firstContentfulPaintMs: 800,
        largestContentfulPaintMs: 1200,
        totalBlockingTimeMs: 50,
        cumulativeLayoutShift: 0.01,
        speedIndexMs: 1500,
      },
      fieldMetrics: {
        overallCategory: "FAST",
        interactionToNextPaintMs: 100,
      },
      opportunities: [
        {
          id: "render-blocking",
          title: "Eliminate render-blocking resources",
          savingsMs: 300,
        },
      ],
    };
    expect(pageSpeedResultSchema.parse(fixture)).toEqual(fixture);
  });

  it("accepts a fixture where a failed sub-check leaves optional fields absent", () => {
    const fixture = {
      url: "https://example.com/",
      strategy: "desktop",
      labMetrics: {},
      opportunities: [],
    };
    const parsed = pageSpeedResultSchema.parse(fixture);
    expect(parsed.performanceScore).toBeUndefined();
    expect(parsed.fieldMetrics).toBeUndefined();
    expect(parsed.opportunities).toEqual([]);
  });

  it("rejects an unknown strategy value", () => {
    const fixture = {
      url: "https://example.com/",
      strategy: "tablet",
      labMetrics: {},
      opportunities: [],
    };
    expect(() => pageSpeedResultSchema.parse(fixture)).toThrow();
  });
});
