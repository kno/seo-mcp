import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LinkCheckResult } from "../../../../src/types";
import { BrokenLinksPanel } from "./BrokenLinksPanel";

const RESULT: LinkCheckResult = {
  url: "https://example.com",
  pageStatus: 200,
  checked: 4,
  ok: 2,
  broken: 1,
  errors: 1,
  results: [
    { url: "https://example.com/a", state: "ok", status: 200 },
    { url: "https://example.com/b", state: "ok", status: 200 },
    { url: "https://example.com/dead", state: "broken", status: 404 },
    {
      url: "https://example.com/timeout",
      state: "error",
      error: "Link probe timed out",
    },
  ],
};

describe("BrokenLinksPanel", () => {
  it("renders all four counts as distinct, simultaneously visible figures", () => {
    render(<BrokenLinksPanel result={RESULT} />);

    expect(screen.getByTestId("links-checked")).toHaveTextContent("4");
    expect(screen.getByTestId("links-ok")).toHaveTextContent("2");
    expect(screen.getByTestId("links-broken")).toHaveTextContent("1");
    expect(screen.getByTestId("links-errors")).toHaveTextContent("1");
  });

  it("shows zero broken alongside checked, not as an unqualified 'no broken links'", () => {
    render(
      <BrokenLinksPanel
        result={{
          url: "https://example.com",
          pageStatus: 200,
          checked: 12,
          ok: 12,
          broken: 0,
          errors: 0,
          results: [],
        }}
      />,
    );

    expect(screen.getByTestId("links-checked")).toHaveTextContent("12");
    expect(screen.getByTestId("links-broken")).toHaveTextContent("0");
  });

  it("renders broken and error probes distinctly", () => {
    render(<BrokenLinksPanel result={RESULT} />);

    expect(screen.getByTestId("badge-broken")).toBeInTheDocument();
    expect(screen.getByTestId("badge-error")).toBeInTheDocument();
    expect(screen.getByText("404")).toBeInTheDocument();
    expect(screen.getByText("Link probe timed out")).toBeInTheDocument();
  });
});
