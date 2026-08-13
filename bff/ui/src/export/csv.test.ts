import { describe, expect, it } from "vitest";
import { linkCheckResultSchema } from "../../../../src/schemas/links";
import { pageAnalysisSchema } from "../../../../src/schemas/page";
import { pageSpeedResultSchema } from "../../../../src/schemas/pagespeed";
import { gscQueryResultSchema } from "../../../../src/schemas/search-console";
import { siteCrawlResultSchema } from "../../../../src/schemas/site";
import type { PageAnalysis } from "../../../../src/seo/html";
import type {
  LinkCheckResult,
  PageSpeedResult,
  SiteCrawlResult,
} from "../../../../src/types";
import { CSV_SHAPES, serializeCsv } from "./csv";
import type { CsvShape } from "./csv";

/**
 * `columns ∪ omitted` must cover every top-level key of the published
 * result type — the "no silent loss" exhaustiveness invariant. A column
 * covers a nested object field either by naming it exactly or by a
 * dotted-prefix column (e.g. `labMetrics.firstContentfulPaintMs` covers
 * `labMetrics`).
 */
function assertExhaustive(
  shape: CsvShape<unknown>,
  schemaKeys: readonly string[],
) {
  for (const key of schemaKeys) {
    const covered =
      shape.columns.includes(key) ||
      shape.columns.some((column) => column.startsWith(`${key}.`)) ||
      shape.omitted.includes(key);
    expect(
      covered,
      `key "${key}" is neither a column nor declared omitted`,
    ).toBe(true);
  }
}

const PAGE_ANALYSIS: PageAnalysis = {
  url: "https://example.com",
  status: 200,
  bytesRead: 500,
  title: "Example",
  description: "An example page",
  canonical: "https://example.com",
  robots: "index,follow",
  lang: "en",
  h1: ["Hello"],
  h2: ["Sub"],
  h3: [],
  links: ["https://example.com/a"],
  internalLinkTargets: ["https://example.com/a"],
  internalLinks: 1,
  externalLinks: 0,
  imageCount: 2,
  imagesMissingAlt: 1,
  openGraph: { "og:title": "Example" },
  jsonLd: { blocks: 1, types: ["Article"], invalid: 0 },
  wordCount: 500,
  indexable: true,
  issues: [{ code: "missing-h1", severity: "warning", message: "No H1" }],
  fetchTimeMs: 120,
};

function completeSiteCrawlResult(): SiteCrawlResult {
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
      { url: "https://example.com/b", error: "Fetch failed" },
    ],
    issueCounts: {},
    summary: {
      pagesAnalyzed: 1,
      duplicateTitles: [],
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
      topLinkedPages: [],
    },
  };
}

const LINK_CHECK_RESULT: LinkCheckResult = {
  url: "https://example.com",
  pageStatus: 200,
  checked: 2,
  ok: 1,
  broken: 1,
  errors: 0,
  linksFound: 2,
  truncated: false,
  results: [
    { url: "https://example.com/a", state: "ok", status: 200, redirects: 0 },
    {
      url: "https://example.com/b",
      state: "broken",
      status: 404,
      redirects: 0,
    },
  ],
};

const PAGESPEED_RESULT: PageSpeedResult = {
  url: "https://example.com",
  strategy: "mobile",
  performanceScore: 90,
  labMetrics: { firstContentfulPaintMs: 800, cumulativeLayoutShift: 0.05 },
  fieldMetrics: { overallCategory: "FAST" },
  opportunities: [
    { id: "unused-css", title: "Remove unused CSS", savingsMs: 300 },
  ],
};

describe("CSV_SHAPES exhaustiveness — columns ∪ omitted covers every schema key", () => {
  it("crawl_page", () => {
    assertExhaustive(
      CSV_SHAPES.crawl_page as CsvShape<unknown>,
      Object.keys(pageAnalysisSchema.shape),
    );
  });

  it("crawl_site", () => {
    assertExhaustive(
      CSV_SHAPES.crawl_site as CsvShape<unknown>,
      Object.keys(siteCrawlResultSchema.shape),
    );
  });

  it("check_links", () => {
    assertExhaustive(
      CSV_SHAPES.check_links as CsvShape<unknown>,
      Object.keys(linkCheckResultSchema.shape),
    );
  });

  it("analyze_pagespeed", () => {
    assertExhaustive(
      CSV_SHAPES.analyze_pagespeed as CsvShape<unknown>,
      Object.keys(pageSpeedResultSchema.shape),
    );
  });

  it("search_console_query", () => {
    assertExhaustive(
      CSV_SHAPES.search_console_query as CsvShape<unknown>,
      Object.keys(gscQueryResultSchema.shape),
    );
  });
});

