import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SiteCrawlResult } from "../../../../src/types";
import { SiteCrawlContainer } from "./SiteCrawlContainer";

const PAGE_RESULT: NonNullable<SiteCrawlResult["pages"][number]["result"]> = {
  url: "https://example.com/",
  status: 200,
  bytesRead: 500,
  title: "Example Home",
  description: "The example home page",
  h1: ["Welcome"],
  h2: [],
  h3: [],
  internalLinks: 4,
  externalLinks: 1,
  imageCount: 2,
  imagesMissingAlt: 0,
  openGraph: {},
  jsonLd: { blocks: 0, types: [], invalid: 0 },
  wordCount: 200,
  indexable: true,
  issues: [],
  linkCount: 4,
};

const RESULT: SiteCrawlResult = {
  site: "https://example.com",
  sitemap: "https://example.com/sitemap.xml",
  sitemapFound: true,
  crawlPolicy: {
    robotsUrl: "https://example.com/robots.txt",
    robotsFound: true,
    userAgent: "seo-mcp",
    sitemapsDeclared: ["https://example.com/sitemap.xml"],
    disallowedSkipped: { count: 0, sample: [] },
  },
  requested: 1,
  crawled: 1,
  failed: 0,
  documentsRead: 1,
  subrequests: 1,
  bytesRead: 500,
  outputBytes: 1000,
  pages: [{ url: "https://example.com/", result: PAGE_RESULT }],
  issueCounts: {},
  summary: {
    pagesAnalyzed: 1,
    duplicateTitles: [],
    duplicateDescriptions: [],
    missingH1: { count: 0, sample: [] },
    multipleH1: { count: 0, sample: [] },
    thinContent: { count: 0, sample: [] },
    nonIndexable: { count: 0, sample: [] },
    imagesMissingAlt: { pages: 0, images: 0 },
  },
  linkGraph: {
    crawledPages: 1,
    orphanPages: { count: 0, sample: [] },
    topLinkedPages: [],
  },
};

function jsonResponse(body: unknown): Response {
  return { json: () => Promise.resolve(body) } as Response;
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/site url/i), "https://example.com");
  await user.click(screen.getByRole("button", { name: /start crawl/i }));
}

describe("SiteCrawlContainer", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("issues no crawl_site request on mount", () => {
    render(<SiteCrawlContainer />);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("submits limit=5 and concurrency=2 by default and renders the result panels", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({ data: RESULT, cacheStatus: "miss", resultAge: 0 }),
    );
    const user = userEvent.setup();
    render(<SiteCrawlContainer />);

    await fillAndSubmit(user);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const requestUrl = String(vi.mocked(global.fetch).mock.calls[0]?.[0]);
    expect(requestUrl).toContain("/api/tools/crawl_site");
    expect(requestUrl).toContain("limit=5");
    expect(requestUrl).toContain("concurrency=2");

    expect(await screen.findByTestId("pages-analyzed")).toHaveTextContent("1");
    expect(screen.getByTestId("robots-status")).toBeInTheDocument();
    expect(screen.getByTestId("crawled-pages")).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: /per-page crawl results/i }),
    ).toBeInTheDocument();
  });

  it("blocks a duplicate submit while the first crawl_site request is still in flight", async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    vi.mocked(global.fetch).mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const user = userEvent.setup();
    render(<SiteCrawlContainer />);

    await fillAndSubmit(user);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const submitButton = screen.getByRole("button", { name: /start crawl/i });
    expect(submitButton).toBeDisabled();

    // A disabled button does not fire onClick in a real browser or jsdom;
    // this assertion is the actual proof the duplicate is blocked, not just
    // discarded after the fact.
    await user.click(submitButton);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    resolveFetch?.(
      jsonResponse({ data: RESULT, cacheStatus: "miss", resultAge: 0 }),
    );
    await screen.findByTestId("pages-analyzed");
    expect(
      screen.getByRole("button", { name: /start crawl/i }),
    ).not.toBeDisabled();
  });

  it("opens the drill-down page report from the row's own in-memory data with no new request", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({ data: RESULT, cacheStatus: "miss", resultAge: 0 }),
    );
    const user = userEvent.setup();
    render(<SiteCrawlContainer />);

    await fillAndSubmit(user);
    await screen.findByTestId("pages-analyzed");
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /view report/i }));

    // The drill-down must render the page's own already-fetched data...
    expect(await screen.findByText("Example Home")).toBeInTheDocument();
    // ...without issuing a new crawl_page (or any other) request.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("shows the shared error-state contract, never an empty-success look, when crawl_site fails", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({ error: { code: "bff_timeout", message: "too slow" } }),
    );
    const user = userEvent.setup();
    render(<SiteCrawlContainer />);

    await fillAndSubmit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(/timed out/i);
    expect(screen.queryByTestId("pages-analyzed")).not.toBeInTheDocument();
  });

  it("surfaces the output-byte truncation bound independently of per-panel sample labels", async () => {
    const truncated: SiteCrawlResult = {
      ...RESULT,
      requested: 5,
      crawled: 2,
      failed: 0,
      outputBytes: 255_800,
      pages: [{ url: "https://example.com/", result: PAGE_RESULT }],
    };
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({ data: truncated, cacheStatus: "miss", resultAge: 0 }),
    );
    const user = userEvent.setup();
    render(<SiteCrawlContainer />);

    await fillAndSubmit(user);

    const indicator = await screen.findByTestId("bound-indicator");
    expect(indicator).toHaveTextContent("maxSiteOutputBytes");
  });
});
