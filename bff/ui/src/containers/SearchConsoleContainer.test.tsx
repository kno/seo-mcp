import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GscQueryResult } from "../../../../src/types";
import { SearchConsoleContainer } from "./SearchConsoleContainer";

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

const SOURCE_FRESHNESS = {
  source: "search-console",
  asOf: "2026-08-11",
  lagDays: 2,
  basis: "assumed",
};

function jsonResponse(body: unknown): Response {
  return { json: () => Promise.resolve(body) } as Response;
}

async function submit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByLabelText(/site url|property/i),
    "sc-domain:example.com",
  );
  await user.click(screen.getByRole("button", { name: /run query/i }));
}

describe("SearchConsoleContainer", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("issues no search_console_query request on mount", () => {
    render(<SearchConsoleContainer />);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("issues exactly one request against /api/tools/search_console_query on submit", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({
        data: RESULT,
        cacheStatus: "miss",
        resultAge: 0,
        sourceFreshness: SOURCE_FRESHNESS,
      }),
    );

    const user = userEvent.setup();
    render(<SearchConsoleContainer />);
    await submit(user);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(global.fetch).mock.calls[0]?.[0])).toContain(
      "/api/tools/search_console_query",
    );
  });

  it("renders the result table on a successful query", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({
        data: RESULT,
        cacheStatus: "miss",
        resultAge: 0,
        sourceFreshness: SOURCE_FRESHNESS,
      }),
    );

    const user = userEvent.setup();
    render(<SearchConsoleContainer />);
    await submit(user);

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getByText("seo tool")).toBeInTheDocument();
  });

  it("renders two distinct staleness elements, neither containing the other's figure", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({
        data: RESULT,
        cacheStatus: "hit",
        resultAge: 45,
        sourceFreshness: SOURCE_FRESHNESS,
      }),
    );

    const user = userEvent.setup();
    render(<SearchConsoleContainer />);
    await submit(user);

    const resultAgeBadge = await screen.findByTestId("freshness-badge");
    const sourceFreshnessBadge = screen.getByTestId("source-freshness-badge");

    expect(resultAgeBadge).toHaveTextContent("45s");
    expect(resultAgeBadge).not.toHaveTextContent("2026-08-11");
    expect(sourceFreshnessBadge).toHaveTextContent("2026-08-11");
    expect(sourceFreshnessBadge).not.toHaveTextContent("45s");
  });

  it("shows the empty state, not an error, when rowCount is 0", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({
        data: { ...RESULT, rowCount: 0, rows: [] },
        cacheStatus: "miss",
        resultAge: 0,
        sourceFreshness: SOURCE_FRESHNESS,
      }),
    );

    const user = userEvent.setup();
    render(<SearchConsoleContainer />);
    await submit(user);

    expect(
      await screen.findByText(/no search console query found/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a bound indicator naming maxGscRows when rowCount hits the 250-row cap", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({
        data: { ...RESULT, rowCount: 250 },
        cacheStatus: "miss",
        resultAge: 0,
        sourceFreshness: SOURCE_FRESHNESS,
      }),
    );

    const user = userEvent.setup();
    render(<SearchConsoleContainer />);
    await submit(user);

    const indicator = await screen.findByTestId("bound-indicator");
    expect(indicator).toHaveTextContent("250");
    expect(indicator).toHaveTextContent("maxGscRows");
  });

  it("shows no bound indicator for a row count below the cap", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({
        data: RESULT,
        cacheStatus: "miss",
        resultAge: 0,
        sourceFreshness: SOURCE_FRESHNESS,
      }),
    );

    const user = userEvent.setup();
    render(<SearchConsoleContainer />);
    await submit(user);

    await screen.findByRole("table");
    expect(screen.queryByTestId("bound-indicator")).not.toBeInTheDocument();
  });

  it("shows the not-configured error state distinctly", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({
        error: {
          code: "upstream_source_not_configured",
          message:
            "The Google credentials required for this data source are not configured.",
        },
      }),
    );

    const user = userEvent.setup();
    render(<SearchConsoleContainer />);
    await submit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /not configured/i,
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows the credential-failure error state with no retry affordance", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({
        error: {
          code: "upstream_credential_failure",
          message: "The upstream Google credential was rejected.",
        },
      }),
    );

    const user = userEvent.setup();
    render(<SearchConsoleContainer />);
    await submit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /credential rejected/i,
    );
    expect(
      screen.queryByRole("status", { name: /retry available/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the quota error state, disables resubmit, and fabricates no wait time", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({
        error: {
          code: "upstream_source_quota",
          message: "Google's own quota has been exhausted.",
        },
      }),
    );

    const user = userEvent.setup();
    render(<SearchConsoleContainer />);
    await submit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /quota exhausted/i,
    );
    expect(screen.queryByText(/0s/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run query/i })).toBeDisabled();
  });

  it("renders each of the not-configured, credential-failure, and quota states with a distinct title", async () => {
    const codes = [
      "upstream_source_not_configured",
      "upstream_credential_failure",
      "upstream_source_quota",
    ] as const;
    const titles = new Set<string>();

    for (const code of codes) {
      vi.mocked(global.fetch).mockResolvedValue(
        jsonResponse({ error: { code, message: "failure" } }),
      );
      const user = userEvent.setup();
      const { unmount } = render(<SearchConsoleContainer />);
      await submit(user);
      const alert = await screen.findByRole("alert");
      titles.add(alert.textContent ?? "");
      unmount();
    }

    expect(titles.size).toBe(3);
  });

  it("aborts a stale in-flight request rather than letting it overwrite a newer submission", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({
        data: RESULT,
        cacheStatus: "miss",
        resultAge: 0,
        sourceFreshness: SOURCE_FRESHNESS,
      }),
    );

    const user = userEvent.setup();
    render(<SearchConsoleContainer />);
    await submit(user);
    await submit(user);

    await screen.findByRole("table");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
