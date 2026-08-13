import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FreshnessBadge } from "./FreshnessBadge";

describe("FreshnessBadge", () => {
  it("shows a low/zero age for a freshly fetched (miss) result", () => {
    render(
      <FreshnessBadge
        cacheStatus="miss"
        resultAge={0}
        receivedAtMs={1_000}
        now={() => 1_000}
      />,
    );
    expect(screen.getByTestId("freshness-badge")).toHaveTextContent(
      "Fresh result",
    );
    expect(screen.getByTestId("freshness-badge")).not.toHaveTextContent(
      "Cached",
    );
  });

  it("shows the actual elapsed age for a cached (hit) result", () => {
    render(
      <FreshnessBadge
        cacheStatus="hit"
        resultAge={300}
        receivedAtMs={1_000}
        now={() => 1_000}
      />,
    );
    expect(screen.getByTestId("freshness-badge")).toHaveTextContent(
      "Cached result — 300s old",
    );
  });

  it("adds client-elapsed time since receipt without a ticking timer", () => {
    render(
      <FreshnessBadge
        cacheStatus="hit"
        resultAge={60}
        receivedAtMs={1_000}
        now={() => 1_000 + 10_000}
      />,
    );
    // 60s reported by the BFF + 10s elapsed client-side since receipt.
    expect(screen.getByTestId("freshness-badge")).toHaveTextContent("70s old");
  });

  it("is visible without opening devtools — plain rendered text, no tooltip-only content", () => {
    render(
      <FreshnessBadge
        cacheStatus="hit"
        resultAge={5}
        receivedAtMs={1_000}
        now={() => 1_000}
      />,
    );
    expect(screen.getByText(/5s old/)).toBeVisible();
  });
});
