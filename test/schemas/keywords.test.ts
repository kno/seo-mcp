import { describe, expect, it } from "vitest";
import {
  keywordMetricSchema,
  keywordMetricsResultSchema,
  clusterResultSchema,
} from "../../src/schemas/keywords";

function metric(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    keyword: "seo tool",
    avgMonthlySearches: 1200,
    competition: "MEDIUM",
    competitionIndex: 45,
    lowTopOfPageBid: 0.5,
    highTopOfPageBid: 2.25,
    ...overrides,
  };
}

describe("keywordMetricSchema", () => {
  it("accepts a real KeywordMetric fixture with bare-number bid fields", () => {
    expect(keywordMetricSchema.parse(metric())).toEqual(metric());
  });

  it("has no currency field in the schema (no accidental future addition)", () => {
    expect(keywordMetricSchema.shape).not.toHaveProperty("currency");
    expect(keywordMetricSchema.shape).not.toHaveProperty("currencyCode");
  });

  it("rejects a payload where lowTopOfPageBid is not a bare number", () => {
    expect(() =>
      keywordMetricSchema.parse(
        metric({ lowTopOfPageBid: { amount: 0.5, currency: "USD" } }),
      ),
    ).toThrow();
  });
});

describe("keywordMetricsResultSchema", () => {
  it("accepts the shape shared by get_keyword_metrics and discover_keywords", () => {
    const fixture = {
      customerId: "1234567890",
      count: 2,
      keywords: [metric(), metric({ keyword: "seo audit" })],
    };
    expect(keywordMetricsResultSchema.parse(fixture)).toEqual(fixture);
  });

  it("accepts a zero-keyword result", () => {
    const fixture = { customerId: "1234567890", count: 0, keywords: [] };
    expect(keywordMetricsResultSchema.parse(fixture)).toEqual(fixture);
  });
});

describe("clusterResultSchema", () => {
  it("accepts a real ClusterResult fixture: clusters[{ label, keywords }], root keywords[{ keyword, intent, tokens }]", () => {
    const fixture = {
      count: 2,
      intents: { transactional: 1, informational: 1 },
      clusters: [{ label: "tool", keywords: ["seo tool", "seo audit tool"] }],
      keywords: [
        {
          keyword: "seo tool",
          intent: "informational",
          tokens: ["seo", "tool"],
        },
        {
          keyword: "comprar seo tool",
          intent: "transactional",
          tokens: ["comprar", "seo", "tool"],
        },
      ],
    };
    expect(clusterResultSchema.parse(fixture)).toEqual(fixture);
  });

  it("rejects a cluster whose keywords are nested objects rather than strings", () => {
    const fixture = {
      count: 1,
      intents: { informational: 1 },
      clusters: [{ label: "tool", keywords: [{ keyword: "seo tool" }] }],
      keywords: [
        {
          keyword: "seo tool",
          intent: "informational",
          tokens: ["seo", "tool"],
        },
      ],
    };
    expect(() => clusterResultSchema.parse(fixture)).toThrow();
  });

  it("rejects an intent value outside the four known intents", () => {
    const fixture = {
      count: 1,
      intents: { informational: 1 },
      clusters: [{ label: "tool", keywords: ["seo tool"] }],
      keywords: [
        {
          keyword: "seo tool",
          intent: "navigational",
          tokens: ["seo", "tool"],
        },
      ],
    };
    expect(() => clusterResultSchema.parse(fixture)).toThrow();
  });

  it("accepts an empty cluster result", () => {
    const fixture = { count: 0, intents: {}, clusters: [], keywords: [] };
    expect(clusterResultSchema.parse(fixture)).toEqual(fixture);
  });
});
