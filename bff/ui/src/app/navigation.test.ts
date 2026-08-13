import { describe, expect, it } from "vitest";
import { setPendingDrillDown, takePendingDrillDown } from "./navigation";

describe("navigation pending drill-down", () => {
  it("returns the pending url once, then null", () => {
    setPendingDrillDown("page-report", "https://example.com/a");
    expect(takePendingDrillDown("page-report")).toBe("https://example.com/a");
    expect(takePendingDrillDown("page-report")).toBeNull();
  });

  it("leaves a pending value untouched when a different view asks for it", () => {
    setPendingDrillDown("site-crawl", "https://example.com");
    expect(takePendingDrillDown("page-report")).toBeNull();
    expect(takePendingDrillDown("site-crawl")).toBe("https://example.com");
  });

  it("returns null when nothing is pending", () => {
    expect(takePendingDrillDown("page-report")).toBeNull();
  });
});
