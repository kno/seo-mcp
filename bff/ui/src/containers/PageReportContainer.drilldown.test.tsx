import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { setPendingDrillDown } from "../app/navigation";
import { PageReportContainer } from "./PageReportContainer";

/**
 * Task 10.11: a page-referencing finding's drill-down pre-fills
 * `page-report-view`'s URL field, WITHOUT auto-fetching (`data/client.ts`'s
 * trigger-discipline invariant — no effect on mount performs the request).
 */
describe("PageReportContainer drill-down pre-fill", () => {
  it("pre-fills the URL field from a pending drill-down, without auto-submitting", () => {
    setPendingDrillDown("page-report", "https://example.com/landing");
    render(<PageReportContainer />);
    const input = screen.getByLabelText(/page url/i) as HTMLInputElement;
    expect(input.value).toBe("https://example.com/landing");
    // No request state has been entered — the region only appears once the
    // form is actually submitted.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders an empty URL field when nothing is pending", () => {
    render(<PageReportContainer />);
    const input = screen.getByLabelText(/page url/i) as HTMLInputElement;
    expect(input.value).toBe("");
  });
});
