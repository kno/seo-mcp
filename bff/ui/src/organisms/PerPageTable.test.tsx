import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SiteCrawlResult } from "../../../../src/types";
import { PerPageTable } from "./PerPageTable";

const OK_RESULT: SiteCrawlResult["pages"][number]["result"] = {
  url: "https://example.com/a",
  status: 200,
  bytesRead: 100,
  title: "A",
  description: "desc",
  h1: [],
  h2: [],
  h3: [],
  internalLinks: 1,
  externalLinks: 0,
  imageCount: 0,
  imagesMissingAlt: 0,
  openGraph: {},
  jsonLd: { blocks: 0, types: [], invalid: 0 },
  wordCount: 10,
  indexable: true,
  issues: [{ code: "missing_h1", severity: "warning", message: "no h1" }],
  linkCount: 1,
};

describe("PerPageTable", () => {
  it("shows the crawl error, not a fabricated issue count, for a failed page", () => {
    render(
      <PerPageTable
        pages={[{ url: "https://example.com/b", error: "Timed out" }]}
        onDrillDown={vi.fn()}
      />,
    );
    expect(screen.getByText("Timed out")).toBeInTheDocument();
    expect(
      screen.queryByTestId("issue-count-https://example.com/b"),
    ).not.toBeInTheDocument();
  });

  it("shows the issue count for a successfully crawled page", () => {
    render(
      <PerPageTable
        pages={[{ url: "https://example.com/a", result: OK_RESULT }]}
        onDrillDown={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("issue-count-https://example.com/a"),
    ).toHaveTextContent("1");
  });

  it("opens the page report with the row's own in-memory result data, issuing no new request, when drill-down is activated", async () => {
    const onDrillDown = vi.fn();
    const user = userEvent.setup();
    render(
      <PerPageTable
        pages={[{ url: "https://example.com/a", result: OK_RESULT }]}
        onDrillDown={onDrillDown}
      />,
    );

    await user.click(screen.getByRole("button", { name: /view report/i }));

    expect(onDrillDown).toHaveBeenCalledTimes(1);
    expect(onDrillDown).toHaveBeenCalledWith(OK_RESULT);
  });

  it("does not offer a drill-down action for a failed page", () => {
    render(
      <PerPageTable
        pages={[{ url: "https://example.com/b", error: "Timed out" }]}
        onDrillDown={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /view report/i }),
    ).not.toBeInTheDocument();
  });
});
