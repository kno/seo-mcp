import { describe, expect, it } from "vitest";
import type { Bound, Cardinality } from "./bounds";
import {
  collectBounds,
  collectCrawlDiffBounds,
  collectDiffBounds,
  collectOpportunityBounds,
  describeCannibalGroupPagesBound,
  describeCappedList,
  describeCategory,
  describeDiffBucket,
  describeGscRows,
  describeOpportunityBound,
  describeOutputBytes,
  describeProbeSet,
  describeSeoIntelligenceBound,
  isBounded,
} from "./bounds";
import type { LinkCheckResult, SiteCrawlResult } from "../../../../src/types";

function emptyCategory() {
  return { count: 0, sample: [] as string[] };
}

function completeSiteCrawlResult(): SiteCrawlResult {
  return {
    site: "https://example.com",
    sitemap: "https://example.com/sitemap.xml",
    sitemapFound: true,
    crawlPolicy: {
      robotsUrl: "https://example.com/robots.txt",
      robotsFound: true,
      userAgent: "seo-mcp",
      sitemapsDeclared: ["https://example.com/sitemap.xml"],
      disallowedSkipped: emptyCategory(),
    },
    requested: 2,
    crawled: 2,
    failed: 0,
    documentsRead: 2,
    subrequests: 4,
    bytesRead: 1000,
    outputBytes: 1000,
    pages: [
      {
        url: "https://example.com/a",
        result: {
          url: "https://example.com/a",
          status: 200,
          bytesRead: 500,
          title: "A",
          description: "",
          h1: ["A"],
          h2: [],
          h3: [],
          linkCount: 1,
          internalLinks: 1,
          externalLinks: 0,
          imageCount: 0,
          imagesMissingAlt: 0,
          openGraph: {},
          jsonLd: { blocks: 0, types: [], invalid: 0 },
          wordCount: 100,
          indexable: true,
          issues: [],
        },
      },
    ],
    issueCounts: {},
    summary: {
      pagesAnalyzed: 1,
      duplicateTitles: [],
      duplicateDescriptions: [],
      missingH1: emptyCategory(),
      multipleH1: emptyCategory(),
      thinContent: emptyCategory(),
      nonIndexable: emptyCategory(),
      imagesMissingAlt: { pages: 0, images: 0 },
    },
    linkGraph: {
      crawledPages: 1,
      orphanPages: emptyCategory(),
      topLinkedPages: [],
    },
  };
}

describe("Cardinality discrimination", () => {
  it("distinguishes 'none' from 'bounded' via isBounded, not raw counts", () => {
    const none: Cardinality = { state: "none" };
    const bound: Bound = {
      kind: "probe_cap",
      scope: "linkCheck.checked",
      limitName: "maxLinkChecks",
      limitValue: 50,
      shown: 50,
    };
    const bounded: Cardinality = { state: "bounded", bound };

    expect(isBounded(none)).toBe(false);
    expect(isBounded(bounded)).toBe(true);
  });

  it("does not consider 'complete' or 'unknown' as bounded", () => {
    const complete: Cardinality = { state: "complete", total: 3 };
    const unknown: Cardinality = { state: "unknown" };

    expect(isBounded(complete)).toBe(false);
    expect(isBounded(unknown)).toBe(false);
  });

  it("narrows the type so `.bound` is accessible without a cast when isBounded is true", () => {
    const bound: Bound = {
      kind: "sample_cap",
      scope: "summary.duplicateTitles[0].sample",
      limitName: "DuplicateGroup.sample",
      limitValue: 10,
      shown: 10,
      total: 34,
    };
    const cardinality: Cardinality = { state: "bounded", bound };

    if (isBounded(cardinality)) {
      // This line only typechecks if `isBounded` is a real type guard.
      expect(cardinality.bound.limitValue).toBe(10);
      expect(cardinality.bound.total).toBe(34);
    } else {
      throw new Error("expected isBounded to narrow to the bounded branch");
    }
  });
});

