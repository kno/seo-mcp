import { describe, expect, it, vi } from "vitest";
import {
  aggregateIssueCounts,
  crawlSite,
  mapConcurrent,
  measureBoundedOutput,
} from "../src/crawl/site";
import { createFetchBudget } from "../src/http/fetch";
import { discoverSitemapUrls, parseSitemap } from "../src/crawl/sitemap";

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
      return url.pathname === "/sitemap.xml"
        ? new Response("Not found", { status: 404 })
        : new Response("<html></html>", {
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
      expect(result.subrequests).toBe(2);
      expect(result.crawled).toBe(1);
      expect(fetcher).toHaveBeenCalledTimes(2);
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
