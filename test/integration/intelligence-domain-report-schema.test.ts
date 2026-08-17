import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/seo/intelligence", () => ({
  findKeywordCannibalization: vi.fn(),
  findSeoOpportunities: vi.fn(),
}));
vi.mock("../../src/seo/keyword-pages", () => ({
  mapKeywordsToPagesForSite: vi.fn(),
  findContentGapsForSite: vi.fn(),
}));
vi.mock("../../src/seo/domain-report", () => ({
  analyzeDomain: vi.fn(),
}));
vi.mock("../../src/google/credentials", () => ({
  resolveSiteCredentials: vi.fn().mockResolvedValue({
    credentials: { clientId: "c", clientSecret: "s", refreshToken: "r" },
    source: "global",
    accountKey: "global",
    accountLabel: null,
  }),
}));

import {
  findKeywordCannibalization,
  findSeoOpportunities,
} from "../../src/seo/intelligence";
import {
  mapKeywordsToPagesForSite,
  findContentGapsForSite,
} from "../../src/seo/keyword-pages";
import { analyzeDomain } from "../../src/seo/domain-report";
import { buildServer } from "../../src/server";
import {
  findKeywordCannibalizationResultSchema,
  findSeoOpportunitiesResultSchema,
  mapKeywordsToPagesResultSchema,
  findContentGapsResultSchema,
} from "../../src/schemas/intelligence";
import { domainReportSchema } from "../../src/schemas/domain-report";

type ToolHandle = {
  outputSchema?: unknown;
  handler: (
    args: unknown,
    ctx: unknown,
  ) => Promise<{
    isError?: boolean;
    content: unknown[];
    structuredContent?: unknown;
  }>;
};

function registeredTool(name: string): ToolHandle {
  const server = buildServer({});
  return (server as unknown as { _registeredTools: Record<string, ToolHandle> })
    ._registeredTools[name];
}

function opportunity(overrides: Partial<Record<string, unknown>> = {}): {
  type: "low_ctr" | "striking_distance" | "cannibalization";
  query: string;
  page: string | null;
  impressions: number;
  currentPosition: number | null;
  impact: number;
  effort: number;
  priorityScore: number;
  recommendation: string;
} {
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

describe("find_keyword_cannibalization registration exposes an outputSchema", () => {
  it("declares outputSchema as the published findKeywordCannibalizationResultSchema", () => {
    const tool = registeredTool("find_keyword_cannibalization");
    expect(tool.outputSchema).toBe(findKeywordCannibalizationResultSchema);
  });

  it("round-trips a real result through structuredContent", async () => {
    const result = {
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
          pages: [
            {
              page: "https://example.com/a",
              clicks: 12,
              impressions: 340,
              position: 4.2,
            },
          ],
        },
      ],
    };
    vi.mocked(findKeywordCannibalization).mockResolvedValue(result);

    const tool = registeredTool("find_keyword_cannibalization");
    const response = await tool.handler(
      {
        siteUrl: "sc-domain:example.com",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      },
      {},
    );

    expect(response.isError).toBeUndefined();
    expect(response.structuredContent).toEqual(result);
    expect(
      findKeywordCannibalizationResultSchema.parse(response.structuredContent),
    ).toEqual(result);
  });
});

describe("find_seo_opportunities registration exposes an outputSchema", () => {
  it("declares outputSchema as the published findSeoOpportunitiesResultSchema", () => {
    const tool = registeredTool("find_seo_opportunities");
    expect(tool.outputSchema).toBe(findSeoOpportunitiesResultSchema);
  });

  it("round-trips a real result through structuredContent", async () => {
    const result = {
      siteUrl: "sc-domain:example.com",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      count: 1,
      opportunities: [opportunity()],
    };
    vi.mocked(findSeoOpportunities).mockResolvedValue(result);

    const tool = registeredTool("find_seo_opportunities");
    const response = await tool.handler(
      {
        siteUrl: "sc-domain:example.com",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      },
      {},
    );

    expect(response.isError).toBeUndefined();
    expect(response.structuredContent).toEqual(result);
    expect(
      findSeoOpportunitiesResultSchema.parse(response.structuredContent),
    ).toEqual(result);
  });
});

