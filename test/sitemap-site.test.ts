import { describe, expect, it, vi } from "vitest";
import {
  aggregateIssueCounts,
  crawlSite,
  mapConcurrent,
  measureBoundedOutput,
  summarizeDomain,
  summarizeLinkGraph,
} from "../src/crawl/site";
import { createFetchBudget } from "../src/http/fetch";
import { discoverSitemapUrls, parseSitemap } from "../src/crawl/sitemap";
import type { SitePageAnalysis } from "../src/crawl/site";

describe("sitemap and site aggregation", () => {
  it("parses urlsets and sitemap indexes", () => {
    expect(
      parseSitemap(
        "<urlset><url><loc>https://example.com/a&amp;b</loc></url></urlset>",
      ),
    ).toEqual({
      kind: "urlset",
      locations: ["https://example.com/a&b"],
    });
    expect(
      parseSitemap(
        "<sitemapindex><sitemap><loc>https://example.com/a.xml</loc></sitemap></sitemapindex>",
      ).kind,
    ).toBe("index");
  });

  it("bounds accumulated sitemap locations", () => {
    const xml = `<urlset>${Array.from({ length: 120 }, (_, index) => `<url><loc>https://example.com/${index}</loc></url>`).join("")}</urlset>`;
    expect(parseSitemap(xml).locations).toHaveLength(100);
  });

  it("falls back to the normalized input URL when the root sitemap is missing", async () => {
    const budget = createFetchBudget(
      async () => new Response("Not found", { status: 404 }),
      2,
    );

    await expect(
      discoverSitemapUrls(
        "HTTPS://Example.COM:443/start#fragment",
        10,
        budget.fetcher,
      ),
    ).resolves.toEqual({
      sitemap: "https://example.com/sitemap.xml",
      sitemapFound: false,
      urls: ["https://example.com/start"],
      documentsRead: 0,
    });
    expect(budget.used()).toBe(1);

    const blockedFetcher = vi.fn<typeof fetch>();
    await expect(
      discoverSitemapUrls("http://127.0.0.1/private", 10, blockedFetcher),
    ).rejects.toThrow("not allowed");
    expect(blockedFetcher).not.toHaveBeenCalled();
  });

  it("shares the subrequest budget between the missing sitemap and fallback page", async () => {
    class PassthroughHtmlRewriter {
      on(): this {
        return this;
      }
      transform(response: Response): Response {
        return response;
      }
    }
    vi.stubGlobal("HTMLRewriter", PassthroughHtmlRewriter);
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input.toString());
      if (url.pathname === "/sitemap.xml")
        return new Response("Not found", { status: 404 });
      if (url.pathname === "/robots.txt")
        return new Response("Not found", { status: 404 });
      return new Response("<html></html>", {
        headers: { "content-type": "text/html" },
      });
    });

    try {
      const result = await crawlSite(
        "https://example.com/start",
        10,
        4,
        fetcher,
      );
      expect(result.sitemapFound).toBe(false);
      // sitemap probe (404) + robots probe (404) + one page fetch.
      expect(result.subrequests).toBe(3);
      expect(result.crawled).toBe(1);
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("skips sitemap urls disallowed by robots and records them in the crawl policy", async () => {
    class PassthroughHtmlRewriter {
      on(): this {
        return this;
      }
      transform(response: Response): Response {
        return response;
      }
    }
    vi.stubGlobal("HTMLRewriter", PassthroughHtmlRewriter);
    const sitemapXml = `<urlset><url><loc>https://example.com/public</loc></url><url><loc>https://example.com/private/secret</loc></url></urlset>`;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input.toString());
      if (url.pathname === "/robots.txt")
        return new Response("User-agent: *\nDisallow: /private", {
          headers: { "content-type": "text/plain" },
        });
      if (url.pathname === "/sitemap.xml")
        return new Response(sitemapXml, {
          headers: { "content-type": "application/xml" },
        });
      return new Response("<html></html>", {
        headers: { "content-type": "text/html" },
      });
    });

    try {
      const result = await crawlSite("https://example.com", 10, 4, fetcher);
      expect(result.crawlPolicy.robotsFound).toBe(true);
      expect(result.crawlPolicy.robotsUrl).toBe(
        "https://example.com/robots.txt",
      );
      expect(result.crawlPolicy.userAgent).toBe("seo-mcp");
      expect(result.crawlPolicy.disallowedSkipped.count).toBe(1);
      expect(result.crawlPolicy.disallowedSkipped.sample).toEqual([
        "https://example.com/private/secret",
      ]);
      expect(result.pages.map((page) => page.url)).toEqual([
        "https://example.com/public",
      ]);
      expect(result.crawled).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("crawls all urls and reports robotsFound false when robots.txt is missing", async () => {
    class PassthroughHtmlRewriter {
      on(): this {
        return this;
      }
      transform(response: Response): Response {
        return response;
      }
    }
    vi.stubGlobal("HTMLRewriter", PassthroughHtmlRewriter);
    const sitemapXml = `<urlset><url><loc>https://example.com/a</loc></url><url><loc>https://example.com/b</loc></url></urlset>`;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input.toString());
      if (url.pathname === "/robots.txt")
        return new Response("Not found", { status: 404 });
      if (url.pathname === "/sitemap.xml")
        return new Response(sitemapXml, {
          headers: { "content-type": "application/xml" },
        });
      return new Response("<html></html>", {
        headers: { "content-type": "text/html" },
      });
    });

    try {
      const result = await crawlSite("https://example.com", 10, 4, fetcher);
      expect(result.crawlPolicy.robotsFound).toBe(false);
      expect(result.crawlPolicy.disallowedSkipped.count).toBe(0);
      expect(result.pages.map((page) => page.url)).toEqual([
        "https://example.com/a",
        "https://example.com/b",
      ]);
      expect(result.crawled).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("surfaces sitemaps declared in robots.txt", async () => {
    class PassthroughHtmlRewriter {
      on(): this {
        return this;
      }
      transform(response: Response): Response {
        return response;
      }
    }
    vi.stubGlobal("HTMLRewriter", PassthroughHtmlRewriter);
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input.toString());
      if (url.pathname === "/robots.txt")
        return new Response(
          "User-agent: *\nDisallow:\nSitemap: https://example.com/news.xml",
          { headers: { "content-type": "text/plain" } },
        );
      if (url.pathname === "/sitemap.xml")
        return new Response(
          "<urlset><url><loc>https://example.com/a</loc></url></urlset>",
          { headers: { "content-type": "application/xml" } },
        );
      return new Response("<html></html>", {
        headers: { "content-type": "text/html" },
      });
    });

    try {
      const result = await crawlSite("https://example.com", 10, 4, fetcher);
      expect(result.crawlPolicy.sitemapsDeclared).toEqual([
        "https://example.com/news.xml",
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("aggregates issue codes", () => {
    const pages = [
      {
        url: "a",
        result: { issues: [{ code: "missing_h1" }, { code: "missing_title" }] },
      },
      { url: "b", result: { issues: [{ code: "missing_h1" }] } },
    ] as never;
    expect(aggregateIssueCounts(pages)).toEqual({
      missing_h1: 2,
      missing_title: 1,
    });
  });

  it("never exceeds requested concurrency", async () => {
    let active = 0;
    let peak = 0;
    await mapConcurrent([1, 2, 3, 4, 5], 2, async (value) => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return value;
    });
    expect(peak).toBe(2);
  });

  it("enforces the shared subrequest budget", async () => {
    const budget = createFetchBudget(async () => new Response("ok"), 1);
    await budget.fetcher("https://example.com");
    await expect(budget.fetcher("https://example.com/again")).rejects.toThrow(
      "budget",
    );
    expect(budget.used()).toBe(1);
  });

  it("rejects oversized aggregate tool output", () => {
    expect(() =>
      measureBoundedOutput({ pages: ["x".repeat(101)] }, 100),
    ).toThrow("output exceeds");
  });
});

// ---------------------------------------------------------------------------
// Helper to build a minimal SitePageAnalysis for summarizeDomain tests
// ---------------------------------------------------------------------------
function makePage(
  url: string,
  overrides: Partial<SitePageAnalysis> = {},
): { url: string; result: SitePageAnalysis } {
  const defaults: SitePageAnalysis = {
    url,
    title: "Default Title",
    description: "Default description",
    h1: ["Heading"],
    h2: [],
    h3: [],
    wordCount: 500,
    indexable: true,
    imageCount: 0,
    imagesMissingAlt: 0,
    internalLinks: 0,
    externalLinks: 0,
    linkCount: 0,
    openGraph: {},
    jsonLd: { blocks: 0, types: [], invalid: 0 },
    status: 200,
    bytesRead: 1000,
    issues: [],
  };
  return { url, result: { ...defaults, ...overrides } };
}

function makeError(url: string): { url: string; error: string } {
  return { url, error: "fetch failed" };
}

describe("summarizeDomain", () => {
  it("counts only pages with a result, excludes errored pages", () => {
    const pages = [
      makePage("https://example.com/a"),
      makeError("https://example.com/b"),
    ];
    const summary = summarizeDomain(pages);
    expect(summary.pagesAnalyzed).toBe(1);
  });

  it("returns zero counts for a clean set of pages", () => {
    const pages = [
      makePage("https://example.com/a", { description: "Description A" }),
      makePage("https://example.com/b", {
        title: "Another Title",
        description: "Description B",
      }),
    ];
    const summary = summarizeDomain(pages);
    expect(summary.pagesAnalyzed).toBe(2);
    expect(summary.duplicateTitles).toEqual([]);
    expect(summary.duplicateDescriptions).toEqual([]);
    expect(summary.missingH1.count).toBe(0);
    expect(summary.missingH1.sample).toEqual([]);
    expect(summary.multipleH1.count).toBe(0);
    expect(summary.thinContent.count).toBe(0);
    expect(summary.nonIndexable.count).toBe(0);
    expect(summary.imagesMissingAlt).toEqual({ pages: 0, images: 0 });
  });

  it("detects duplicate titles and groups them", () => {
    const pages = [
      makePage("https://example.com/a", { title: "Same Title" }),
      makePage("https://example.com/b", { title: "Same Title" }),
      makePage("https://example.com/c", { title: "Same Title" }),
      makePage("https://example.com/d", { title: "Unique Title" }),
    ];
    const summary = summarizeDomain(pages);
    expect(summary.duplicateTitles).toHaveLength(1);
    expect(summary.duplicateTitles[0].count).toBe(3);
    expect(summary.duplicateTitles[0].value).toBe("same title");
    expect(summary.duplicateTitles[0].sample).toEqual([
      "https://example.com/a",
      "https://example.com/b",
      "https://example.com/c",
    ]);
  });

  it("normalizes titles: trim, collapse whitespace, lowercase", () => {
    const pages = [
      makePage("https://example.com/a", { title: "  Hello   World  " }),
      makePage("https://example.com/b", { title: "hello world" }),
    ];
    const summary = summarizeDomain(pages);
    expect(summary.duplicateTitles).toHaveLength(1);
    expect(summary.duplicateTitles[0].count).toBe(2);
    expect(summary.duplicateTitles[0].value).toBe("hello world");
  });

  it("skips empty/whitespace-only titles for duplicate detection", () => {
    const pages = [
      makePage("https://example.com/a", { title: "" }),
      makePage("https://example.com/b", { title: "   " }),
      makePage("https://example.com/c", { title: "" }),
    ];
    const summary = summarizeDomain(pages);
    expect(summary.duplicateTitles).toEqual([]);
  });

  it("does not emit a group for a title appearing only once", () => {
    const pages = [
      makePage("https://example.com/a", { title: "Unique A" }),
      makePage("https://example.com/b", { title: "Unique B" }),
    ];
    const summary = summarizeDomain(pages);
    expect(summary.duplicateTitles).toEqual([]);
  });

  it("detects duplicate descriptions", () => {
    const pages = [
      makePage("https://example.com/a", { description: "Shared desc" }),
      makePage("https://example.com/b", { description: "Shared desc" }),
    ];
    const summary = summarizeDomain(pages);
    expect(summary.duplicateDescriptions).toHaveLength(1);
    expect(summary.duplicateDescriptions[0].count).toBe(2);
    expect(summary.duplicateDescriptions[0].value).toBe("shared desc");
  });

  it("skips empty descriptions for duplicate detection", () => {
    const pages = [
      makePage("https://example.com/a", { description: "" }),
      makePage("https://example.com/b", { description: "" }),
    ];
    const summary = summarizeDomain(pages);
    expect(summary.duplicateDescriptions).toEqual([]);
  });

  it("sorts duplicate groups by count desc, tie-break by value asc", () => {
    const pages = [
      makePage("https://example.com/a", { title: "Beta" }),
      makePage("https://example.com/b", { title: "Beta" }),
      makePage("https://example.com/c", { title: "Beta" }),
      makePage("https://example.com/d", { title: "Alpha" }),
      makePage("https://example.com/e", { title: "Alpha" }),
      makePage("https://example.com/f", { title: "Gamma" }),
      makePage("https://example.com/g", { title: "Gamma" }),
    ];
    const summary = summarizeDomain(pages);
    expect(summary.duplicateTitles[0].value).toBe("beta"); // count 3
    expect(summary.duplicateTitles[1].value).toBe("alpha"); // count 2, "alpha" < "gamma"
    expect(summary.duplicateTitles[2].value).toBe("gamma"); // count 2
  });

  it("caps duplicate groups at 20, reports true counts", () => {
    // 22 distinct titles each appearing twice → 22 groups, capped to 20
    const pages = Array.from({ length: 44 }, (_, i) => {
      const title = `Title ${String(i % 22).padStart(3, "0")}`;
      return makePage(`https://example.com/${i}`, { title });
    });
    const summary = summarizeDomain(pages);
    expect(summary.duplicateTitles).toHaveLength(20);
    // every emitted group should have count 2
    for (const group of summary.duplicateTitles) {
      expect(group.count).toBe(2);
    }
  });

  it("caps duplicate group sample at 10 urls, count reflects true size", () => {
    const pages = Array.from({ length: 15 }, (_, i) =>
      makePage(`https://example.com/${i}`, { title: "Same" }),
    );
    const summary = summarizeDomain(pages);
    expect(summary.duplicateTitles).toHaveLength(1);
    expect(summary.duplicateTitles[0].count).toBe(15);
    expect(summary.duplicateTitles[0].sample).toHaveLength(10);
  });

  it("slices duplicate value to 200 chars", () => {
    const longTitle = "x".repeat(300);
    const pages = [
      makePage("https://example.com/a", { title: longTitle }),
      makePage("https://example.com/b", { title: longTitle }),
    ];
    const summary = summarizeDomain(pages);
    expect(summary.duplicateTitles[0].value).toHaveLength(200);
  });

  it("detects missingH1 (h1.length === 0)", () => {
    const pages = [
      makePage("https://example.com/a", { h1: [] }),
      makePage("https://example.com/b", { h1: [] }),
      makePage("https://example.com/c", { h1: ["OK"] }),
    ];
    const summary = summarizeDomain(pages);
    expect(summary.missingH1.count).toBe(2);
    expect(summary.missingH1.sample).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });

  it("detects multipleH1 (h1.length > 1)", () => {
    const pages = [
      makePage("https://example.com/a", { h1: ["H1a", "H1b"] }),
      makePage("https://example.com/b", { h1: ["Solo"] }),
    ];
    const summary = summarizeDomain(pages);
    expect(summary.multipleH1.count).toBe(1);
    expect(summary.multipleH1.sample).toEqual(["https://example.com/a"]);
  });

  it("thinContent boundary: 249 is thin, 250 is not, 0 is not", () => {
    const pages = [
      makePage("https://example.com/thin", { wordCount: 249 }),
      makePage("https://example.com/ok", { wordCount: 250 }),
      makePage("https://example.com/zero", { wordCount: 0 }),
    ];
    const summary = summarizeDomain(pages);
    expect(summary.thinContent.count).toBe(1);
    expect(summary.thinContent.sample).toEqual(["https://example.com/thin"]);
  });

  it("detects nonIndexable pages", () => {
    const pages = [
      makePage("https://example.com/a", { indexable: false }),
      makePage("https://example.com/b", { indexable: true }),
    ];
    const summary = summarizeDomain(pages);
    expect(summary.nonIndexable.count).toBe(1);
    expect(summary.nonIndexable.sample).toEqual(["https://example.com/a"]);
  });

  it("aggregates imagesMissingAlt: pages with >0 and total images", () => {
    const pages = [
      makePage("https://example.com/a", { imagesMissingAlt: 3 }),
      makePage("https://example.com/b", { imagesMissingAlt: 0 }),
      makePage("https://example.com/c", { imagesMissingAlt: 2 }),
    ];
    const summary = summarizeDomain(pages);
    expect(summary.imagesMissingAlt).toEqual({ pages: 2, images: 5 });
  });

  it("caps DomainCategory sample at 25 urls, count reflects true total", () => {
    const pages = Array.from({ length: 30 }, (_, i) =>
      makePage(`https://example.com/${i}`, { h1: [] }),
    );
    const summary = summarizeDomain(pages);
    expect(summary.missingH1.count).toBe(30);
    expect(summary.missingH1.sample).toHaveLength(25);
  });

  it("errored pages are excluded from all category counts", () => {
    const pages = [
      makeError("https://example.com/err1"),
      makeError("https://example.com/err2"),
    ];
    const summary = summarizeDomain(pages);
    expect(summary.pagesAnalyzed).toBe(0);
    expect(summary.missingH1.count).toBe(0);
    expect(summary.thinContent.count).toBe(0);
    expect(summary.nonIndexable.count).toBe(0);
    expect(summary.imagesMissingAlt).toEqual({ pages: 0, images: 0 });
    expect(summary.duplicateTitles).toEqual([]);
  });
});

describe("summarizeLinkGraph", () => {
  it("counts inbound internal links and flags orphans", () => {
    const graph = summarizeLinkGraph([
      {
        url: "https://example.com/a",
        internalLinkTargets: ["https://example.com/b", "https://example.com/c"],
      },
      { url: "https://example.com/b", internalLinkTargets: [] },
      {
        url: "https://example.com/c",
        internalLinkTargets: ["https://example.com/b"],
      },
    ]);
    expect(graph.crawledPages).toBe(3);
    // a has 0 inbound → orphan
    expect(graph.orphanPages.count).toBe(1);
    expect(graph.orphanPages.sample).toEqual(["https://example.com/a"]);
    // b has 2 inbound (from a and c), c has 1 inbound (from a)
    expect(graph.topLinkedPages).toEqual([
      { url: "https://example.com/b", inbound: 2 },
      { url: "https://example.com/c", inbound: 1 },
    ]);
  });

  it("ignores self-links", () => {
    const graph = summarizeLinkGraph([
      {
        url: "https://example.com/a",
        internalLinkTargets: ["https://example.com/a"],
      },
    ]);
    expect(graph.orphanPages.count).toBe(1);
    expect(graph.topLinkedPages).toEqual([]);
  });

  it("ignores targets pointing to non-crawled urls", () => {
    const graph = summarizeLinkGraph([
      {
        url: "https://example.com/a",
        internalLinkTargets: ["https://example.com/missing"],
      },
    ]);
    expect(graph.orphanPages.count).toBe(1);
    expect(graph.topLinkedPages).toEqual([]);
  });

  it("normalizes trailing-slash and fragment variants when matching", () => {
    const graph = summarizeLinkGraph([
      {
        url: "https://example.com",
        internalLinkTargets: ["https://example.com/b#section"],
      },
      {
        url: "https://example.com/b",
        internalLinkTargets: ["https://example.com/"],
      },
    ]);
    // root (with/without trailing slash) and fragment variants match
    expect(graph.orphanPages.count).toBe(0);
    expect(graph.topLinkedPages).toEqual([
      { url: "https://example.com", inbound: 1 },
      { url: "https://example.com/b", inbound: 1 },
    ]);
  });

  it("orders topLinkedPages by inbound desc then url asc, filters inbound>0, caps 10", () => {
    const targets = (n: number): string[] =>
      Array.from({ length: n }, (_, i) => `https://example.com/hub`).slice(
        0,
        n,
      );
    // build 15 sources all linking to a set of hub pages with varying inbound
    const pages: Array<{ url: string; internalLinkTargets: string[] }> = [];
    // 12 hub pages, hub-i receives (12 - i) inbound links
    for (let i = 0; i < 12; i++)
      pages.push({
        url: `https://example.com/hub-${i}`,
        internalLinkTargets: [],
      });
    // sources
    for (let s = 0; s < 12; s++) {
      const t: string[] = [];
      for (let i = 0; i <= s; i++) t.push(`https://example.com/hub-${i}`);
      pages.push({
        url: `https://example.com/src-${s}`,
        internalLinkTargets: t,
      });
    }
    void targets;
    const graph = summarizeLinkGraph(pages);
    // hub-0 linked by all 12 sources, hub-11 linked by 1 source
    expect(graph.topLinkedPages).toHaveLength(10);
    expect(graph.topLinkedPages[0]).toEqual({
      url: "https://example.com/hub-0",
      inbound: 12,
    });
    expect(graph.topLinkedPages.every((entry) => entry.inbound > 0)).toBe(true);
    // verify inbound is non-increasing
    for (let i = 1; i < graph.topLinkedPages.length; i++)
      expect(graph.topLinkedPages[i - 1].inbound).toBeGreaterThanOrEqual(
        graph.topLinkedPages[i].inbound,
      );
  });

  it("excludes pages without targets (errored) from the crawled set", () => {
    const graph = summarizeLinkGraph([
      {
        url: "https://example.com/a",
        internalLinkTargets: ["https://example.com/b"],
      },
      // errored page: no internalLinkTargets → not crawled
      { url: "https://example.com/b" },
    ]);
    expect(graph.crawledPages).toBe(1);
    // b is not in the crawled set, so a's link to b does not count
    expect(graph.topLinkedPages).toEqual([]);
    expect(graph.orphanPages.sample).toEqual(["https://example.com/a"]);
  });

  it("caps the orphan sample at 25", () => {
    const pages = Array.from({ length: 30 }, (_, i) => ({
      url: `https://example.com/${i}`,
      internalLinkTargets: [] as string[],
    }));
    const graph = summarizeLinkGraph(pages);
    expect(graph.orphanPages.count).toBe(30);
    expect(graph.orphanPages.sample).toHaveLength(25);
  });
});

describe("crawlSite link graph wiring", () => {
  it("emits linkGraph and never leaks per-page targets", async () => {
    class PassthroughHtmlRewriter {
      on(): this {
        return this;
      }
      transform(response: Response): Response {
        return response;
      }
    }
    vi.stubGlobal("HTMLRewriter", PassthroughHtmlRewriter);
    const sitemapXml = `<urlset><url><loc>https://example.com/a</loc></url><url><loc>https://example.com/b</loc></url></urlset>`;
    const pageHtml: Record<string, string> = {
      "/a": `<html lang="en"><head><title>Page A Title Here</title></head><body><h1>A</h1><a href="/b">to b</a></body></html>`,
      "/b": `<html lang="en"><head><title>Page B Title Here</title></head><body><h1>B</h1></body></html>`,
    };
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input.toString());
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

    try {
      const result = await crawlSite("https://example.com", 10, 4, fetcher);
      // linkGraph is assembled from the per-page targets and reported.
      expect(result.linkGraph).toBeDefined();
      expect(result.linkGraph.crawledPages).toBe(2);
      expect(result.linkGraph.orphanPages.sample).toEqual([
        "https://example.com/a",
        "https://example.com/b",
      ]);
      // targets must not appear on any output page
      for (const page of result.pages) expect("targets" in page).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
