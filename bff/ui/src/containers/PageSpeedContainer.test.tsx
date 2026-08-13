import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PageSpeedResult } from "../../../../src/pagespeed/types";
import { PageSpeedContainer } from "./PageSpeedContainer";

const RESULT: PageSpeedResult = {
  url: "https://example.com",
  strategy: "mobile",
  performanceScore: 90,
  accessibilityScore: 80,
  bestPracticesScore: 100,
  seoScore: 95,
  labMetrics: {
    firstContentfulPaintMs: 800,
    largestContentfulPaintMs: 2400,
    totalBlockingTimeMs: 50,
    cumulativeLayoutShift: 0.05,
    speedIndexMs: 1200,
  },
  fieldMetrics: { overallCategory: "FAST", interactionToNextPaintMs: 150 },
  opportunities: [
    { id: "unused-css", title: "Remove unused CSS", savingsMs: 300 },
  ],
};

function jsonResponse(body: unknown): Response {
  return { json: () => Promise.resolve(body) } as Response;
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/page url/i), "https://example.com");
  await user.click(screen.getByRole("button", { name: /analyze/i }));
}

describe("PageSpeedContainer", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("issues no analyze_pagespeed request on mount", () => {
    render(<PageSpeedContainer />);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("submits the mobile strategy by default and renders every result panel", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({ data: RESULT, cacheStatus: "miss", resultAge: 0 }),
    );
    const user = userEvent.setup();
    render(<PageSpeedContainer />);

    await fillAndSubmit(user);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const requestUrl = String(vi.mocked(global.fetch).mock.calls[0]?.[0]);
    expect(requestUrl).toContain("/api/tools/analyze_pagespeed");
    expect(requestUrl).toContain("strategy=mobile");

    expect(
      await screen.findByRole("table", { name: /optimization opportunities/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Remove unused CSS")).toBeInTheDocument();
    expect(screen.getByText("FAST")).toBeInTheDocument();
  });

  it("shows the shared error-state contract when analyze_pagespeed fails", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({ error: { code: "bff_timeout", message: "too slow" } }),
    );
    const user = userEvent.setup();
    render(<PageSpeedContainer />);

    await fillAndSubmit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(/timed out/i);
  });
});
