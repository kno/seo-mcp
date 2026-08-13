import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { KeywordResearchContainer } from "./KeywordResearchContainer";

function jsonResponse(body: unknown): Response {
  return { json: () => Promise.resolve(body) } as Response;
}

const METRICS_RESULT = {
  customerId: "1234567890",
  count: 1,
  keywords: [
    {
      keyword: "seo tool",
      avgMonthlySearches: 1000,
      competition: "MEDIUM",
      competitionIndex: 45,
      lowTopOfPageBid: 1.2,
      highTopOfPageBid: 3.4,
    },
  ],
};

const METRICS_ENVELOPE = {
  data: METRICS_RESULT,
  cacheStatus: "miss",
  resultAge: 0,
  sourceFreshness: {
    source: "google-ads",
    asOf: "2026-08-13",
    lagDays: 0,
    basis: "assumed",
  },
  quota: {
    source: "google-ads",
    atLeast: 1,
    budget: 100,
    basis: "bff-observed",
  },
  currencyLabel: "USD",
};

describe("KeywordResearchContainer accessibility", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("has zero axe violations in the pre-submission (idle) state", async () => {
    const { container } = render(<KeywordResearchContainer />);
    expect((await axe(container)).violations).toEqual([]);
  });

  it("has zero axe violations once a keyword-metrics result is rendered", async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse(METRICS_ENVELOPE));
    const user = userEvent.setup();
    const { container } = render(<KeywordResearchContainer />);
    await user.type(screen.getByLabelText(/keywords \(1-100/i), "seo tool");
    await user.click(
      screen.getByRole("button", { name: /get keyword metrics/i }),
    );
    await screen.findByRole("table");

    expect((await axe(container)).violations).toEqual([]);
  });

  it("has zero axe violations on the discover-keywords tab", async () => {
    const user = userEvent.setup();
    const { container } = render(<KeywordResearchContainer />);
    await user.click(screen.getByRole("tab", { name: /discover keywords/i }));

    expect((await axe(container)).violations).toEqual([]);
  });

  it("has zero axe violations on the cluster-keywords tab", async () => {
    const user = userEvent.setup();
    const { container } = render(<KeywordResearchContainer />);
    await user.click(screen.getByRole("tab", { name: /cluster keywords/i }));

    expect((await axe(container)).violations).toEqual([]);
  });

  it("every top-level control is reachable via keyboard alone", async () => {
    const user = userEvent.setup();
    render(<KeywordResearchContainer />);

    // The "Get keyword metrics" button is intentionally disabled only while
    // a request is in flight (never pre-submission, unlike
    // `OpportunityCriteriaForm`'s siteUrl-gated submit) — task 8.1 requires
    // the metrics tab to be immediately usable with no prerequisite state.
    const controls = [
      screen.getByRole("tab", { name: /keyword metrics/i }),
      screen.getByRole("tab", { name: /discover keywords/i }),
      screen.getByRole("tab", { name: /cluster keywords/i }),
      screen.getByLabelText(/keywords \(1-100/i),
      screen.getByRole("button", { name: /get keyword metrics/i }),
    ];

    const visited = new Set<Element>();
    for (let i = 0; i < controls.length + 20; i++) {
      await user.tab();
      if (document.activeElement) visited.add(document.activeElement);
    }

    for (const control of controls) {
      expect(visited.has(control)).toBe(true);
    }
  });
});