describe("describeProbeSet", () => {
  it("returns 'none' when zero links were checked", () => {
    expect(describeProbeSet(0, 50)).toEqual({ state: "none" });
  });

  it("returns 'bounded' naming the limit when checked equals the server's cap", () => {
    const result = describeProbeSet(50, 50);
    expect(result.state).toBe("bounded");
    if (result.state === "bounded") {
      expect(result.bound).toEqual({
        kind: "probe_cap",
        scope: "checked",
        limitName: "maxLinkChecks",
        limitValue: 50,
        shown: 50,
      });
    }
  });

  it("returns 'complete' (never bounded) when checked is below the cap", () => {
    expect(describeProbeSet(12, 50)).toEqual({ state: "complete", total: 12 });
  });
});

describe("describeCategory", () => {
  it("returns 'none' when the category's count is 0", () => {
    expect(
      describeCategory(
        { count: 0, sample: [] },
        "DomainCategory.sample",
        25,
        "summary.missingH1",
      ),
    ).toEqual({ state: "none" });
  });

  it("returns 'bounded' naming the sample cap when the sample was truncated relative to count", () => {
    const sample = Array.from(
      { length: 10 },
      (_, i) => `https://example.com/${i}`,
    );
    const result = describeCategory(
      { count: 15, sample },
      "DuplicateGroup.sample",
      10,
      "summary.duplicateTitles[0].sample",
    );
    expect(result).toEqual({
      state: "bounded",
      bound: {
        kind: "sample_cap",
        scope: "summary.duplicateTitles[0].sample",
        limitName: "DuplicateGroup.sample",
        limitValue: 10,
        shown: 10,
        total: 15,
      },
    });
  });

  it("returns 'complete' when count equals the sample length (not mislabeled as a sample)", () => {
    const sample = ["https://example.com/a", "https://example.com/b"];
    const result = describeCategory(
      { count: 2, sample },
      "DomainCategory.sample",
      25,
      "summary.nonIndexable",
    );
    expect(result).toEqual({ state: "complete", total: 2 });
  });
});

describe("describeCappedList", () => {
  it("returns 'none' for an empty list", () => {
    expect(
      describeCappedList(
        [],
        "sitemapsDeclared",
        20,
        "crawlPolicy.sitemapsDeclared",
      ),
    ).toEqual({ state: "none" });
  });

  it("returns 'bounded' without a total when the list length equals the cap", () => {
    const items = Array.from({ length: 20 }, (_, i) => `sitemap-${i}.xml`);
    const result = describeCappedList(
      items,
      "sitemapsDeclared",
      20,
      "crawlPolicy.sitemapsDeclared",
    );
    expect(result).toEqual({
      state: "bounded",
      bound: {
        kind: "group_cap",
        scope: "crawlPolicy.sitemapsDeclared",
        limitName: "sitemapsDeclared",
        limitValue: 20,
        shown: 20,
      },
    });
  });

  it("returns 'complete' when the list length is below the cap", () => {
    const items = ["sitemap-0.xml", "sitemap-1.xml"];
    const result = describeCappedList(
      items,
      "sitemapsDeclared",
      20,
      "crawlPolicy.sitemapsDeclared",
    );
    expect(result).toEqual({ state: "complete", total: 2 });
  });
});

describe("describeOutputBytes", () => {
  const MAX_SITE_OUTPUT_BYTES = 256_000;

  it("returns null when outputBytes is far below the cap", () => {
    const result = describeOutputBytes(
      { outputBytes: 1000, requested: 10, crawled: 10, failed: 0 },
      MAX_SITE_OUTPUT_BYTES,
    );
    expect(result).toBeNull();
  });

  it("returns null when outputBytes is near the cap but nothing was actually truncated", () => {
    const result = describeOutputBytes(
      { outputBytes: 255_000, requested: 10, crawled: 10, failed: 0 },
      MAX_SITE_OUTPUT_BYTES,
    );
    expect(result).toBeNull();
  });

  it("returns an output_bytes bound when near the cap AND crawled+failed < requested", () => {
    const result = describeOutputBytes(
      { outputBytes: 255_500, requested: 20, crawled: 12, failed: 1 },
      MAX_SITE_OUTPUT_BYTES,
    );
    expect(result).toEqual({
      kind: "output_bytes",
      scope: "outputBytes",
      limitName: "maxSiteOutputBytes",
      limitValue: MAX_SITE_OUTPUT_BYTES,
      shown: 13,
      total: 20,
    });
  });
});

