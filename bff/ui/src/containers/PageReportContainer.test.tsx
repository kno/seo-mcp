import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PageAnalysis } from "../../../../src/types";
import { PageReportContainer } from "./PageReportContainer";

const SAMPLE_ANALYSIS: PageAnalysis = {
  url: "https://example.com",
  status: 200,
  bytesRead: 1234,
  title: "Example",
  description: "An example page",
  canonical: "https://example.com",
  robots: "index,follow",
  lang: "en",
  // Distinct from `title` on purpose: a real page's <title> and <h1> text
  // usually differ, and using the same string for both masked a real
  // ambiguous-query bug (`findByText("Example")` matched both nodes).
  h1: ["Welcome"],
  h2: [],
  h3: [],
  links: [],
  internalLinkTargets: [],
  internalLinks: 5,
  externalLinks: 1,
  imageCount: 0,
  imagesMissingAlt: 0,
  openGraph: {},
  jsonLd: { blocks: 0, types: [], invalid: 0 },
  wordCount: 300,
  indexable: true,
  issues: [],
};

describe("PageReportContainer", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("does not fetch on mount — fetching is gated on an explicit user submission", () => {
    render(<PageReportContainer />);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("fetches only after an explicit form submission and renders the report", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      json: () =>
        Promise.resolve({
          data: SAMPLE_ANALYSIS,
          cacheStatus: "miss",
          resultAge: 0,
        }),
    } as Response);

    const user = userEvent.setup();
    render(<PageReportContainer />);

    expect(global.fetch).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/page url/i), "https://example.com");
    await user.click(screen.getByRole("button", { name: /get report/i }));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Example")).toBeInTheDocument();
    expect(screen.getByText("An example page")).toBeInTheDocument();
  });

  it("shows the shared error-state presentation, never an empty-looking successful report, when crawl_page fails", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      json: () =>
        Promise.resolve({
          error: { code: "upstream_unavailable", message: "down" },
        }),
    } as Response);

    const user = userEvent.setup();
    render(<PageReportContainer />);

    await user.type(screen.getByLabelText(/page url/i), "https://example.com");
    await user.click(screen.getByRole("button", { name: /get report/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /temporarily unavailable/i,
    );
    // The failure must not render any card/panel/list as if data existed.
    expect(screen.queryByTestId("onpage-canonical")).not.toBeInTheDocument();
    expect(screen.queryByText(/no issues detected/i)).not.toBeInTheDocument();
  });

  it("offers the broken-links check for the submitted URL as soon as it is submitted, per broken-links-view's spec, even before crawl_page resolves", async () => {
    vi.mocked(global.fetch).mockImplementation(
      () => new Promise(() => {}), // crawl_page never resolves in this test
    );

    const user = userEvent.setup();
    render(<PageReportContainer />);

    await user.type(screen.getByLabelText(/page url/i), "https://example.com");
    await user.click(screen.getByRole("button", { name: /get report/i }));

    // The check-links control exists independent of crawl_page's outcome —
    // opening the report must not itself issue a check_links request.
    expect(
      screen.getByRole("button", { name: /check links/i }),
    ).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
