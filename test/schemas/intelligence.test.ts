import { describe, expect, it } from "vitest";
import {
  opportunitySchema,
  cannibalGroupSchema,
  cannibalPageSchema,
  findKeywordCannibalizationResultSchema,
  findSeoOpportunitiesResultSchema,
  pageKeywordsSchema,
  pageQuerySchema,
  mapKeywordsToPagesResultSchema,
  contentGapSchema,
  findContentGapsResultSchema,
} from "../../src/schemas/intelligence";

function opportunity(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    type: "low_ctr",
    query: "seo tool",
    page: "https://example.com/page",
    impressions: 340,
    currentPosition: 4.2,
    impact: 340,
    effort: 1,
    priorityScore: 340,
    recommendation:
      "Rewrite title/meta description to improve click-through (good rank, low CTR).",
    ...overrides,
  };
}

function cannibalPage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    page: "https://example.com/a",
    clicks: 12,
    impressions: 340,
    position: 4.2,
    ...overrides,
  };
}

describe("opportunitySchema", () => {
  it("accepts the three real OpportunityType values", () => {
    for (const type of ["low_ctr", "striking_distance", "cannibalization"]) {
      expect(opportunitySchema.parse(opportunity({ type }))).toEqual(
        opportunity({ type }),
      );
    }
  });

  it("rejects a fourth, invented type value", () => {
    expect(() =>
      opportunitySchema.parse(opportunity({ type: "internal_linking" })),
    ).toThrow();
  });

  it("accepts nullable page and currentPosition (cannibalization opportunities)", () => {
    const fixture = opportunity({
      type: "cannibalization",
      page: null,
      currentPosition: null,
    });
    expect(opportunitySchema.parse(fixture)).toEqual(fixture);
  });

  it("accepts unbounded impact/effort/priorityScore, incl. values outside 0-100", () => {
    const fixture = opportunity({
      impact: 987654,
      effort: 3,
      priorityScore: 987654 / 3,
    });
    expect(opportunitySchema.parse(fixture)).toEqual(fixture);
  });
});

describe("cannibalGroupSchema / cannibalPageSchema", () => {
  it("accepts a real CannibalGroup fixture, incl. pages.length < pageCount", () => {
    const fixture = {
      query: "seo tool",
      pageCount: 3,
      totalImpressions: 900,
      totalClicks: 40,
      pages: [cannibalPage(), cannibalPage({ page: "https://example.com/b" })],
    };
    expect(cannibalGroupSchema.parse(fixture)).toEqual(fixture);
  });

  it("accepts a real CannibalPage fixture", () => {
    const fixture = cannibalPage();
    expect(cannibalPageSchema.parse(fixture)).toEqual(fixture);
  });
});

describe("findKeywordCannibalizationResultSchema", () => {
  it("accepts the real wrapper shape { siteUrl, startDate, endDate, count, groups }", () => {
    const fixture = {
      siteUrl: "sc-domain:example.com",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      count: 1,
      groups: [
        {
          query: "seo tool",
          pageCount: 2,
          totalImpressions: 900,
          totalClicks: 40,
          pages: [cannibalPage()],
        },
      ],
    };
    expect(findKeywordCannibalizationResultSchema.parse(fixture)).toEqual(
      fixture,
    );
  });

  it("has no defined `criteria` field — an extraneous criteria is stripped, not preserved", () => {
    const fixture = {
      siteUrl: "sc-domain:example.com",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      count: 0,
      groups: [],
      criteria: { minImpressions: 10, limit: 50 },
    };
    const parsed = findKeywordCannibalizationResultSchema.parse(fixture);
    expect(parsed).not.toHaveProperty("criteria");
  });
});

describe("findSeoOpportunitiesResultSchema", () => {
  it("accepts the real wrapper shape { siteUrl, startDate, endDate, count, opportunities }", () => {
    const fixture = {
      siteUrl: "sc-domain:example.com",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      count: 1,
      opportunities: [opportunity()],
    };
    expect(findSeoOpportunitiesResultSchema.parse(fixture)).toEqual(fixture);
  });

  it("has no defined `criteria` field", () => {
    const fixture = {
      siteUrl: "sc-domain:example.com",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      count: 0,
      opportunities: [],
      criteria: { limit: 10 },
    };
    const parsed = findSeoOpportunitiesResultSchema.parse(fixture);
    expect(parsed).not.toHaveProperty("criteria");
  });
});

describe("pageKeywordsSchema / pageQuerySchema", () => {
  it("accepts a real PageKeywords fixture", () => {
    const query = {
      query: "seo tool",
      clicks: 12,
      impressions: 340,
      position: 4.2,
    };
    expect(pageQuerySchema.parse(query)).toEqual(query);

    const fixture = {
      page: "https://example.com/page",
      queryCount: 1,
      totalClicks: 12,
      totalImpressions: 340,
      topQueries: [query],
    };
    expect(pageKeywordsSchema.parse(fixture)).toEqual(fixture);
  });
});

describe("mapKeywordsToPagesResultSchema", () => {
  it("accepts the real wrapper shape { siteUrl, startDate, endDate, count, pages }", () => {
    const fixture = {
      siteUrl: "sc-domain:example.com",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      count: 1,
      pages: [
        {
          page: "https://example.com/page",
          queryCount: 1,
          totalClicks: 12,
          totalImpressions: 340,
          topQueries: [
            {
              query: "seo tool",
              clicks: 12,
              impressions: 340,
              position: 4.2,
            },
          ],
        },
      ],
    };
    expect(mapKeywordsToPagesResultSchema.parse(fixture)).toEqual(fixture);
  });

  it("has no defined `criteria` field", () => {
    const fixture = {
      siteUrl: "sc-domain:example.com",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      count: 0,
      pages: [],
      criteria: { limit: 100, topQueriesPerPage: 10 },
    };
    const parsed = mapKeywordsToPagesResultSchema.parse(fixture);
    expect(parsed).not.toHaveProperty("criteria");
  });
});

describe("contentGapSchema / findContentGapsResultSchema", () => {
  it("accepts a real ContentGap fixture", () => {
    const fixture = {
      query: "seo tool",
      page: "https://example.com/page",
      impressions: 340,
      clicks: 2,
      position: 24.1,
    };
    expect(contentGapSchema.parse(fixture)).toEqual(fixture);
  });

  it("accepts the real wrapper shape { siteUrl, startDate, endDate, count, gaps }", () => {
    const fixture = {
      siteUrl: "sc-domain:example.com",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      count: 1,
      gaps: [
        {
          query: "seo tool",
          page: "https://example.com/page",
          impressions: 340,
          clicks: 2,
          position: 24.1,
        },
      ],
    };
    expect(findContentGapsResultSchema.parse(fixture)).toEqual(fixture);
  });

  it("has no defined `criteria` field", () => {
    const fixture = {
      siteUrl: "sc-domain:example.com",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      count: 0,
      gaps: [],
      criteria: { minPosition: 21, minImpressions: 10, limit: 100 },
    };
    const parsed = findContentGapsResultSchema.parse(fixture);
    expect(parsed).not.toHaveProperty("criteria");
  });
});
