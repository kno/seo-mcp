import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CrawlPolicy } from "../../../../src/types";
import { CrawlPolicyPanel } from "./CrawlPolicyPanel";

function policy(overrides: Partial<CrawlPolicy> = {}): CrawlPolicy {
  return {
    robotsUrl: "https://example.com/robots.txt",
    robotsFound: true,
    userAgent: "seo-mcp",
    sitemapsDeclared: [],
    disallowedSkipped: { count: 0, sample: [] },
    ...overrides,
  };
}

describe("CrawlPolicyPanel", () => {
  it("indicates distinctly when no robots.txt was found", () => {
    render(<CrawlPolicyPanel crawlPolicy={policy({ robotsFound: false })} />);
    expect(screen.getByTestId("robots-status")).toHaveTextContent(
      /no robots\.txt/i,
    );
  });

  it("indicates distinctly when robots.txt was found", () => {
    render(<CrawlPolicyPanel crawlPolicy={policy({ robotsFound: true })} />);
    expect(screen.getByTestId("robots-status")).toHaveTextContent(
      /robots\.txt found/i,
    );
    expect(screen.getByTestId("robots-status")).not.toHaveTextContent(
      /no robots\.txt/i,
    );
  });

  it("shows the disallowed-skipped count and sample, labeled as a sample when count exceeds the sample", () => {
    render(
      <CrawlPolicyPanel
        crawlPolicy={policy({
          disallowedSkipped: { count: 7, sample: ["/admin", "/secret"] },
        })}
      />,
    );
    expect(screen.getByTestId("disallowed-skipped-count")).toHaveTextContent(
      "7",
    );
    expect(screen.getByText("/admin")).toBeInTheDocument();
    expect(screen.getByTestId("sample-badge")).toBeInTheDocument();
  });
});
