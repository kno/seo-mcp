import { describe, expect, it } from "vitest";
import { domainReportSchema } from "../../src/schemas/domain-report";
import { siteCrawlResultSchema } from "../../src/schemas/site";

function crawlPortion() {
  return {
    sitemapFound: true,
    crawled: 8,
    failed: 0,
    issueCounts: { missing_h1: 1 },
    summary: {
      pagesAnalyzed: 8,
      duplicateTitles: [],
      duplicateDescriptions: [],
      missingH1: { count: 1, sample: ["https://example.com/a"] },
      multipleH1: { count: 0, sample: [] },
      thinContent: { count: 0, sample: [] },
      nonIndexable: { count: 0, sample: [] },
      imagesMissingAlt: { pages: 0, images: 0 },
    },
    crawlPolicy: {
      robotsUrl: "https://example.com/robots.txt",
      robotsFound: true,
      userAgent: "seo-mcp",
      sitemapsDeclared: ["https://example.com/sitemap.xml"],
      disallowedSkipped: { count: 0, sample: [] },
    },
    linkGraph: {
      crawledPages: 8,
      orphanPages: { count: 0, sample: [] },
      topLinkedPages: [{ url: "https://example.com/", inbound: 5 }],
    },
  };
}

function opportunity() {
  return {
    type: "low_ctr" as const,
    query: "seo tool",
    page: "https://example.com/page",
    impressions: 340,
    currentPosition: 4.2,
    impact: 340,
    effort: 1,
    priorityScore: 340,
    recommendation:
      "Rewrite title/meta description to improve click-through (good rank, low CTR).",
  };
}

describe("domainReportSchema", () => {
  it("accepts a report with neither search nor gscError (not requested)", () => {
    const fixture = { url: "https://example.com", crawl: crawlPortion() };
    expect(domainReportSchema.parse(fixture)).toEqual(fixture);
  });

  it("accepts a report with search present (GSC enrichment succeeded)", () => {
    const fixture = {
      url: "https://example.com",
      crawl: crawlPortion(),
      search: {
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        opportunities: [opportunity()],
      },
    };
    expect(domainReportSchema.parse(fixture)).toEqual(fixture);
  });

  it("accepts a report with gscError present (GSC enrichment failed)", () => {
    const fixture = {
      url: "https://example.com",
      crawl: crawlPortion(),
      gscError: "Google credentials are not configured",
    };
    expect(domainReportSchema.parse(fixture)).toEqual(fixture);
  });

  it("rejects a report with BOTH search and gscError present", () => {
    const fixture = {
      url: "https://example.com",
      crawl: crawlPortion(),
      search: {
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        opportunities: [],
      },
      gscError: "Google credentials are not configured",
    };
    expect(() => domainReportSchema.parse(fixture)).toThrow();
  });

  it("reuses siteCrawlResultSchema's summary/crawlPolicy/linkGraph sub-schemas rather than redefining them", () => {
    const portion = crawlPortion();
    expect(siteCrawlResultSchema.shape.summary.parse(portion.summary)).toEqual(
      portion.summary,
    );
    expect(
      siteCrawlResultSchema.shape.crawlPolicy.parse(portion.crawlPolicy),
    ).toEqual(portion.crawlPolicy);
    expect(
      siteCrawlResultSchema.shape.linkGraph.parse(portion.linkGraph),
    ).toEqual(portion.linkGraph);
  });
});
