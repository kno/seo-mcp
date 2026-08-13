import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { GscQueryResult } from "../../../../src/types";
import { SearchConsoleTable } from "./SearchConsoleTable";

const RESULT: GscQueryResult = {
  siteUrl: "sc-domain:example.com",
  startDate: "2026-07-16",
  endDate: "2026-08-13",
  dimensions: ["query", "page"],
  rowCount: 2,
  rows: [
    {
      keys: ["seo tool", "https://example.com/tools"],
      clicks: 120,
      impressions: 4000,
      ctr: 0.03,
      position: 5.2,
    },
    {
      keys: ["site crawler", "https://example.com/crawler"],
      clicks: 40,
      impressions: 1000,
      ctr: 0.04,
      position: 8.1,
    },
  ],
};

describe("SearchConsoleTable — renders the real GscRow shape", () => {
  it("shows one column per dimension plus clicks, impressions, ctr, and position", () => {
    render(<SearchConsoleTable result={RESULT} />);
    const table = screen.getByRole("table");

    expect(table).toHaveTextContent("query");
    expect(table).toHaveTextContent("page");
    expect(table).toHaveTextContent("clicks");
    expect(table).toHaveTextContent("impressions");
    expect(table).toHaveTextContent("ctr");
    expect(table).toHaveTextContent("position");
  });

  it("renders each row's keys, clicks, impressions, ctr, and position", () => {
    render(<SearchConsoleTable result={RESULT} />);

    expect(screen.getByText("seo tool")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/tools")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("4000")).toBeInTheDocument();
    expect(screen.getByText("8.1")).toBeInTheDocument();
  });

  it("renders ctr as a formatted percentage, not recomputed from clicks/impressions", () => {
    render(<SearchConsoleTable result={RESULT} />);
    expect(screen.getByText("3.00%")).toBeInTheDocument();
    expect(screen.getByText("4.00%")).toBeInTheDocument();
  });

  it("renders exactly one column per selected dimension when only one dimension was used", () => {
    const singleDimension: GscQueryResult = {
      ...RESULT,
      dimensions: ["country"],
      rows: [
        { keys: ["USA"], clicks: 10, impressions: 100, ctr: 0.1, position: 3 },
      ],
    };
    render(<SearchConsoleTable result={singleDimension} />);
    expect(
      screen.getByRole("columnheader", { name: "country" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "query" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("USA")).toBeInTheDocument();
  });
});
