import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HistoryContainer } from "./HistoryContainer";

function jsonResponse(body: unknown): Response {
  return { json: () => Promise.resolve(body) } as Response;
}

const FRESHNESS = {
  source: "search-console",
  asOf: "2026-07-26",
  lagDays: 2,
  basis: "assumed",
};

const GSC_SNAPSHOTS = [
  {
    id: 2,
    siteUrl: "sc-domain:example.com",
    capturedAt: "2026-07-28T00:00:00.000Z",
    startDate: "2026-07-01",
    endDate: "2026-07-28",
    label: "current",
  },
  {
    id: 1,
    siteUrl: "sc-domain:example.com",
    capturedAt: "2026-06-28T00:00:00.000Z",
    startDate: "2026-06-01",
    endDate: "2026-06-28",
    label: "base",
  },
];

const CRAWL_SNAPSHOTS = [
  {
    id: 2,
    url: "https://example.com",
    capturedAt: "2026-07-28T00:00:00.000Z",
    label: "current",
    crawled: 5,
    failed: 0,
    issueCounts: { "missing-h1": 1 },
  },
  {
    id: 1,
    url: "https://example.com",
    capturedAt: "2026-06-28T00:00:00.000Z",
    label: "base",
    crawled: 4,
    failed: 0,
    issueCounts: { "missing-h1": 2, "thin-content": 1 },
  },
];

const CRAWL_COMPARE_RESULT = {
  url: "https://example.com",
  baseSnapshotId: 1,
  currentSnapshotId: 2,
  diff: {
    newPages: ["https://example.com/new"],
    removedPages: ["https://example.com/gone"],
    newIssues: [{ page: "https://example.com/about", codes: ["missing-h1"] }],
    resolvedIssues: [
      { page: "https://example.com/contact", codes: ["thin-content"] },
    ],
    issueCountDeltas: { "missing-h1": 1, "thin-content": -1 },
  },
};

function routedFetch(routes: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [pathFragment, body] of Object.entries(routes)) {
      if (url.includes(pathFragment)) return jsonResponse(body);
    }
    return jsonResponse({
      error: { code: "tool_failed", message: "no route" },
    });
  });
}

describe("HistoryContainer — retention is presented as unbounded, never a retention window (task 11.3)", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("makes no rolling-window/retention-window claim anywhere, even before any fetch", () => {
    render(<HistoryContainer />);
    expect(screen.queryByText(/90.day/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/retention window/i)).not.toBeInTheDocument();
  });

  it("labels the listing cap as a display count once a snapshot list is fetched, not a retention window", async () => {
    global.fetch = routedFetch({
      list_crawl_snapshots: {
        data: {
          url: "https://example.com",
          count: 2,
          snapshots: CRAWL_SNAPSHOTS,
        },
        cacheStatus: "miss",
        resultAge: 0,
      },
    });
    const user = userEvent.setup();
    render(<HistoryContainer />);
    await user.type(
      screen.getByLabelText(/crawl site url/i),
      "https://example.com",
    );
    await user.click(
      screen.getAllByRole("button", { name: /refresh snapshot list/i })[1],
    );

    expect(
      await screen.findByText(/unbounded and accumulating/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/90.day/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/retention window/i)).not.toBeInTheDocument();
  });
});

describe("HistoryContainer — crawl-snapshot capture is manual only (task 11.4)", () => {
  it("states crawl snapshots never accumulate on their own, distinct from the GSC scheduled-cron caveat", () => {
    render(<HistoryContainer />);
    expect(screen.getByText(/captured MANUALLY ONLY/i)).toBeInTheDocument();
    expect(
      screen.getByText(/no scheduled crawl-snapshot job/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/GSC_SNAPSHOT_PROPERTIES/)).toBeInTheDocument();
  });
});

describe("HistoryContainer — the two sub-families ship and degrade independently (task 11.7)", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("GSC history present + crawl history empty both render correctly", async () => {
    global.fetch = routedFetch({
      list_search_console_snapshots: {
        data: {
          siteUrl: "sc-domain:example.com",
          count: 2,
          snapshots: GSC_SNAPSHOTS,
        },
        cacheStatus: "miss",
        resultAge: 0,
        sourceFreshness: FRESHNESS,
      },
      list_crawl_snapshots: {
        data: { url: "https://example.com", count: 0, snapshots: [] },
        cacheStatus: "miss",
        resultAge: 0,
      },
    });
    const user = userEvent.setup();
    render(<HistoryContainer />);

    await user.type(
      screen.getByLabelText(/search console site url/i),
      "sc-domain:example.com",
    );
    await user.click(
      screen.getAllByRole("button", { name: /refresh snapshot list/i })[0],
    );
    await screen.findByText("#2");

    await user.type(
      screen.getByLabelText(/crawl site url/i),
      "https://example.com",
    );
    const refreshButtons = screen.getAllByRole("button", {
      name: /refresh snapshot list/i,
    });
    await user.click(refreshButtons[1]);

    expect(
      await screen.findByTestId("crawl-history-onboarding"),
    ).toHaveTextContent(/no crawl snapshots stored yet/i);
    // The crawl section's empty state is NOT an error.
    expect(
      screen.queryByTestId("crawl-history-list-error"),
    ).not.toBeInTheDocument();
  });

  it("crawl history present + GSC history empty both render correctly (the reverse direction)", async () => {
    global.fetch = routedFetch({
      list_crawl_snapshots: {
        data: {
          url: "https://example.com",
          count: 2,
          snapshots: CRAWL_SNAPSHOTS,
        },
        cacheStatus: "miss",
        resultAge: 0,
      },
      list_search_console_snapshots: {
        data: { siteUrl: "sc-domain:example.com", count: 0, snapshots: [] },
        cacheStatus: "miss",
        resultAge: 0,
        sourceFreshness: FRESHNESS,
      },
    });
    const user = userEvent.setup();
    render(<HistoryContainer />);

    await user.type(
      screen.getByLabelText(/crawl site url/i),
      "https://example.com",
    );
    const refreshButtons = screen.getAllByRole("button", {
      name: /refresh snapshot list/i,
    });
    await user.click(refreshButtons[1]);
    await screen.findByText("#2");

    await user.type(
      screen.getByLabelText(/search console site url/i),
      "sc-domain:example.com",
    );
    await user.click(refreshButtons[0]);

    expect(
      await screen.findByTestId("gsc-history-onboarding"),
    ).toHaveTextContent(/no snapshots stored yet/i);
    expect(
      screen.queryByTestId("gsc-history-list-error"),
    ).not.toBeInTheDocument();
  });
});