describe("describeGscRows", () => {
  it("returns 'none' when rowCount is 0", () => {
    expect(describeGscRows(0, 250)).toEqual({ state: "none" });
  });

  it("returns 'bounded' naming maxGscRows when rowCount equals the 250-row cap", () => {
    const result = describeGscRows(250, 250);
    expect(result.state).toBe("bounded");
    if (result.state === "bounded") {
      expect(result.bound).toEqual({
        kind: "probe_cap",
        scope: "rowCount",
        limitName: "maxGscRows",
        limitValue: 250,
        shown: 250,
      });
    }
  });

  it("returns 'complete' (never bounded) for 249, one below the cap", () => {
    expect(describeGscRows(249, 250)).toEqual({
      state: "complete",
      total: 249,
    });
  });

  it("returns 'complete' for an arbitrary in-range row count", () => {
    expect(describeGscRows(37, 250)).toEqual({ state: "complete", total: 37 });
  });
});

describe("collectBounds", () => {
  it("returns an empty array for a complete, unbounded crawl_site result", () => {
    expect(collectBounds("crawl_site", completeSiteCrawlResult())).toEqual([]);
  });

  it("collects the output_bytes bound when the crawl was truncated at the cap", () => {
    const result: SiteCrawlResult = {
      ...completeSiteCrawlResult(),
      outputBytes: 256_000,
      requested: 5,
      crawled: 3,
      failed: 0,
    };
    const bounds = collectBounds("crawl_site", result);
    expect(bounds.some((bound) => bound.kind === "output_bytes")).toBe(true);
  });

  it("collects a sample_cap bound for a truncated domain category", () => {
    const sample = Array.from(
      { length: 25 },
      (_, i) => `https://example.com/${i}`,
    );
    const result: SiteCrawlResult = {
      ...completeSiteCrawlResult(),
      summary: {
        ...completeSiteCrawlResult().summary,
        missingH1: { count: 40, sample },
      },
    };
    const bounds = collectBounds("crawl_site", result);
    expect(
      bounds.some(
        (bound) =>
          bound.kind === "sample_cap" &&
          bound.scope === "summary.missingH1.sample",
      ),
    ).toBe(true);
  });

  it("collects a group_cap bound for a capped duplicate-group list with no total", () => {
    const groups = Array.from({ length: 20 }, (_, i) => ({
      value: `title-${i}`,
      count: 1,
      sample: [`https://example.com/${i}`],
    }));
    const result: SiteCrawlResult = {
      ...completeSiteCrawlResult(),
      summary: {
        ...completeSiteCrawlResult().summary,
        duplicateTitles: groups,
      },
    };
    const bounds = collectBounds("crawl_site", result);
    expect(
      bounds.some(
        (bound) =>
          bound.kind === "group_cap" &&
          bound.scope === "summary.duplicateTitles",
      ),
    ).toBe(true);
  });

  it("collects the probe_cap bound for check_links at the checked cap", () => {
    const result: LinkCheckResult = {
      url: "https://example.com",
      pageStatus: 200,
      checked: 40,
      ok: 30,
      broken: 5,
      errors: 5,
      linksFound: 40,
      truncated: false,
      results: [],
    };
    expect(collectBounds("check_links", result)).toEqual([
      {
        kind: "probe_cap",
        scope: "checked",
        limitName: "maxLinkChecks",
        limitValue: 40,
        shown: 40,
      },
    ]);
  });

  it("returns an empty array for check_links below the probe cap", () => {
    const result: LinkCheckResult = {
      url: "https://example.com",
      pageStatus: 200,
      checked: 10,
      ok: 10,
      broken: 0,
      errors: 0,
      linksFound: 10,
      truncated: false,
      results: [],
    };
    expect(collectBounds("check_links", result)).toEqual([]);
  });

  it("returns an empty array for crawl_page and analyze_pagespeed (no known bound)", () => {
    expect(collectBounds("crawl_page", { anything: true })).toEqual([]);
    expect(collectBounds("analyze_pagespeed", { anything: true })).toEqual([]);
  });

  it("returns the maxGscRows bound for search_console_query at the 250-row cap", () => {
    expect(collectBounds("search_console_query", { rowCount: 250 })).toEqual([
      {
        kind: "probe_cap",
        scope: "rowCount",
        limitName: "maxGscRows",
        limitValue: 250,
        shown: 250,
      },
    ]);
  });

  it("returns an empty array for search_console_query below the 250-row cap", () => {
    expect(collectBounds("search_console_query", { rowCount: 37 })).toEqual([]);
  });
});

