import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdsQuotaBadge, describeAdsQuotaEstimate } from "./AdsQuotaBadge";

describe("AdsQuotaBadge (task 8.5 — a second, distinct quota indicator)", () => {
  it("renders the Google Ads estimate wording, never the MCP-bucket wording", () => {
    render(
      <AdsQuotaBadge
        quota={{
          source: "google-ads",
          atLeast: 3,
          budget: 100,
          basis: "bff-observed",
        }}
      />,
    );
    const badge = screen.getByTestId("quota-badge-google-ads");
    expect(badge.textContent).toContain("Google Ads");
    expect(badge.textContent).toContain("At least 3");
    expect(badge.textContent).not.toContain("calls observed");
    expect(badge.textContent).not.toContain("Search Console");
  });

  it("has a distinct data-testid from any other quota/headroom indicator", () => {
    render(
      <AdsQuotaBadge
        quota={{
          source: "google-ads",
          atLeast: 0,
          budget: 100,
          basis: "bff-observed",
        }}
      />,
    );
    expect(screen.getByTestId("quota-badge-google-ads")).toBeDefined();
    expect(screen.queryByTestId("headroom-indicator")).toBeNull();
    expect(screen.queryByTestId("source-freshness-badge")).toBeNull();
  });

  it("degrades to an honest unavailable label without a fabricated remaining count", () => {
    const label = describeAdsQuotaEstimate({
      source: "google-ads",
      atLeast: 0,
      budget: 100,
      basis: "unavailable",
    });
    expect(label).toContain("unavailable");
    expect(label).not.toMatch(/\d+ remaining/);
  });
});
