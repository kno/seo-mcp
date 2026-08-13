import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SeoOpportunitiesPanel } from "./SeoOpportunitiesPanel";
import type { Opportunity } from "../../../../src/schemas/intelligence";

const LOW_CTR: Opportunity = {
  type: "low_ctr",
  query: "seo mcp",
  page: "/landing",
  impressions: 500,
  currentPosition: 4.2,
  impact: 500,
  effort: 1,
  priorityScore: 500,
  recommendation: "Rewrite title/meta description to improve click-through.",
};

const STRIKING_DISTANCE: Opportunity = {
  type: "striking_distance",
  query: "seo tool",
  page: "/tools",
  impressions: 300,
  currentPosition: 14.2,
  impact: 300,
  effort: 2,
  priorityScore: 150,
  recommendation:
    "Strengthen content and internal links to move from page 2 into page 1.",
};

const CANNIBALIZATION: Opportunity = {
  type: "cannibalization",
  query: "seo software",
  page: null,
  impressions: 900,
  currentPosition: null,
  impact: 900,
  effort: 3,
  priorityScore: 300,
  recommendation: "Consolidate or differentiate the competing pages.",
};

describe("SeoOpportunitiesPanel", () => {
  it("renders type and recommendation together for every opportunity (task 10.4)", () => {
    render(<SeoOpportunitiesPanel opportunities={[LOW_CTR]} />);
    expect(screen.getByTestId("opportunity-type-0")).toHaveTextContent(
      "Low CTR",
    );
    expect(
      screen.getByTestId("opportunity-recommendation-0"),
    ).toHaveTextContent(LOW_CTR.recommendation);
  });

  it("gives different type values visibly distinct badge classes (task 10.4)", () => {
    render(
      <SeoOpportunitiesPanel
        opportunities={[LOW_CTR, STRIKING_DISTANCE, CANNIBALIZATION]}
      />,
    );
    expect(screen.getByTestId("opportunity-type-0").className).toContain(
      "opportunity-type-low_ctr",
    );
    expect(screen.getByTestId("opportunity-type-1").className).toContain(
      "opportunity-type-striking_distance",
    );
    expect(screen.getByTestId("opportunity-type-2").className).toContain(
      "opportunity-type-cannibalization",
    );
  });

  it("renders impact, effort and priorityScore together, effort as a coarse label not an invented 0-100 score (task 10.5)", () => {
    render(<SeoOpportunitiesPanel opportunities={[STRIKING_DISTANCE]} />);
    expect(screen.getByTestId("opportunity-impact-0")).toHaveTextContent("300");
    expect(screen.getByTestId("opportunity-priority-0")).toHaveTextContent(
      "150",
    );
    const effortCell = screen.getByTestId("opportunity-effort-0");
    expect(effortCell).toHaveTextContent("Medium");
    expect(effortCell.textContent).not.toMatch(/\d/);
  });

  it("never presents striking_distance's recommendation as link-graph-aware beyond the tool's own text (task 10.7)", () => {
    render(<SeoOpportunitiesPanel opportunities={[STRIKING_DISTANCE]} />);
    const cell = screen.getByTestId("opportunity-recommendation-0");
    expect(cell.textContent).toBe(STRIKING_DISTANCE.recommendation);
    expect(cell.textContent).not.toMatch(/orphan|topLinkedPages|link graph/i);
  });

  it("renders a page-report drill-down link for a non-null page", () => {
    render(<SeoOpportunitiesPanel opportunities={[LOW_CTR]} />);
    const cell = screen.getByTestId("opportunity-page-0");
    expect(cell.querySelector("a")).toHaveAttribute("href", "#page-report");
  });

  it("omits the drill-down affordance entirely for a cannibalization opportunity (page: null) (task 10.11)", () => {
    render(<SeoOpportunitiesPanel opportunities={[CANNIBALIZATION]} />);
    const cell = screen.getByTestId("opportunity-page-0");
    expect(cell.querySelector("a")).toBeNull();
  });
});
