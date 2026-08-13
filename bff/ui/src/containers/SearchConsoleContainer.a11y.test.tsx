import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { GscQueryResult } from "../../../../src/types";
import { SearchConsoleContainer } from "./SearchConsoleContainer";

const RESULT: GscQueryResult = {
  siteUrl: "sc-domain:example.com",
  startDate: "2026-07-16",
  endDate: "2026-08-13",
  dimensions: ["query"],
  rowCount: 1,
  rows: [
    {
      keys: ["seo tool"],
      clicks: 120,
      impressions: 4000,
      ctr: 0.03,
      position: 5.2,
    },
  ],
};

function jsonResponse(body: unknown): Response {
  return { json: () => Promise.resolve(body) } as Response;
}

describe("SearchConsoleContainer accessibility", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("has zero axe violations in the pre-submission (idle) state", async () => {
    const { container } = render(<SearchConsoleContainer />);
    expect((await axe(container)).violations).toEqual([]);
  });

  it("has zero axe violations once a result is rendered", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({
        data: RESULT,
        cacheStatus: "miss",
        resultAge: 0,
        sourceFreshness: {
          source: "search-console",
          asOf: "2026-08-11",
          lagDays: 2,
          basis: "assumed",
        },
      }),
    );
    const user = userEvent.setup();
    const { container } = render(<SearchConsoleContainer />);
    await user.type(
      screen.getByLabelText(/site url|property/i),
      "sc-domain:example.com",
    );
    await user.click(screen.getByRole("button", { name: /run query/i }));
    await screen.findByRole("table");

    expect((await axe(container)).violations).toEqual([]);
  });

  it("every form control is reachable and operable via keyboard alone", async () => {
    const user = userEvent.setup();
    render(<SearchConsoleContainer />);

    const controls = [
      screen.getByLabelText(/site url|property/i),
      screen.getByLabelText(/start date/i),
      screen.getByLabelText(/end date/i),
      screen.getByLabelText(/row limit/i),
      screen.getByRole("checkbox", { name: "query" }),
      screen.getByRole("button", { name: /run query/i }),
    ];

    const visited = new Set<Element>();
    for (let i = 0; i < controls.length + 5; i++) {
      await user.tab();
      if (document.activeElement) visited.add(document.activeElement);
    }

    for (const control of controls) {
      expect(visited.has(control)).toBe(true);
    }
  });
});
