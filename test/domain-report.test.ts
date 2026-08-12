import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeDomain, buildDomainReport } from "../src/seo/domain-report";
import { resetGoogleTokenCache } from "../src/google/auth";
import type { Env } from "../src/config";
import type { SiteCrawlResult } from "../src/crawl/site";
import type { Opportunity } from "../src/seo/intelligence";

const env: Env = {
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  GOOGLE_REFRESH_TOKEN: "refresh-token",
};

beforeEach(() => {
  resetGoogleTokenCache();
});

// ---------------------------------------------------------------------------
// buildDomainReport — pure unit tests
// ---------------------------------------------------------------------------

function makeSite(): SiteCrawlResult {
  return {
    site: "https://example.com",
    sitemap: "https://example.com/sitemap.xml",
    sitemapFound: true,
    crawlPolicy: {
      robotsUrl: "https://example.com/robots.txt",
      robotsFound: true,
      userAgent: "seo-mcp",
      sitemapsDeclared: [],
      disallowedSkipped: { count: 0, sample: [] },
    },
    requested: 10,
    crawled: 2,
    failed: 0,
    documentsRead: 1,
    subrequests: 4,
    bytesRead: 1234,
    outputBytes: 567,
    pages: [],
    issueCounts: { missing_h1: 1 },
    summary: {
      pagesAnalyzed: 2,
      duplicateTitles: [],
      duplicateDescriptions: [],
      missingH1: { count: 1, sample: ["https://example.com/a"] },
      multipleH1: { count: 0, sample: [] },
      thinContent: { count: 0, sample: [] },
      nonIndexable: { count: 0, sample: [] },
      imagesMissingAlt: { pages: 0, images: 0 },
    },
    linkGraph: {
      crawledPages: 2,
      orphanPages: { count: 0, sample: [] },
      topLinkedPages: [],
    },
  };
}

const sampleOpportunities: Opportunity[] = [
  {
    type: "low_ctr",
    query: "kw",
    page: "https://example.com/a",
    impressions: 100,
    currentPosition: 5,
    impact: 100,
    effort: 1,
    priorityScore: 100,
    recommendation: "Rewrite title.",
  },
];

describe("buildDomainReport", () => {
  it("maps crawl fields from the SiteCrawlResult", () => {
    const site = makeSite();
    const report = buildDomainReport("https://example.com", site, null, null);
    expect(report.url).toBe("https://example.com");
    expect(report.crawl.sitemapFound).toBe(true);
    expect(report.crawl.crawled).toBe(2);
    expect(report.crawl.failed).toBe(0);
    expect(report.crawl.issueCounts).toEqual({ missing_h1: 1 });
    expect(report.crawl.summary).toBe(site.summary);
    expect(report.crawl.crawlPolicy).toBe(site.crawlPolicy);
    expect(report.crawl.linkGraph).toBe(site.linkGraph);
  });

  it("includes search and omits gscError when search is provided", () => {
    const search = {
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      opportunities: sampleOpportunities,
    };
    const report = buildDomainReport(
      "https://example.com",
      makeSite(),
      search,
      null,
    );
    expect(report.search).toEqual(search);
    expect("gscError" in report).toBe(false);
  });

  it("includes gscError and omits search when gscError is provided", () => {
    const report = buildDomainReport(
      "https://example.com",
      makeSite(),
      null,
      "boom",
    );
    expect(report.gscError).toBe("boom");
    expect("search" in report).toBe(false);
  });

  it("omits both search and gscError when neither is provided", () => {
    const report = buildDomainReport(
      "https://example.com",
      makeSite(),
      null,
      null,
    );
    expect("search" in report).toBe(false);
    expect("gscError" in report).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// analyzeDomain — orchestrator with a combined crawl + GSC fetcher spy
// ---------------------------------------------------------------------------

class PassthroughHtmlRewriter {
  on(): this {
    return this;
  }
  transform(response: Response): Response {
    return response;
  }
}

const sitemapXml = `<urlset><url><loc>https://example.com/a</loc></url></urlset>`;
const pageHtml: Record<string, string> = {
  "/a": `<html lang="en"><head><title>Page A Title Here</title></head><body><h1>A</h1></body></html>`,
};

const gscRowsPayload = () =>
  Response.json({
    rows: [
      {
        keys: ["ctr-kw", "https://example.com/a"],
        clicks: 1,
        impressions: 100,
        ctr: 0.01,
        position: 5,
      },
    ],
  });

function makeFetcher(gscResponse: () => Response) {
  return vi.fn<typeof fetch>(async (input) => {
    const raw = input.toString();
    if (raw.includes("oauth2.googleapis.com/token")) {
      return Response.json({ access_token: "access-123", expires_in: 3600 });
    }
    if (raw.includes("searchconsole.googleapis.com")) {
      return gscResponse();
    }
    const url = new URL(raw);
    if (url.pathname === "/robots.txt")
      return new Response("Not found", { status: 404 });
    if (url.pathname === "/sitemap.xml")
      return new Response(sitemapXml, {
        headers: { "content-type": "application/xml" },
      });
    return new Response(pageHtml[url.pathname] ?? "<html></html>", {
      headers: { "content-type": "text/html" },
    });
  });
}

describe("analyzeDomain", () => {
  it("merges crawl and Search Console opportunities when GSC params are present", async () => {
    vi.stubGlobal("HTMLRewriter", PassthroughHtmlRewriter);
    try {
      const fetcher = makeFetcher(gscRowsPayload);
      const report = await analyzeDomain(
        {
          url: "https://example.com",
          gscProperty: "sc-domain:example.com",
          startDate: "2026-01-01",
          endDate: "2026-01-31",
        },
        env,
        fetcher,
      );
      expect(report.crawl.crawled).toBe(1);
      expect(report.search).toBeDefined();
      expect(report.search!.startDate).toBe("2026-01-01");
      expect(report.search!.endDate).toBe("2026-01-31");
      expect(report.search!.opportunities.length).toBeGreaterThan(0);
      expect(report.gscError).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns crawl only when GSC params are absent", async () => {
    vi.stubGlobal("HTMLRewriter", PassthroughHtmlRewriter);
    try {
      const fetcher = makeFetcher(gscRowsPayload);
      const report = await analyzeDomain(
        { url: "https://example.com" },
        env,
        fetcher,
      );
      expect(report.crawl.crawled).toBe(1);
      expect("search" in report).toBe(false);
      expect("gscError" in report).toBe(false);
      // no GSC endpoint should be contacted
      const gscCall = fetcher.mock.calls.find((c) =>
        c[0].toString().includes("searchconsole.googleapis.com"),
      );
      expect(gscCall).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("captures a GSC failure as gscError while the crawl still succeeds", async () => {
    vi.stubGlobal("HTMLRewriter", PassthroughHtmlRewriter);
    try {
      const fetcher = makeFetcher(() => new Response("nope", { status: 500 }));
      const report = await analyzeDomain(
        {
          url: "https://example.com",
          gscProperty: "sc-domain:example.com",
          startDate: "2026-01-01",
          endDate: "2026-01-31",
        },
        env,
        fetcher,
      );
      expect(report.crawl.crawled).toBe(1);
      expect("search" in report).toBe(false);
      expect(typeof report.gscError).toBe("string");
      expect(report.gscError!.length).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