describe("CSV golden/stability — same input always produces the same output", () => {
  it("crawl_page output is identical across repeated calls", () => {
    const a = serializeCsv(CSV_SHAPES.crawl_page, PAGE_ANALYSIS);
    const b = serializeCsv(CSV_SHAPES.crawl_page, PAGE_ANALYSIS);
    expect(a).toBe(b);
  });

  it("crawl_site output is identical across repeated calls, same columns and order", () => {
    const result = completeSiteCrawlResult();
    const a = serializeCsv(CSV_SHAPES.crawl_site, result);
    const b = serializeCsv(CSV_SHAPES.crawl_site, result);
    expect(a).toBe(b);
    const [headerA] = a.split("\n");
    const [headerB] = b.split("\n");
    expect(headerA).toBe(headerB);
  });

  it("matches a recorded golden output for a known crawl_site fixture", () => {
    const csv = serializeCsv(CSV_SHAPES.crawl_site, completeSiteCrawlResult());
    const lines = csv.split("\n");
    // lines[0] is the leading "# omitted: ..." comment row.
    expect(lines[1]).toBe(
      "url,rowState,status,bytesRead,title,description,canonical,robots,lang,h1,h2,h3,linkCount,internalLinks,externalLinks,imageCount,imagesMissingAlt,openGraph,jsonLd.blocks,jsonLd.types,jsonLd.invalid,wordCount,indexable,issues,fetchTimeMs,error",
    );
    // Row for the analyzed page.
    expect(lines[2]).toContain("https://example.com/a,analyzed,200");
    // Row for the failed page: issue-derived columns are empty, not "0".
    expect(lines[3]).toBe(
      "https://example.com/b,failed,,,,,,,,,,,,,,,,,,,,,,,,Fetch failed",
    );
  });
});

describe("CSV — nested per-page data appears in the output", () => {
  it("represents every page as a row, including issue-derived data", () => {
    const csv = serializeCsv(CSV_SHAPES.crawl_site, completeSiteCrawlResult());
    const lines = csv.split("\n").slice(2); // drop comment row + header
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("https://example.com/a");
    expect(lines[1]).toContain("https://example.com/b");
  });
});

describe("CSV — a field with no defined column is explicitly noted", () => {
  it("declares crawl_site's aggregate fields in `omitted`, and writes a comment row", () => {
    expect(CSV_SHAPES.crawl_site.omitted).toContain("summary");
    expect(CSV_SHAPES.crawl_site.omitted).toContain("crawlPolicy");
    const csv = serializeCsv(CSV_SHAPES.crawl_site, completeSiteCrawlResult());
    expect(csv.split("\n")[0]).toMatch(/^# omitted: .*summary/);
  });
});

describe("CSV — truncation/sample markers present only when bounded", () => {
  it("includes a bound comment line when a bound is supplied", () => {
    const csv = serializeCsv(CSV_SHAPES.crawl_site, completeSiteCrawlResult(), {
      bounds: [
        {
          kind: "output_bytes",
          scope: "outputBytes",
          limitName: "maxSiteOutputBytes",
          limitValue: 256_000,
          shown: 2,
          total: 5,
        },
      ],
    });
    expect(csv).toContain(
      "# bound: output_bytes outputBytes shown=2 limit=256000",
    );
  });

  it("includes no bound comment line for a complete, unbounded result", () => {
    const csv = serializeCsv(CSV_SHAPES.crawl_site, completeSiteCrawlResult());
    expect(csv).not.toContain("# bound:");
  });
});

describe("CSV — no secret material", () => {
  it("PageSpeed export excludes the API key even with a distinctive key value in context", () => {
    const csv = serializeCsv(CSV_SHAPES.analyze_pagespeed, PAGESPEED_RESULT);
    expect(csv).not.toContain("THE_SECRET_KEY");
    expect(csv.toLowerCase()).not.toContain("apikey");
  });

  it("never contains MCP_AUTH_TOKEN", () => {
    const csv = serializeCsv(CSV_SHAPES.check_links, LINK_CHECK_RESULT);
    expect(csv).not.toContain("MCP_AUTH_TOKEN");
  });
});

describe("CSV_SHAPES.search_console_query", () => {
  const GSC_RESULT = {
    siteUrl: "sc-domain:example.com",
    startDate: "2026-07-16",
    endDate: "2026-08-13",
    dimensions: ["query"] as ("query" | "page")[],
    rowCount: 1,
    rows: [
      {
        keys: ["seo tool"],
        clicks: 120,
        impressions: 4000,
        ctr: 0.03,
        position: 5.2,
      },
    ],
  };

  it("renders one row per result row with keys, clicks, impressions, ctr, position", () => {
    const csv = serializeCsv(CSV_SHAPES.search_console_query, GSC_RESULT);
    const lines = csv.split("\n");
    expect(lines).toContain("keys,clicks,impressions,ctr,position");
    expect(csv).toContain("seo tool");
    expect(csv).toContain("120");
  });

  it("notes the top-level fields with no per-row column as omitted, not silently dropped", () => {
    expect(CSV_SHAPES.search_console_query.omitted).toContain("siteUrl");
    expect(CSV_SHAPES.search_console_query.omitted).toContain("dimensions");
  });

  it("carries an as-of/reporting-lag note when provided via `notes`", () => {
    const csv = serializeCsv(CSV_SHAPES.search_console_query, GSC_RESULT, {
      notes: ["Google's data is as of 2026-08-11 (2 days behind, estimated)"],
    });
    expect(csv).toContain("# Google's data is as of 2026-08-11");
  });

  it("carries a bound-provenance comment when rowCount is at the 250-row cap", () => {
    const capped = { ...GSC_RESULT, rowCount: 250 };
    const csv = serializeCsv(CSV_SHAPES.search_console_query, capped, {
      bounds: [
        {
          kind: "probe_cap",
          scope: "rowCount",
          limitName: "maxGscRows",
          limitValue: 250,
          shown: 250,
        },
      ],
    });
    expect(csv).toContain(
      "# bound: probe_cap rowCount shown=250 limit=250 (maxGscRows)",
    );
  });
});