describe("map_keywords_to_pages registration exposes an outputSchema", () => {
  it("declares outputSchema as the published mapKeywordsToPagesResultSchema", () => {
    const tool = registeredTool("map_keywords_to_pages");
    expect(tool.outputSchema).toBe(mapKeywordsToPagesResultSchema);
  });

  it("round-trips a real result through structuredContent", async () => {
    const result = {
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
    vi.mocked(mapKeywordsToPagesForSite).mockResolvedValue(result);

    const tool = registeredTool("map_keywords_to_pages");
    const response = await tool.handler(
      {
        siteUrl: "sc-domain:example.com",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      },
      {},
    );

    expect(response.isError).toBeUndefined();
    expect(response.structuredContent).toEqual(result);
    expect(
      mapKeywordsToPagesResultSchema.parse(response.structuredContent),
    ).toEqual(result);
  });
});

describe("find_content_gaps registration exposes an outputSchema", () => {
  it("declares outputSchema as the published findContentGapsResultSchema", () => {
    const tool = registeredTool("find_content_gaps");
    expect(tool.outputSchema).toBe(findContentGapsResultSchema);
  });

  it("round-trips a real result through structuredContent", async () => {
    const result = {
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
    vi.mocked(findContentGapsForSite).mockResolvedValue(result);

    const tool = registeredTool("find_content_gaps");
    const response = await tool.handler(
      {
        siteUrl: "sc-domain:example.com",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      },
      {},
    );

    expect(response.isError).toBeUndefined();
    expect(response.structuredContent).toEqual(result);
    expect(
      findContentGapsResultSchema.parse(response.structuredContent),
    ).toEqual(result);
  });
});

describe("analyze_domain registration exposes an outputSchema", () => {
  it("declares outputSchema as the published domainReportSchema", () => {
    const tool = registeredTool("analyze_domain");
    expect(tool.outputSchema).toBe(domainReportSchema);
  });

  it("round-trips a real DomainReport (search present, no gscError) through structuredContent", async () => {
    const result = {
      url: "https://example.com",
      crawl: {
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
      },
      search: {
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        opportunities: [opportunity()],
      },
    };
    vi.mocked(analyzeDomain).mockResolvedValue(result);

    const tool = registeredTool("analyze_domain");
    const response = await tool.handler({ url: "https://example.com" }, {});

    expect(response.isError).toBeUndefined();
    expect(response.structuredContent).toEqual(result);
    expect(domainReportSchema.parse(response.structuredContent)).toEqual(
      result,
    );
  });

  it("surfaces a result with both search and gscError as a tool failure (schema-enforced mutual exclusivity)", async () => {
    vi.mocked(analyzeDomain).mockResolvedValue({
      url: "https://example.com",
      crawl: {
        sitemapFound: true,
        crawled: 0,
        failed: 0,
        issueCounts: {},
        summary: {
          pagesAnalyzed: 0,
          duplicateTitles: [],
          duplicateDescriptions: [],
          missingH1: { count: 0, sample: [] },
          multipleH1: { count: 0, sample: [] },
          thinContent: { count: 0, sample: [] },
          nonIndexable: { count: 0, sample: [] },
          imagesMissingAlt: { pages: 0, images: 0 },
        },
        crawlPolicy: {
          robotsUrl: "https://example.com/robots.txt",
          robotsFound: true,
          userAgent: "seo-mcp",
          sitemapsDeclared: [],
          disallowedSkipped: { count: 0, sample: [] },
        },
        linkGraph: {
          crawledPages: 0,
          orphanPages: { count: 0, sample: [] },
          topLinkedPages: [],
        },
      },
      search: {
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        opportunities: [],
      },
      gscError: "Google credentials are not configured",
    } as never);

    const tool = registeredTool("analyze_domain");
    const response = await tool.handler({ url: "https://example.com" }, {});

    expect(response.isError).toBe(true);
  });
});