/**
 * `gsc-insight-views` task 6.3 — the opportunity-tools bound reads
 * `criteria.limit` (a value the SERVER echoed, possibly its own default),
 * never a hardcoded constant, and never reports `"complete"` even below
 * the bound (the undetectable pre-filter 250-row GSC pull cap).
 */
describe("describeOpportunityBound", () => {
  it("is bounded when rowCount equals the echoed criteria.limit", () => {
    const cardinality = describeOpportunityBound({
      rowCount: 25,
      criteria: { limit: 25, minImpressions: 1 },
    });
    expect(cardinality).toEqual({
      state: "bounded",
      bound: {
        kind: "sample_cap",
        scope: "rowCount",
        limitName: "criteria.limit",
        limitValue: 25,
        shown: 25,
      },
    });
  });

  it("is none when rowCount is zero, distinct from below-the-bound", () => {
    expect(
      describeOpportunityBound({ rowCount: 0, criteria: { limit: 25 } }),
    ).toEqual({ state: "none" });
  });

  it("is never 'complete' below the bound — the deeper 250-row pull cap is undetectable from the response", () => {
    const cardinality = describeOpportunityBound({
      rowCount: 3,
      criteria: { limit: 25 },
    });
    expect(cardinality.state).toBe("unknown");
    expect(cardinality.state).not.toBe("complete");
  });

  it("reads a different limit value when the server echoed a different default", () => {
    // The same rowCount is bounded against one echoed limit and NOT
    // bounded against a different one — proves the derivation reads
    // criteria.limit, not a hardcoded constant.
    expect(
      describeOpportunityBound({ rowCount: 10, criteria: { limit: 10 } }).state,
    ).toBe("bounded");
    expect(
      describeOpportunityBound({ rowCount: 10, criteria: { limit: 50 } }).state,
    ).toBe("unknown");
  });

  it("collectOpportunityBounds wraps the bound for provenance, empty when not bounded", () => {
    expect(
      collectOpportunityBounds({ rowCount: 25, criteria: { limit: 25 } }),
    ).toHaveLength(1);
    expect(
      collectOpportunityBounds({ rowCount: 3, criteria: { limit: 25 } }),
    ).toEqual([]);
  });
});

/**
 * `gsc-insight-views` task 6.6 — each of the four `GscDiff` buckets labels
 * its OWN bound independently; one bucket at `LIMITS.maxDiffRows` (100)
 * MUST NOT imply another bucket is also at its cap.
 */
