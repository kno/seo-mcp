import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GscInsightsContainer } from "./GscInsightsContainer";

function jsonResponse(body: unknown): Response {
  return { json: () => Promise.resolve(body) } as Response;
}

const OPPORTUNITY_RESULT = {
  siteUrl: "sc-domain:example.com",
  startDate: "2026-07-01",
  endDate: "2026-07-28",
  dimensions: ["query", "page"],
  criteria: { minPosition: 11, maxPosition: 20, minImpressions: 1, limit: 25 },
  rowCount: 25,
  rows: Array.from({ length: 25 }, (_, index) => ({
    keys: [`keyword ${index}`, "/"],
    clicks: 3,
    impressions: 300,
    ctr: 0.01,
    position: 14.2,
  })),
};

const FRESHNESS = {
  source: "search-console",
  asOf: "2026-07-26",
  lagDays: 2,
  basis: "assumed",
};

function opportunityEnvelope(
  rowCount: number,
  criteria: Record<string, number>,
) {
  return {
    data: {
      ...OPPORTUNITY_RESULT,
      rowCount,
      criteria,
      rows: OPPORTUNITY_RESULT.rows.slice(0, rowCount),
    },
    cacheStatus: "miss",
    resultAge: 0,
    sourceFreshness: FRESHNESS,
  };
}

describe("GscInsightsContainer — shared property/date-range persistence (task 6.1)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(opportunityEnvelope(0, { limit: 25 })));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("keeps the entered siteUrl when switching between insight tools", async () => {
    const user = userEvent.setup();
    render(<GscInsightsContainer />);

    await user.type(
      screen.getByLabelText(/site url|property/i),
      "sc-domain:example.com",
    );

    await user.click(
      screen.getByRole("tab", { name: /low-ctr opportunities/i }),
    );
    expect(screen.getByLabelText(/site url|property/i)).toHaveValue(
      "sc-domain:example.com",
    );

    await user.click(
      screen.getByRole("tab", { name: /snapshots & comparison/i }),
    );
    expect(screen.getByLabelText(/site url|property/i)).toHaveValue(
      "sc-domain:example.com",
    );
  });

  it("blocks submission for a tool when no property is selected", async () => {
    const user = userEvent.setup();
    render(<GscInsightsContainer />);

    const runButton = screen.getByRole("button", {
      name: /find striking-distance keywords/i,
    });
    expect(runButton).toBeDisabled();
    await user.click(runButton);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("GscInsightsContainer — applied criteria and bound label (tasks 6.2, 6.3)", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("shows the server-echoed criteria (including defaults) and a bound label at rowCount === criteria.limit", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(opportunityEnvelope(25, { minImpressions: 1, limit: 25 })),
      );
    const user = userEvent.setup();
    render(<GscInsightsContainer />);

    await user.type(
      screen.getByLabelText(/site url|property/i),
      "sc-domain:example.com",
    );
    await user.click(
      screen.getByRole("button", { name: /find striking-distance keywords/i }),
    );

    const criteria = await screen.findByTestId("opportunity-criteria");
    expect(within(criteria).getByText("minImpressions")).toBeInTheDocument();
    expect(within(criteria).getByText("1")).toBeInTheDocument();

    expect(screen.getByTestId("opportunity-bound-indicator")).toHaveTextContent(
      "25",
    );
    // Never claims exhaustiveness even at the bound.
    expect(
      screen.getByTestId("opportunity-exhaustiveness-caveat"),
    ).toBeInTheDocument();
  });

  it("does not show a bound label when rowCount is below criteria.limit", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(opportunityEnvelope(3, { limit: 25 })));
    const user = userEvent.setup();
    render(<GscInsightsContainer />);

    await user.type(
      screen.getByLabelText(/site url|property/i),
      "sc-domain:example.com",
    );
    await user.click(
      screen.getByRole("button", { name: /find striking-distance keywords/i }),
    );

    await screen.findByTestId("opportunity-criteria");
    expect(
      screen.queryByTestId("opportunity-bound-indicator"),
    ).not.toBeInTheDocument();
  });

  it("shows a distinct empty state for zero opportunities, never the unfetched state", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(opportunityEnvelope(0, { limit: 25 })));
    const user = userEvent.setup();
    render(<GscInsightsContainer />);

    expect(
      screen.queryByText(/no striking-distance keywords found/i),
    ).not.toBeInTheDocument();

    await user.type(
      screen.getByLabelText(/site url|property/i),
      "sc-domain:example.com",
    );
    await user.click(
      screen.getByRole("button", { name: /find striking-distance keywords/i }),
    );

    expect(
      await screen.findByText(/no striking-distance keywords found/i),
    ).toBeInTheDocument();
  });
});

