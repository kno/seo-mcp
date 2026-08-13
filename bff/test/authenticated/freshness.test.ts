/**
 * `search_console_query` returns no freshness field (design.md, "Verified
 * source facts"), so the reporting lag is derived, not read:
 * `asOf = min(endDate, today − GSC_REPORTING_LAG_DAYS)`, `lagDays` is the
 * whole number of days between `asOf` and the request date, and `basis`
 * stays `"assumed"` until a future probe upgrades it to `"reported"`.
 */
import { describe, expect, it } from "vitest";
import {
  deriveSourceFreshness,
  GSC_REPORTING_LAG_DAYS,
} from "../../src/authenticated/freshness";

describe("deriveSourceFreshness", () => {
  it("caps asOf at today minus the reporting lag when endDate is recent (default 28-day range ending today)", () => {
    const today = new Date("2026-08-13T00:00:00Z");
    const freshness = deriveSourceFreshness(
      "search-console",
      "2026-08-13", // endDate = today, i.e. the default last-28-days range
      today,
    );
    expect(freshness.source).toBe("search-console");
    expect(freshness.asOf).toBe("2026-08-11"); // today - GSC_REPORTING_LAG_DAYS
    expect(freshness.lagDays).toBe(GSC_REPORTING_LAG_DAYS);
    expect(freshness.basis).toBe("assumed");
  });

  it("uses endDate directly when it already predates the lag window", () => {
    const today = new Date("2026-08-13T00:00:00Z");
    const freshness = deriveSourceFreshness(
      "search-console",
      "2026-07-01",
      today,
    );
    expect(freshness.asOf).toBe("2026-07-01");
    expect(freshness.lagDays).toBe(43); // whole days between 2026-07-01 and 2026-08-13
    expect(freshness.basis).toBe("assumed");
  });

  it("never reports a combined field — asOf and lagDays stay separate, incommensurable units", () => {
    const freshness = deriveSourceFreshness(
      "search-console",
      "2026-08-13",
      new Date("2026-08-13T00:00:00Z"),
    );
    expect(Object.keys(freshness).sort()).toEqual([
      "asOf",
      "basis",
      "lagDays",
      "source",
    ]);
  });

  it("accepts an explicit lag override without changing the default export's value", () => {
    const today = new Date("2026-08-13T00:00:00Z");
    const freshness = deriveSourceFreshness(
      "search-console",
      "2026-08-13",
      today,
      5,
    );
    expect(freshness.asOf).toBe("2026-08-08");
    expect(freshness.lagDays).toBe(5);
  });
});
