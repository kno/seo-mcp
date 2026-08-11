import { describe, expect, it, vi } from "vitest";
import { analyzePageSpeed, normalizePageSpeed } from "../src/pagespeed/client";

describe("normalizePageSpeed", () => {
  it("keeps lab metrics separate from optional field INP and caps opportunities", () => {
    const audits = Object.fromEntries(
      Array.from({ length: 15 }, (_, index) => [
        `opportunity-${index}`,
        {
          title: `Opportunity ${index}`,
          details: { overallSavingsMs: index + 1 },
        },
      ]),
    );
    Object.assign(audits, {
      "largest-contentful-paint": { numericValue: 2500 },
      "total-blocking-time": { numericValue: 120 },
    });
    const result = normalizePageSpeed(
      {
        lighthouseResult: {
          fetchTime: "2026-01-01",
          categories: {
            performance: { score: 0.91 },
            accessibility: { score: 0.906 },
            "best-practices": { score: 1.2 },
            seo: { score: -0.1 },
          },
          audits,
        },
        loadingExperience: {
          overall_category: "AVERAGE",
          metrics: { INTERACTION_TO_NEXT_PAINT: { percentile: 240 } },
        },
      },
      "https://example.com/",
      "mobile",
    );
    expect(result.performanceScore).toBe(91);
    expect(result.accessibilityScore).toBe(91);
    expect(result.bestPracticesScore).toBe(100);
    expect(result.seoScore).toBe(0);
    expect(result.labMetrics.largestContentfulPaintMs).toBe(2500);
    expect(result.fieldMetrics?.interactionToNextPaintMs).toBe(240);
    expect(result.opportunities).toHaveLength(10);
  });

  it("handles absent optional fields defensively", () => {
    const result = normalizePageSpeed(
      { lighthouseResult: { categories: {}, audits: {} } },
      "https://example.com",
      "desktop",
    );
    expect(result.fieldMetrics).toBeUndefined();
    expect(result.opportunities).toEqual([]);
  });

  it("surfaces API errors", () => {
    expect(() =>
      normalizePageSpeed(
        { error: { message: "Quota exceeded" } },
        "https://example.com",
        "mobile",
      ),
    ).toThrow("Quota exceeded");
  });

  it("requests all score categories in one PageSpeed subrequest", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        lighthouseResult: { categories: {}, audits: {} },
      }),
    );

    await analyzePageSpeed(
      "HTTPS://Example.COM:443/page#fragment",
      "desktop",
      {},
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledOnce();
    const requested = new URL(fetcher.mock.calls[0][0].toString());
    expect(requested.searchParams.get("url")).toBe("https://example.com/page");
    expect(requested.searchParams.get("strategy")).toBe("desktop");
    expect(requested.searchParams.getAll("category")).toEqual([
      "performance",
      "accessibility",
      "best-practices",
      "seo",
    ]);
  });
});