const SNAPSHOTS = [
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

const COMPARE_RESULT = {
  siteUrl: "sc-domain:example.com",
  baseSnapshotId: 1,
  currentSnapshotId: 2,
  diff: {
    baseCount: 2,
    currentCount: 2,
    decayed: [
      {
        query: "seo mcp",
        page: "/",
        base: { clicks: 10, impressions: 100, ctr: 0.1, position: 5.2 },
        current: { clicks: 4, impressions: 100, ctr: 0.04, position: 8.1 },
        clicksDelta: -6,
        impressionsDelta: 0,
        positionDelta: 2.9,
      },
    ],
    improved: [
      {
        query: "seo tool",
        page: "/tools",
        base: { clicks: 2, impressions: 50, ctr: 0.04, position: 12.1 },
        current: { clicks: 9, impressions: 60, ctr: 0.15, position: 6.4 },
        clicksDelta: 7,
        impressionsDelta: 10,
        positionDelta: -5.7,
      },
    ],
    lost: [
      {
        query: "discontinued",
        page: "/old",
        base: { clicks: 3, impressions: 40, ctr: 0.075, position: 9.5 },
        current: null,
        clicksDelta: -3,
        impressionsDelta: -40,
        positionDelta: 0,
      },
    ],
    gained: [
      {
        query: "new launch",
        page: "/new",
        base: null,
        current: { clicks: 5, impressions: 70, ctr: 0.071, position: 7.2 },
        clicksDelta: 5,
        impressionsDelta: 70,
        positionDelta: 0,
      },
    ],
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

async function openSnapshotsTab() {
  const user = userEvent.setup();
  render(<GscInsightsContainer />);
  await user.type(
    screen.getByLabelText(/site url|property/i),
    "sc-domain:example.com",
  );
  await user.click(
    screen.getByRole("tab", { name: /snapshots & comparison/i }),
  );
  return user;
}

describe("GscInsightsContainer — comparison names both endpoints (task 6.4)", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("shows both snapshot ids, labels, and date ranges after listing and comparing", async () => {
    global.fetch = routedFetch({
      list_search_console_snapshots: {
        data: {
          siteUrl: "sc-domain:example.com",
          count: 2,
          snapshots: SNAPSHOTS,
        },
        cacheStatus: "miss",
        resultAge: 0,
        sourceFreshness: FRESHNESS,
      },
      compare_search_console: {
        data: COMPARE_RESULT,
        cacheStatus: "miss",
        resultAge: 0,
        sourceFreshness: FRESHNESS,
      },
    });
    const user = await openSnapshotsTab();

    await user.click(
      screen.getByRole("button", { name: /refresh snapshot list/i }),
    );
    await screen.findByText("#2");

    await user.click(screen.getByRole("button", { name: /compare/i }));

    const endpoints = await screen.findByTestId("diff-endpoints");
    expect(endpoints).toHaveTextContent("#1");
    expect(endpoints).toHaveTextContent("#2");
    expect(endpoints).toHaveTextContent("base");
    expect(endpoints).toHaveTextContent("current");
    expect(endpoints).toHaveTextContent("2026-06-01");
    expect(endpoints).toHaveTextContent("2026-07-28");
  });
});

describe("GscInsightsContainer — content-decay direction is unambiguous (task 6.5)", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("renders all four buckets with distinct classes and null-side labels, never as zero metrics", async () => {
    global.fetch = routedFetch({
      list_search_console_snapshots: {
        data: {
          siteUrl: "sc-domain:example.com",
          count: 2,
          snapshots: SNAPSHOTS,
        },
        cacheStatus: "miss",
        resultAge: 0,
        sourceFreshness: FRESHNESS,
      },
      compare_search_console: {
        data: COMPARE_RESULT,
        cacheStatus: "miss",
        resultAge: 0,
        sourceFreshness: FRESHNESS,
      },
    });
    const user = await openSnapshotsTab();
    await user.click(
      screen.getByRole("button", { name: /refresh snapshot list/i }),
    );
    await screen.findByText("#2");
    await user.click(screen.getByRole("button", { name: /compare/i }));

    await screen.findByTestId("diff-endpoints");

    const decayed = screen.getByTestId("diff-bucket-decayed");
    const improved = screen.getByTestId("diff-bucket-improved");
    const lost = screen.getByTestId("diff-bucket-lost");
    const gained = screen.getByTestId("diff-bucket-gained");

    expect(decayed.className).toContain("stat-warn");
    expect(improved.className).toContain("stat-ok");
    expect(lost.className).toContain("stat-danger");
    expect(gained.className).toContain("stat-info");

    // The four class treatments are pairwise distinct.
    const classes = [decayed, improved, lost, gained].map((el) => el.className);
    expect(new Set(classes).size).toBe(4);

    expect(within(lost).getByTestId("diff-row-lost-note")).toBeInTheDocument();
    expect(
      within(gained).getByTestId("diff-row-gained-note"),
    ).toBeInTheDocument();
    // The lost/gained rows never render a fabricated "0" metric.
    expect(within(lost).queryByText(/^0$/)).not.toBeInTheDocument();
  });
});

describe("GscInsightsContainer — each bucket independently labels its own bound (task 6.6)", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("labels only the bucket that reached maxDiffRows, not the others", async () => {
    const cappedRow = {
      query: "q",
      page: "/p",
      base: { clicks: 1, impressions: 1, ctr: 1, position: 1 },
      current: { clicks: 1, impressions: 1, ctr: 1, position: 1 },
      clicksDelta: 0,
      impressionsDelta: 0,
      positionDelta: 0,
    };
    const cappedCompareResult = {
      ...COMPARE_RESULT,
      diff: {
        baseCount: 200,
        currentCount: 200,
        decayed: Array.from({ length: 100 }, () => cappedRow),
        improved: [cappedRow],
        lost: [],
        gained: [],
      },
    };
    global.fetch = routedFetch({
      list_search_console_snapshots: {
        data: {
          siteUrl: "sc-domain:example.com",
          count: 2,
          snapshots: SNAPSHOTS,
        },
        cacheStatus: "miss",
        resultAge: 0,
        sourceFreshness: FRESHNESS,
      },
      compare_search_console: {
        data: cappedCompareResult,
        cacheStatus: "miss",
        resultAge: 0,
        sourceFreshness: FRESHNESS,
      },
    });
    const user = await openSnapshotsTab();
    await user.click(
      screen.getByRole("button", { name: /refresh snapshot list/i }),
    );
    await screen.findByText("#2");
    await user.click(screen.getByRole("button", { name: /compare/i }));
    await screen.findByTestId("diff-endpoints");

    expect(screen.getByTestId("diff-bucket-bound-decayed")).toBeInTheDocument();
    expect(
      screen.queryByTestId("diff-bucket-bound-improved"),
    ).not.toBeInTheDocument();
  });
});

