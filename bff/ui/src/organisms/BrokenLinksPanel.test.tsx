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
  linksFound: 4,
  truncated: false,
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
          linksFound: 12,
          truncated: false,
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

  it("shows a bound indicator naming both figures when truncated is true", () => {
    render(
      <BrokenLinksPanel
        result={{
          url: "https://example.com",
          pageStatus: 200,
          checked: 40,
          ok: 40,
          broken: 0,
          errors: 0,
          linksFound: 127,
          truncated: true,
          results: [],
        }}
      />,
    );

    const indicator = screen.getByTestId("bound-indicator");
    expect(indicator).toHaveTextContent("40");
    expect(indicator).toHaveTextContent("127");
  });

  it("shows no bound indicator when truncated is false, even at the exact limit", () => {
    render(
      <BrokenLinksPanel
        result={{
          url: "https://example.com",
          pageStatus: 200,
          checked: 40,
          ok: 40,
          broken: 0,
          errors: 0,
          linksFound: 40,
          truncated: false,
          results: [],
        }}
      />,
    );

    expect(screen.queryByTestId("bound-indicator")).not.toBeInTheDocument();
  });
});
