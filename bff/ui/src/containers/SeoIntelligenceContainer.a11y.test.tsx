import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { SeoIntelligenceContainer } from "./SeoIntelligenceContainer";

function jsonResponse(body: unknown): Response {
  return { json: () => Promise.resolve(body) } as Response;
}

const OPPORTUNITIES_RESULT = {
  siteUrl: "sc-domain:example.com",
  startDate: "2026-07-01",
  endDate: "2026-07-28",
  count: 1,
  opportunities: [
    {
      type: "low_ctr",
      query: "seo mcp",
      page: "/",
      impressions: 500,
      currentPosition: 4.2,
      impact: 500,
      effort: 1,
      priorityScore: 500,
      recommendation: "Rewrite title/meta description to improve CTR.",
    },
  ],
};

const AUTHENTICATED_ENVELOPE = {
  data: OPPORTUNITIES_RESULT,
  cacheStatus: "miss",
  resultAge: 0,
  sourceFreshness: {
    source: "search-console",
    asOf: "2026-07-26",
    lagDays: 2,
    basis: "assumed",
  },
  criteria: { basis: "request", limit: 10 },
};

describe("SeoIntelligenceContainer accessibility", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("has zero axe violations in the pre-submission (idle) state", async () => {
    const { container } = render(<SeoIntelligenceContainer />);
    expect((await axe(container)).violations).toEqual([]);
  });

  it("has zero axe violations once an opportunities result is rendered", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse(AUTHENTICATED_ENVELOPE),
    );
    const user = userEvent.setup();
    const { container } = render(<SeoIntelligenceContainer />);
    await user.type(
      screen.getByLabelText(/site url|property/i),
      "sc-domain:example.com",
    );
    await user.click(
      screen.getByRole("button", { name: /find opportunities/i }),
    );
    await screen.findByTestId("effective-criteria-panel");

    expect((await axe(container)).violations).toEqual([]);
  });

  it("has zero axe violations on the domain report tab", async () => {
    const user = userEvent.setup();
    const { container } = render(<SeoIntelligenceContainer />);
    await user.click(screen.getByRole("tab", { name: /domain report/i }));

    expect((await axe(container)).violations).toEqual([]);
  });

  it("every top-level control is reachable via keyboard alone", async () => {
    const user = userEvent.setup();
    render(<SeoIntelligenceContainer />);

    await user.type(
      screen.getByLabelText(/site url|property/i),
      "sc-domain:example.com",
    );

    const controls = [
      screen.getByLabelText(/site url|property/i),
      screen.getByLabelText(/start date/i),
      screen.getByLabelText(/end date/i),
      screen.getByRole("tab", { name: /seo opportunities/i }),
      screen.getByRole("tab", { name: /keyword cannibalization/i }),
      screen.getByRole("tab", { name: /domain report/i }),
      screen.getByRole("button", { name: /find opportunities/i }),
    ];

    const visited = new Set<Element>();
    for (let i = 0; i < controls.length + 25; i++) {
      await user.tab();
      if (document.activeElement) visited.add(document.activeElement);
    }

    for (const control of controls) {
      expect(visited.has(control)).toBe(true);
    }
  });
});