describe("GscInsightsContainer — D1-specific distinct error states (task 6.7)", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("renders insufficient_snapshots as its own actionable state, not tool_failed or an empty diff", async () => {
    global.fetch = routedFetch({
      list_search_console_snapshots: {
        data: {
          siteUrl: "sc-domain:example.com",
          count: 2,
          snapshots: SNAPSHOTS,
        },
        cacheStatus: "miss",
        resultAge: 0,
        sourceFreshness: FRESHNESS,
      },
      compare_search_console: {
        error: {
          code: "insufficient_snapshots",
          message: "At least two stored snapshots are required to compare.",
        },
      },
    });
    const user = await openSnapshotsTab();
    await user.click(
      screen.getByRole("button", { name: /refresh snapshot list/i }),
    );
    await screen.findByText("#2");
    await user.click(screen.getByRole("button", { name: /compare/i }));

    expect(
      await screen.findByText(/not enough snapshots to compare/i),
    ).toBeInTheDocument();
  });

  it("renders upstream_storage_not_configured as its own actionable state on the snapshot list", async () => {
    global.fetch = routedFetch({
      list_search_console_snapshots: {
        error: {
          code: "upstream_storage_not_configured",
          message: "not configured",
        },
      },
    });
    const user = await openSnapshotsTab();
    await user.click(
      screen.getByRole("button", { name: /refresh snapshot list/i }),
    );

    const errorBox = await screen.findByTestId("snapshot-list-error");
    expect(errorBox).toHaveTextContent("upstream_storage_not_configured");
  });
});

