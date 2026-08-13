import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DomainSummary } from "../../../../src/types";
import { DomainSummaryPanel } from "./DomainSummaryPanel";

function summary(overrides: Partial<DomainSummary> = {}): DomainSummary {
  return {
    pagesAnalyzed: 12,
    duplicateTitles: [],
    duplicateDescriptions: [],
    missingH1: { count: 0, sample: [] },
    multipleH1: { count: 0, sample: [] },
    thinContent: { count: 0, sample: [] },
    nonIndexable: { count: 0, sample: [] },
    imagesMissingAlt: { pages: 0, images: 0 },
    ...overrides,
  };
}

describe("DomainSummaryPanel", () => {
  it("shows each duplicate group's value, count and sample", () => {
    render(
      <DomainSummaryPanel
        summary={summary({
          duplicateTitles: [
            { value: "Home", count: 3, sample: ["/a", "/b", "/c"] },
          ],
        })}
      />,
    );

    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("/a")).toBeInTheDocument();
    expect(screen.getByText(/3 page/)).toBeInTheDocument();
  });

  it("renders a category count of 0 explicitly rather than omitting the category", () => {
    render(<DomainSummaryPanel summary={summary()} />);
    expect(screen.getByTestId("missing-h1-count")).toHaveTextContent("0");
  });

  it("shows both page and image counts for imagesMissingAlt", () => {
    render(
      <DomainSummaryPanel
        summary={summary({ imagesMissingAlt: { pages: 3, images: 12 } })}
      />,
    );
    expect(screen.getByTestId("images-missing-alt-pages")).toHaveTextContent(
      "3",
    );
    expect(screen.getByTestId("images-missing-alt-images")).toHaveTextContent(
      "12",
    );
  });

  it("labels a duplicate group's sample as a sample when count exceeds the sample length", () => {
    render(
      <DomainSummaryPanel
        summary={summary({
          duplicateTitles: [
            {
              value: "Home",
              count: 15,
              sample: Array.from({ length: 10 }, (_, i) => `/p${i}`),
            },
          ],
        })}
      />,
    );
    expect(screen.getByTestId("sample-badge")).toBeInTheDocument();
  });

  it("does not label an uncapped category as a sample", () => {
    render(
      <DomainSummaryPanel
        summary={summary({
          nonIndexable: { count: 2, sample: ["/a", "/b"] },
        })}
      />,
    );
    expect(screen.queryByTestId("sample-badge")).not.toBeInTheDocument();
  });
});
