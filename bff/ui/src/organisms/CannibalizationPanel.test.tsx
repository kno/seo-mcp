import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CannibalizationPanel } from "./CannibalizationPanel";
import type { CannibalGroup } from "../../../../src/schemas/intelligence";

describe("CannibalizationPanel", () => {
  it("renders page, clicks, impressions and position for every page (task 10.6)", () => {
    const group: CannibalGroup = {
      query: "seo mcp",
      pageCount: 2,
      totalImpressions: 300,
      totalClicks: 20,
      pages: [
        { page: "/a", clicks: 12, impressions: 200, position: 5.1 },
        { page: "/b", clicks: 8, impressions: 100, position: 8.4 },
      ],
    };
    render(<CannibalizationPanel groups={[group]} />);
    expect(screen.getByText("/a")).toBeInTheDocument();
    expect(screen.getByText("/b")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("5.1")).toBeInTheDocument();
  });

  it("labels the subset as bounded when pages.length < pageCount (task 10.6)", () => {
    const group: CannibalGroup = {
      query: "seo mcp",
      pageCount: 5,
      totalImpressions: 300,
      totalClicks: 20,
      pages: [{ page: "/a", clicks: 12, impressions: 200, position: 5.1 }],
    };
    render(<CannibalizationPanel groups={[group]} />);
    expect(screen.getByTestId("sample-badge")).toBeInTheDocument();
  });

  it("does not render a bound label when the full pages list is present", () => {
    const group: CannibalGroup = {
      query: "seo mcp",
      pageCount: 1,
      totalImpressions: 300,
      totalClicks: 20,
      pages: [{ page: "/a", clicks: 12, impressions: 200, position: 5.1 }],
    };
    render(<CannibalizationPanel groups={[group]} />);
    expect(screen.queryByTestId("sample-badge")).not.toBeInTheDocument();
  });

  it("gives every page a page-report drill-down link", () => {
    const group: CannibalGroup = {
      query: "seo mcp",
      pageCount: 1,
      totalImpressions: 300,
      totalClicks: 20,
      pages: [{ page: "/a", clicks: 12, impressions: 200, position: 5.1 }],
    };
    render(<CannibalizationPanel groups={[group]} />);
    expect(screen.getByRole("link", { name: "/a" })).toHaveAttribute(
      "href",
      "#page-report",
    );
  });
});