describe("GscInsightsContainer — comparison entry point requires two snapshots first (task 6.4 / gsc-insight-views)", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("shows a capture-first onboarding state and no Compare button when zero snapshots exist", async () => {
    global.fetch = routedFetch({
      list_search_console_snapshots: {
        data: { siteUrl: "sc-domain:example.com", count: 0, snapshots: [] },
        cacheStatus: "miss",
        resultAge: 0,
        sourceFreshness: FRESHNESS,
      },
    });
    const user = await openSnapshotsTab();
    await user.click(
      screen.getByRole("button", { name: /refresh snapshot list/i }),
    );

    expect(await screen.findByTestId("snapshot-onboarding")).toHaveTextContent(
      /no snapshots stored yet/i,
    );
    expect(
      screen.queryByRole("button", { name: /^compare/i }),
    ).not.toBeInTheDocument();
  });

  it("still shows the capture-more onboarding state and no Compare button with exactly one snapshot", async () => {
    global.fetch = routedFetch({
      list_search_console_snapshots: {
        data: {
          siteUrl: "sc-domain:example.com",
          count: 1,
          snapshots: [SNAPSHOTS[0]],
        },
        cacheStatus: "miss",
        resultAge: 0,
        sourceFreshness: FRESHNESS,
      },
    });
    const user = await openSnapshotsTab();
    await user.click(
      screen.getByRole("button", { name: /refresh snapshot list/i }),
    );

    expect(await screen.findByTestId("snapshot-onboarding")).toHaveTextContent(
      /one more snapshot is needed/i,
    );
    expect(
      screen.queryByRole("button", { name: /^compare/i }),
    ).not.toBeInTheDocument();
  });
});

const SNAPSHOTS_THREE = [
  {
    id: 3,
    siteUrl: "sc-domain:example.com",
    capturedAt: "2026-07-28T00:00:00.000Z",
    startDate: "2026-07-01",
    endDate: "2026-07-28",
    label: "newest",
  },
  {
    id: 2,
    siteUrl: "sc-domain:example.com",
    capturedAt: "2026-06-28T00:00:00.000Z",
    startDate: "2026-06-01",
    endDate: "2026-06-28",
    label: "middle",
  },
  {
    id: 1,
    siteUrl: "sc-domain:example.com",
    capturedAt: "2026-05-28T00:00:00.000Z",
    startDate: "2026-05-01",
    endDate: "2026-05-28",
    label: "oldest",
  },
];

