import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KeywordResearchContainer } from "./KeywordResearchContainer";

function jsonResponse(body: unknown): Response {
  return { json: () => Promise.resolve(body) } as Response;
}

const METRICS_RESULT = {
  customerId: "1234567890",
  count: 2,
  keywords: [
    {
      keyword: "seo tool",
      avgMonthlySearches: 1000,
      competition: "MEDIUM",
      competitionIndex: 45,
      lowTopOfPageBid: 1.2,
      highTopOfPageBid: 3.4,
    },
    {
      keyword: "seo audit",
      avgMonthlySearches: 0,
      competition: "LOW",
      competitionIndex: 0,
      lowTopOfPageBid: 0,
      highTopOfPageBid: 0,
    },
  ],
};

const FRESHNESS = {
  source: "google-ads",
  asOf: "2026-08-13",
  lagDays: 0,
  basis: "assumed",
};

const QUOTA = {
  source: "google-ads",
  atLeast: 1,
  budget: 100,
  basis: "bff-observed",
};

function metricsEnvelope(currencyLabel: string | null = "USD") {
  return {
    data: METRICS_RESULT,
    cacheStatus: "miss",
    resultAge: 0,
    sourceFreshness: FRESHNESS,
    quota: QUOTA,
    ...(currencyLabel !== null ? { currencyLabel } : {}),
  };
}

const CLUSTER_RESULT = {
  count: 2,
  intents: { commercial: 2 },
  clusters: [{ label: "seo", keywords: ["seo tool", "seo audit"] }],
  keywords: [
    { keyword: "seo tool", intent: "commercial", tokens: ["seo", "tool"] },
    { keyword: "seo audit", intent: "commercial", tokens: ["seo", "audit"] },
  ],
};

describe("KeywordResearchContainer — usable with get_keyword_metrics alone (task 8.1)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(metricsEnvelope()));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("renders the Keyword metrics tab as the default, active tab", () => {
    render(<KeywordResearchContainer />);
    expect(
      screen.getByRole("tab", { name: /keyword metrics/i }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("submits and renders a get_keyword_metrics result with no dependency on the other two tools", async () => {
    const user = userEvent.setup();
    render(<KeywordResearchContainer />);

    await user.type(
      screen.getByLabelText(/keywords \(1-100/i),
      "seo tool, seo audit",
    );
    await user.click(
      screen.getByRole("button", { name: /get keyword metrics/i }),
    );

    expect(await screen.findByRole("table")).toBeDefined();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/tools/get_keyword_metrics"),
      expect.anything(),
    );
  });

  it("renders a second, distinct google-ads quota badge alongside the source-freshness badge", async () => {
    const user = userEvent.setup();
    render(<KeywordResearchContainer />);
    await user.type(screen.getByLabelText(/keywords \(1-100/i), "seo tool");
    await user.click(
      screen.getByRole("button", { name: /get keyword metrics/i }),
    );

    await screen.findByRole("table");
    expect(screen.getByTestId("quota-badge-google-ads")).toBeDefined();
    expect(screen.getByTestId("source-freshness-badge")).toBeDefined();
  });
});

describe("KeywordResearchContainer — currency label requirement (task 8.2)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("renders every bid value with the operator-configured currency label", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(metricsEnvelope("USD")));
    const user = userEvent.setup();
    render(<KeywordResearchContainer />);
    await user.type(screen.getByLabelText(/keywords \(1-100/i), "seo tool");
    await user.click(
      screen.getByRole("button", { name: /get keyword metrics/i }),
    );

    const table = await screen.findByRole("table");
    expect(table.textContent).toContain("USD");
    expect(table.textContent).not.toMatch(/^\s*\$?\d+\.\d{2}\s*$/m);
  });

  it("shows an explicit configuration-needed state instead of a bare bid value when no currency label is configured", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(metricsEnvelope(null)));
    const user = userEvent.setup();
    render(<KeywordResearchContainer />);
    await user.type(screen.getByLabelText(/keywords \(1-100/i), "seo tool");
    await user.click(
      screen.getByRole("button", { name: /get keyword metrics/i }),
    );

    await screen.findByRole("table");
    expect(screen.getByTestId("ads-currency-not-configured")).toBeDefined();
    expect(
      screen.getAllByText(/currency not configured/i).length,
    ).toBeGreaterThan(0);
  });
});

