import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LinkGraphSummary } from "../../../../src/types";
import { LinkGraphPanel } from "./LinkGraphPanel";

function linkGraph(
  overrides: Partial<LinkGraphSummary> = {},
): LinkGraphSummary {
  return {
    crawledPages: 12,
    orphanPages: { count: 0, sample: [] },
    topLinkedPages: [],
    ...overrides,
  };
}

describe("LinkGraphPanel", () => {
  it("shows zero orphan pages as a positive finding, distinct from any empty/truncated state", () => {
    render(<LinkGraphPanel linkGraph={linkGraph()} />);
    expect(screen.getByTestId("orphan-pages")).toHaveTextContent(
      /no orphan pages/i,
    );
  });

  it("shows each most-linked page's URL and inbound count in the result's order", () => {
    render(
      <LinkGraphPanel
        linkGraph={linkGraph({
          topLinkedPages: [
            { url: "https://example.com/a", inbound: 9 },
            { url: "https://example.com/b", inbound: 3 },
          ],
        })}
      />,
    );
    expect(screen.getByText("https://example.com/a")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/b")).toBeInTheDocument();
  });

  it("labels orphan pages as a sample when the count exceeds the sample shown", () => {
    render(
      <LinkGraphPanel
        linkGraph={linkGraph({
          orphanPages: {
            count: 30,
            sample: Array.from({ length: 25 }, (_, i) => `/orphan-${i}`),
          },
        })}
      />,
    );
    expect(screen.getByTestId("sample-badge")).toBeInTheDocument();
  });
});
