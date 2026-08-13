import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LabMetricsPanel } from "./LabMetricsPanel";

describe("LabMetricsPanel", () => {
  it("renders present metrics labeled with their unit", () => {
    render(
      <LabMetricsPanel
        labMetrics={{
          firstContentfulPaintMs: 800,
          largestContentfulPaintMs: 2400,
          totalBlockingTimeMs: 50,
          cumulativeLayoutShift: 0.05,
          speedIndexMs: 1200,
        }}
      />,
    );
    expect(
      screen.getByTestId("lab-metric-Largest Contentful Paint"),
    ).toHaveTextContent("2400 ms");
    expect(
      screen.getByTestId("lab-metric-Cumulative Layout Shift"),
    ).toHaveTextContent("0.05");
  });

  it("renders an absent lab metric as unavailable, distinguishable from a 0 value", () => {
    render(
      <LabMetricsPanel
        labMetrics={{
          firstContentfulPaintMs: 800,
          largestContentfulPaintMs: 2400,
          totalBlockingTimeMs: 50,
          cumulativeLayoutShift: 0.05,
          speedIndexMs: undefined,
        }}
      />,
    );
    const speedIndex = screen.getByTestId("lab-metric-Speed Index");
    expect(speedIndex.textContent).toMatch(/not present/i);
  });

  it("renders a genuine zero cumulativeLayoutShift as 0, not as unavailable", () => {
    render(
      <LabMetricsPanel
        labMetrics={{
          firstContentfulPaintMs: 800,
          largestContentfulPaintMs: 2400,
          totalBlockingTimeMs: 50,
          cumulativeLayoutShift: 0,
          speedIndexMs: 1200,
        }}
      />,
    );
    const cls = screen.getByTestId("lab-metric-Cumulative Layout Shift");
    expect(cls).toHaveTextContent("0");
    expect(cls.textContent).not.toMatch(/not present/i);
  });
});