describe("KeywordResearchContainer — a zero value never claims certainty (task 8.3)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(metricsEnvelope()));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("labels a 0 avgMonthlySearches/bid as hedged, never as a bare confirmed zero", async () => {
    const user = userEvent.setup();
    render(<KeywordResearchContainer />);
    await user.type(screen.getByLabelText(/keywords \(1-100/i), "seo audit");
    await user.click(
      screen.getByRole("button", { name: /get keyword metrics/i }),
    );

    const table = await screen.findByRole("table");
    expect(table.textContent).toContain("or not reported");
    // Never a bare, unhedged "0" cell — every zero must carry the hedge.
    const cells = Array.from(table.querySelectorAll("td")).map((cell) =>
      cell.textContent?.trim(),
    );
    expect(cells).not.toContain("0");
  });
});

describe("KeywordResearchContainer — clustering is inspectable (task 8.4)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        data: CLUSTER_RESULT,
        cacheStatus: "miss",
        resultAge: 0,
      }),
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("lists every KeywordCluster.keywords member directly, not an opaque count", async () => {
    const user = userEvent.setup();
    render(<KeywordResearchContainer />);
    await user.click(screen.getByRole("tab", { name: /cluster keywords/i }));
    await user.type(
      screen.getByLabelText(/keywords \(1-500/i),
      "seo tool, seo audit",
    );
    await user.click(
      screen.getByRole("button", { name: /^cluster keywords$/i }),
    );

    const list = await screen.findByTestId("keyword-cluster-list");
    expect(list.textContent).toContain("seo tool");
    expect(list.textContent).toContain("seo audit");
  });

  it("cluster_keywords carries no quota/freshness badge — it spends no Google Ads quota (task 8.5)", async () => {
    const user = userEvent.setup();
    render(<KeywordResearchContainer />);
    await user.click(screen.getByRole("tab", { name: /cluster keywords/i }));
    await user.type(screen.getByLabelText(/keywords \(1-500/i), "seo tool");
    await user.click(
      screen.getByRole("button", { name: /^cluster keywords$/i }),
    );

    await screen.findByTestId("keyword-cluster-list");
    expect(screen.queryByTestId("quota-badge-google-ads")).toBeNull();
    expect(screen.queryByTestId("source-freshness-badge")).toBeNull();
  });
});

describe("KeywordResearchContainer — missing Ads developer token is distinct from empty (task 8.6)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("renders the not-configured state, distinct from a zero-keyword empty result", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        error: {
          code: "upstream_source_not_configured",
          message:
            "The Google credentials required for this data source are not configured.",
        },
      }),
    );
    const user = userEvent.setup();
    render(<KeywordResearchContainer />);
    await user.type(screen.getByLabelText(/keywords \(1-100/i), "seo tool");
    await user.click(
      screen.getByRole("button", { name: /get keyword metrics/i }),
    );

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.queryByText(/no keyword metrics found/i)).toBeNull();
  });

  it("renders a distinct empty state for a genuinely empty (zero-keyword) result", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        data: { customerId: "1234567890", count: 0, keywords: [] },
        cacheStatus: "miss",
        resultAge: 0,
        sourceFreshness: FRESHNESS,
        quota: QUOTA,
        currencyLabel: "USD",
      }),
    );
    const user = userEvent.setup();
    render(<KeywordResearchContainer />);
    await user.type(screen.getByLabelText(/keywords \(1-100/i), "seo tool");
    await user.click(
      screen.getByRole("button", { name: /get keyword metrics/i }),
    );

    expect(await screen.findByText(/no keyword metrics found/i)).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