describe("GscInsightsContainer — an explicit snapshot pair overrides the two-most-recent default (gsc-insight-views)", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("sends the explicitly-selected base/current ids, not the two most recent", async () => {
    global.fetch = routedFetch({
      list_search_console_snapshots: {
        data: {
          siteUrl: "sc-domain:example.com",
          count: 3,
          snapshots: SNAPSHOTS_THREE,
        },
        cacheStatus: "miss",
        resultAge: 0,
        sourceFreshness: FRESHNESS,
      },
      compare_search_console: {
        data: {
          ...COMPARE_RESULT,
          baseSnapshotId: 1,
          currentSnapshotId: 3,
        },
        cacheStatus: "miss",
        resultAge: 0,
        sourceFreshness: FRESHNESS,
      },
    });
    const user = await openSnapshotsTab();
    await user.click(
      screen.getByRole("button", { name: /refresh snapshot list/i }),
    );
    await screen.findByText("#3");

    // Explicitly pick the oldest (#1) as base and the newest (#3) as
    // current — the two-most-recent default would have been #2 and #3.
    await user.click(
      screen.getByRole("radio", { name: /use snapshot #1 as base/i }),
    );
    await user.click(
      screen.getByRole("radio", { name: /use snapshot #3 as current/i }),
    );

    await user.click(
      screen.getByRole("button", { name: /compare snapshot #1 vs #3/i }),
    );

    await screen.findByTestId("diff-endpoints");

    const compareCall = (
      global.fetch as ReturnType<typeof vi.fn>
    ).mock.calls.find((call: unknown[]) =>
      (call[0] as RequestInfo | URL)
        .toString()
        .includes("compare_search_console"),
    );
    expect(compareCall).toBeDefined();
    const requestedUrl = (compareCall![0] as RequestInfo | URL).toString();
    expect(requestedUrl).toContain("baseSnapshotId=1");
    expect(requestedUrl).toContain("currentSnapshotId=3");
    // Never silently substitutes the two-most-recent default (#2, #3).
    expect(requestedUrl).not.toContain("baseSnapshotId=2");
  });
});

describe("GscInsightsContainer — reporting-lag freshness for every GSC-backed tool (task 6.8)", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("shows the SourceFreshnessBadge for an opportunity result", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(opportunityEnvelope(1, { limit: 25 })));
    const user = userEvent.setup();
    render(<GscInsightsContainer />);
    await user.type(
      screen.getByLabelText(/site url|property/i),
      "sc-domain:example.com",
    );
    await user.click(
      screen.getByRole("button", { name: /find striking-distance keywords/i }),
    );

    expect(
      await screen.findByTestId("source-freshness-badge"),
    ).toBeInTheDocument();
  });

  it("shows two distinct as-of markers for the comparison's base and current periods", async () => {
    global.fetch = routedFetch({
      list_search_console_snapshots: {
        data: {
          siteUrl: "sc-domain:example.com",
          count: 2,
          snapshots: SNAPSHOTS,
        },
        cacheStatus: "miss",
        resultAge: 0,
        sourceFreshness: FRESHNESS,
      },
      compare_search_console: {
        data: COMPARE_RESULT,
        cacheStatus: "miss",
        resultAge: 0,
        sourceFreshness: FRESHNESS,
      },
    });
    const user = await openSnapshotsTab();
    await user.click(
      screen.getByRole("button", { name: /refresh snapshot list/i }),
    );
    await screen.findByText("#2");
    await user.click(screen.getByRole("button", { name: /compare/i }));
    await screen.findByTestId("diff-endpoints");

    const baseAsOf = screen.getByTestId("diff-base-as-of");
    const currentAsOf = screen.getByTestId("diff-current-as-of");
    expect(baseAsOf).toHaveTextContent("2026-06-28");
    expect(currentAsOf).toHaveTextContent("2026-07-28");
    expect(baseAsOf.textContent).not.toBe(currentAsOf.textContent);
  });
});