describe("HistoryContainer — crawl-snapshot D1-specific distinct error states (task 11.6)", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("renders upstream_storage_not_configured distinctly from an empty crawl history list", async () => {
    global.fetch = routedFetch({
      list_crawl_snapshots: {
        error: { code: "upstream_storage_not_configured", message: "x" },
      },
    });
    const user = userEvent.setup();
    render(<HistoryContainer />);
    await user.type(
      screen.getByLabelText(/crawl site url/i),
      "https://example.com",
    );
    await user.click(
      screen.getAllByRole("button", { name: /refresh snapshot list/i })[1],
    );

    const errorBox = await screen.findByTestId("crawl-history-list-error");
    expect(errorBox).toHaveTextContent("upstream_storage_not_configured");
    expect(
      screen.queryByTestId("crawl-history-onboarding"),
    ).not.toBeInTheDocument();
  });

  it("renders insufficient_snapshots for a crawl comparison as its own actionable state", async () => {
    global.fetch = routedFetch({
      list_crawl_snapshots: {
        data: {
          url: "https://example.com",
          count: 2,
          snapshots: CRAWL_SNAPSHOTS,
        },
        cacheStatus: "miss",
        resultAge: 0,
      },
      compare_crawls: {
        error: { code: "insufficient_snapshots", message: "x" },
      },
    });
    const user = userEvent.setup();
    render(<HistoryContainer />);
    await user.type(
      screen.getByLabelText(/crawl site url/i),
      "https://example.com",
    );
    await user.click(
      screen.getAllByRole("button", { name: /refresh snapshot list/i })[1],
    );
    await screen.findByText("#2");
    await user.click(screen.getByRole("button", { name: /^compare/i }));

    expect(
      await screen.findByText(/not enough snapshots to compare/i),
    ).toBeInTheDocument();
  });
});

describe("HistoryContainer — compare_crawls names both endpoints and distinguishes page-level from issue-level changes (task 11.5)", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("shows both snapshot ids/labels/capturedAt, and separates pages from on-page issues", async () => {
    global.fetch = routedFetch({
      list_crawl_snapshots: {
        data: {
          url: "https://example.com",
          count: 2,
          snapshots: CRAWL_SNAPSHOTS,
        },
        cacheStatus: "miss",
        resultAge: 0,
      },
      compare_crawls: {
        data: CRAWL_COMPARE_RESULT,
        cacheStatus: "miss",
        resultAge: 0,
      },
    });
    const user = userEvent.setup();
    render(<HistoryContainer />);
    await user.type(
      screen.getByLabelText(/crawl site url/i),
      "https://example.com",
    );
    await user.click(
      screen.getAllByRole("button", { name: /refresh snapshot list/i })[1],
    );
    await screen.findByText("#2");
    await user.click(screen.getByRole("button", { name: /^compare/i }));

    const endpoints = await screen.findByTestId("crawl-diff-endpoints");
    expect(endpoints).toHaveTextContent("#1");
    expect(endpoints).toHaveTextContent("#2");
    expect(endpoints).toHaveTextContent("base");
    expect(endpoints).toHaveTextContent("current");
    expect(endpoints).toHaveTextContent("2026-06-28");
    expect(endpoints).toHaveTextContent("2026-07-28");

    const newPages = screen.getByTestId("crawl-diff-bucket-newPages");
    const removedPages = screen.getByTestId("crawl-diff-bucket-removedPages");
    const newIssues = screen.getByTestId("crawl-diff-bucket-newIssues");
    const resolvedIssues = screen.getByTestId(
      "crawl-diff-bucket-resolvedIssues",
    );

    expect(
      within(newPages).getByText("https://example.com/new"),
    ).toBeInTheDocument();
    expect(
      within(removedPages).getByText("https://example.com/gone"),
    ).toBeInTheDocument();
    // A page-level change never appears inside an issue-level section.
    expect(
      within(newIssues).queryByText("https://example.com/new"),
    ).not.toBeInTheDocument();
    expect(
      within(newIssues).getByText("https://example.com/about"),
    ).toBeInTheDocument();
    expect(
      within(resolvedIssues).getByText("https://example.com/contact"),
    ).toBeInTheDocument();

    expect(screen.getAllByText("missing-h1").length).toBeGreaterThan(0);
  });
});