describe("describeDiffBucket / collectDiffBounds", () => {
  it("is bounded when a bucket's length equals maxDiffRows", () => {
    const bucket = new Array(100).fill({});
    expect(describeDiffBucket(bucket, 100)).toEqual({
      state: "bounded",
      bound: {
        kind: "sample_cap",
        scope: "diff",
        limitName: "maxDiffRows",
        limitValue: 100,
        shown: 100,
      },
    });
  });

  it("is complete (a real total) below the cap", () => {
    expect(describeDiffBucket(new Array(3).fill({}), 100)).toEqual({
      state: "complete",
      total: 3,
    });
  });

  it("is none for an empty bucket", () => {
    expect(describeDiffBucket([], 100)).toEqual({ state: "none" });
  });

  it("collectDiffBounds derives each bucket independently — one bucket at the cap does not bound the others", () => {
    const result = collectDiffBounds({
      decayed: new Array(100).fill({}),
      improved: [{}],
      lost: [],
      gained: new Array(100).fill({}),
    });
    expect(result.decayed.state).toBe("bounded");
    expect(result.gained.state).toBe("bounded");
    expect(result.improved.state).toBe("complete");
    expect(result.lost.state).toBe("none");
  });
});

/**
 * `history-comparison-view` (PR11) task 11.5 — the crawl family's four
 * array buckets label their OWN bound independently at `maxCrawlDiffRows`,
 * a DIFFERENT limit name than the GSC family's `maxDiffRows` (both happen
 * to be 100 in `src/config.ts`, but the label must never conflate the two
 * limits).
 */
describe("collectCrawlDiffBounds", () => {
  it("derives each bucket independently, naming maxCrawlDiffRows (not maxDiffRows)", () => {
    const result = collectCrawlDiffBounds({
      newPages: new Array(100).fill("https://example.com/x"),
      removedPages: ["https://example.com/gone"],
      newIssues: [],
      resolvedIssues: new Array(100).fill({}),
    });
    expect(result.newPages).toEqual({
      state: "bounded",
      bound: {
        kind: "sample_cap",
        scope: "diff",
        limitName: "maxCrawlDiffRows",
        limitValue: 100,
        shown: 100,
      },
    });
    expect(result.resolvedIssues.state).toBe("bounded");
    expect(result.removedPages).toEqual({ state: "complete", total: 1 });
    expect(result.newIssues).toEqual({ state: "none" });
  });
});

/**
 * `seo-intelligence-view` (PR10) task 10.2 — the bound label must be
 * correct even for a request that OMITTED the limit entirely (threat row
 * h): the BFF resolves the effective value from its own default table, not
 * from anything the tool itself reports.
 */
describe("describeSeoIntelligenceBound", () => {
  it("is bounded when count equals the effective (server-default) limit", () => {
    expect(describeSeoIntelligenceBound(10, 10, "limit")).toEqual({
      state: "bounded",
      bound: {
        kind: "sample_cap",
        scope: "count",
        limitName: "limit",
        limitValue: 10,
        shown: 10,
      },
    });
  });

  it("is unknown (never complete) below the limit — the raw GSC pull cap is undetectable", () => {
    expect(describeSeoIntelligenceBound(3, 10, "limit").state).toBe("unknown");
  });

  it("is none for a zero count", () => {
    expect(describeSeoIntelligenceBound(0, 10, "limit")).toEqual({
      state: "none",
    });
  });
});

/**
 * `seo-intelligence-view` task 10.6 — `CannibalGroup.pages` is capped
 * independently of the group's own `pageCount`.
 */
describe("describeCannibalGroupPagesBound", () => {
  it("is bounded when pages.length < pageCount", () => {
    expect(
      describeCannibalGroupPagesBound(
        { pageCount: 5, pages: [{}, {}] },
        "groups[0].pages",
      ),
    ).toEqual({
      state: "bounded",
      bound: {
        kind: "sample_cap",
        scope: "groups[0].pages",
        limitName: "CannibalGroup.pages",
        limitValue: 2,
        shown: 2,
        total: 5,
      },
    });
  });

  it("is complete when pages.length === pageCount", () => {
    expect(
      describeCannibalGroupPagesBound(
        { pageCount: 2, pages: [{}, {}] },
        "groups[0].pages",
      ),
    ).toEqual({ state: "complete", total: 2 });
  });

  it("is none for an empty pages list", () => {
    expect(
      describeCannibalGroupPagesBound({ pageCount: 0, pages: [] }, "x"),
    ).toEqual({ state: "none" });
  });
});
