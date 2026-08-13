import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DomainReportPanel } from "./DomainReportPanel";
import type { DomainReportCrawl } from "../../../../src/schemas/domain-report";

const CRAWL: DomainReportCrawl = {
  sitemapFound: true,
  crawled: 3,
  failed: 0,
  issueCounts: {},
  summary: {
    pagesAnalyzed: 3,
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
    crawledPages: 3,
    orphanPages: { count: 0, sample: [] },
    topLinkedPages: [],
  },
};

/**
 * Task 10.8: the three enrichment states must render distinctly, and a
 * classified failure must never collapse into the not-requested state.
 */
describe("DomainReportPanel enrichment states", () => {
  it("renders 'not-requested' when neither search nor enrichmentError is present", () => {
    render(<DomainReportPanel url="https://example.com" crawl={CRAWL} />);
    const region = screen.getByTestId("domain-report-enrichment-state");
    expect(region.dataset.enrichmentState).toBe("not-requested");
    expect(
      screen.getByTestId("domain-report-enrichment-not-requested"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("domain-report-enrichment-error"),
    ).not.toBeInTheDocument();
  });

  it("renders 'succeeded' distinctly when search is present", () => {
    render(
      <DomainReportPanel
        url="https://example.com"
        crawl={CRAWL}
        search={{
          startDate: "2026-07-01",
          endDate: "2026-07-28",
          opportunities: [],
        }}
      />,
    );
    const region = screen.getByTestId("domain-report-enrichment-state");
    expect(region.dataset.enrichmentState).toBe("succeeded");
    expect(
      screen.queryByTestId("domain-report-enrichment-not-requested"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("domain-report-enrichment-error"),
    ).not.toBeInTheDocument();
  });

  it("renders a classified failure distinctly — never collapsing into not-requested", () => {
    render(
      <DomainReportPanel
        url="https://example.com"
        crawl={CRAWL}
        enrichmentError={{ code: "upstream_credential_failure" }}
      />,
    );
    const region = screen.getByTestId("domain-report-enrichment-state");
    expect(region.dataset.enrichmentState).toBe("failed");
    expect(
      screen.getByTestId("domain-report-enrichment-error"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("domain-report-enrichment-not-requested"),
    ).not.toBeInTheDocument();
  });

  it("gives the crawl portion its own site-crawl drill-down link (task 10.11)", () => {
    render(<DomainReportPanel url="https://example.com" crawl={CRAWL} />);
    expect(
      screen.getByRole("link", { name: /view full site crawl/i }),
    ).toHaveAttribute("href", "#site-crawl");
  });
});
