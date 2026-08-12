import { describe, expect, it } from "vitest";
import { siteCrawlResultSchema } from "../../src/schemas/site";

function pageFixture() {
  return {
    url: "https://example.com/",
    status: 200,
    bytesRead: 512,
    title: "Home",
    description: "Home page",
    h1: ["Home"],
    h2: [],
    h3: [],
    internalLinks: 1,
    externalLinks: 0,
    imageCount: 0,
    imagesMissingAlt: 0,
    openGraph: {},
    jsonLd: { blocks: 0, types: [], invalid: 0 },
    wordCount: 300,
    indexable: true,
    issues: [],
    linkCount: 1,
  };
}

function siteFixture() {
  return {
    site: "https://example.com/",
    sitemap: "https://example.com/sitemap.xml",
    sitemapFound: true,
    crawlPolicy: {
      robotsUrl: "https://example.com/robots.txt",
      robotsFound: true,
      userAgent: "seo-mcp",
      sitemapsDeclared: ["https://example.com/sitemap.xml"],
      disallowedSkipped: { count: 0, sample: [] },
    },
    requested: 10,
    crawled: 1,
    failed: 1,
    documentsRead: 1,
    subrequests: 3,
    bytesRead: 512,
    outputBytes: 900,
    pages: [
      { url: "https://example.com/", result: pageFixture() },
      { url: "https://example.com/broken", error: "fetch failed" },
    ],
    issueCounts: { missing_lang: 1 },
    summary: {
      pagesAnalyzed: 1,
      duplicateTitles: [
        { value: "home", count: 2, sample: ["https://example.com/"] },
      ],
      duplicateDescriptions: [],
      missingH1: { count: 0, sample: [] },
      multipleH1: { count: 0, sample: [] },
      thinContent: { count: 0, sample: [] },
      nonIndexable: { count: 0, sample: [] },
      imagesMissingAlt: { pages: 0, images: 0 },
    },
    linkGraph: {
      crawledPages: 1,
      orphanPages: { count: 0, sample: [] },
      topLinkedPages: [{ url: "https://example.com/", inbound: 1 }],
    },
  };
}

describe("siteCrawlResultSchema", () => {
  it("accepts a fixture mixing successful and failed page entries", () => {
    const fixture = siteFixture();
    expect(siteCrawlResultSchema.parse(fixture)).toEqual(fixture);
  });

  it("accepts a failed page entry that omits result and only carries error", () => {
    const fixture = siteFixture();
    fixture.pages = [
      { url: "https://example.com/broken", error: "fetch failed" },
    ];
    const parsed = siteCrawlResultSchema.parse(fixture);
    expect(parsed.pages[0].result).toBeUndefined();
    expect(parsed.pages[0].error).toBe("fetch failed");
  });

  it("rejects a fixture missing a required top-level field", () => {
    const fixture = siteFixture() as Record<string, unknown>;
    delete fixture.linkGraph;
    expect(() => siteCrawlResultSchema.parse(fixture)).toThrow();
  });
});
