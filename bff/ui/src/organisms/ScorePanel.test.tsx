import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScorePanel } from "./ScorePanel";

describe("ScorePanel", () => {
  it("displays all four category scores when present", () => {
    render(
      <ScorePanel
        performanceScore={90}
        accessibilityScore={80}
        bestPracticesScore={100}
        seoScore={95}
      />,
    );
    expect(screen.getByText("90")).toBeInTheDocument();
    expect(screen.getByText("80")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("shows accessibility as unavailable, not zero, when accessibilityScore is absent", () => {
    render(
      <ScorePanel
        performanceScore={90}
        accessibilityScore={undefined}
        bestPracticesScore={100}
        seoScore={95}
      />,
    );
    const accessibilityGauge = screen.getByTestId("gauge-Accessibility");
    expect(accessibilityGauge.textContent).toMatch(/not present/i);
    expect(accessibilityGauge.textContent).not.toContain("0");
  });
});
