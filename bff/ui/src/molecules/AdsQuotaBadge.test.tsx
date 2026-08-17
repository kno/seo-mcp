import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdsQuotaBadge, describeAdsQuotaEstimate } from "./AdsQuotaBadge";

const GLOBAL_CREDENTIAL = { source: "global", accountLabel: null } as const;
const SITE_CREDENTIAL = {
  source: "site",
  accountLabel: "owner@example.com",
} as const;

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
        credential={GLOBAL_CREDENTIAL}
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
        credential={GLOBAL_CREDENTIAL}
      />,
    );
    expect(screen.getByTestId("quota-badge-google-ads")).toBeDefined();
    expect(screen.queryByTestId("headroom-indicator")).toBeNull();
    expect(screen.queryByTestId("source-freshness-badge")).toBeNull();
  });

  it("degrades to an honest unavailable label without a fabricated remaining count", () => {
    const label = describeAdsQuotaEstimate(
      {
        source: "google-ads",
        atLeast: 0,
        budget: 100,
        basis: "unavailable",
      },
      GLOBAL_CREDENTIAL,
    );
    expect(label).toContain("unavailable");
    expect(label).not.toMatch(/\d+ remaining/);
  });

  it("names the connected account's email for a site-tier credential, never a bare number", () => {
    render(
      <AdsQuotaBadge
        quota={{
          source: "google-ads",
          atLeast: 5,
          budget: 100,
          basis: "bff-observed",
        }}
        credential={SITE_CREDENTIAL}
      />,
    );
    expect(screen.getByTestId("quota-badge-google-ads").textContent).toContain(
      "owner@example.com",
    );
  });

  it('names the global tier "operator\'s shared account", never the literal "global"', () => {
    render(
      <AdsQuotaBadge
        quota={{
          source: "google-ads",
          atLeast: 5,
          budget: 100,
          basis: "bff-observed",
        }}
        credential={GLOBAL_CREDENTIAL}
      />,
    );
    const text = screen.getByTestId("quota-badge-google-ads").textContent;
    expect(text).toContain("operator's shared account");
    expect(text).not.toMatch(/\bglobal\b/i);
  });

  it("switching accounts updates the label and estimate, never carrying over the previous account's figure", () => {
    const { rerender } = render(
      <AdsQuotaBadge
        quota={{
          source: "google-ads",
          atLeast: 3,
          budget: 100,
          basis: "bff-observed",
        }}
        credential={{ source: "site", accountLabel: "a@example.com" }}
      />,
    );
    expect(screen.getByTestId("quota-badge-google-ads").textContent).toContain(
      "a@example.com",
    );
    expect(screen.getByTestId("quota-badge-google-ads").textContent).toContain(
      "At least 3",
    );

    rerender(
      <AdsQuotaBadge
        quota={{
          source: "google-ads",
          atLeast: 42,
          budget: 100,
          basis: "bff-observed",
        }}
        credential={{ source: "site", accountLabel: "b@example.com" }}
      />,
    );

    const text = screen.getByTestId("quota-badge-google-ads").textContent;
    expect(text).toContain("b@example.com");
    expect(text).toContain("At least 42");
    expect(text).not.toContain("a@example.com");
    expect(text).not.toContain("At least 3 ");
  });
});
