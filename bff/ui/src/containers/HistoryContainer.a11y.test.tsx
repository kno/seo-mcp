import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { HistoryContainer } from "./HistoryContainer";

function jsonResponse(body: unknown): Response {
  return { json: () => Promise.resolve(body) } as Response;
}

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
    issueCounts: { "missing-h1": 2 },
  },
];

describe("HistoryContainer accessibility", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("has zero axe violations in the pre-fetch (idle) state", async () => {
    const { container } = render(<HistoryContainer />);
    expect((await axe(container)).violations).toEqual([]);
  });

  it("has zero axe violations once a crawl snapshot list is rendered", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({
        data: {
          url: "https://example.com",
          count: 2,
          snapshots: CRAWL_SNAPSHOTS,
        },
        cacheStatus: "miss",
        resultAge: 0,
      }),
    );
    const user = userEvent.setup();
    const { container } = render(<HistoryContainer />);
    await user.type(
      screen.getByLabelText(/crawl site url/i),
      "https://example.com",
    );
    await user.click(
      screen.getAllByRole("button", { name: /refresh snapshot list/i })[1],
    );
    await screen.findByText("#2");

    expect((await axe(container)).violations).toEqual([]);
  });

  it("every top-level control is reachable via keyboard alone", async () => {
    const user = userEvent.setup();
    render(<HistoryContainer />);

    // The refresh/capture buttons are intentionally disabled (and therefore
    // unfocusable) until a URL is entered — enter both first so this test
    // exercises real reachability, not the deliberately-blocked idle state.
    await user.type(
      screen.getByLabelText(/search console site url/i),
      "sc-domain:example.com",
    );
    await user.type(
      screen.getByLabelText(/crawl site url/i),
      "https://example.com",
    );

    const controls = [
      screen.getByLabelText(/search console site url/i),
      ...screen.getAllByRole("button", { name: /refresh snapshot list/i }),
      screen.getByLabelText(/crawl site url/i),
    ];

    const visited = new Set<Element>();
    for (let i = 0; i < controls.length + 60; i++) {
      await user.tab();
      if (document.activeElement) visited.add(document.activeElement);
    }

    for (const control of controls) {
      expect(visited.has(control)).toBe(true);
    }
  });
});
