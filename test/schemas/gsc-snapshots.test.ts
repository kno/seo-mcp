import { describe, expect, it } from "vitest";
import {
  storedSnapshotSchema,
  gscMetricsSchema,
  gscDiffRowSchema,
  gscDiffSchema,
} from "../../src/schemas/gsc-snapshots";

function metrics(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    clicks: 12,
    impressions: 340,
    ctr: 0.035,
    position: 4.2,
    ...overrides,
  };
}

describe("storedSnapshotSchema", () => {
  it("accepts a real StoredSnapshot fixture", () => {
    const fixture = {
      id: 7,
      siteUrl: "sc-domain:example.com",
      capturedAt: "2026-01-01T00:00:00.000Z",
      startDate: "2025-12-01",
      endDate: "2025-12-31",
      label: "December baseline",
    };
    expect(storedSnapshotSchema.parse(fixture)).toEqual(fixture);
  });

  it("accepts a null label", () => {
    const fixture = {
      id: 7,
      siteUrl: "sc-domain:example.com",
      capturedAt: "2026-01-01T00:00:00.000Z",
      startDate: "2025-12-01",
      endDate: "2025-12-31",
      label: null,
    };
    expect(storedSnapshotSchema.parse(fixture)).toEqual(fixture);
  });

  it("rejects a missing label field (must be string | null, not optional)", () => {
    const fixture = {
      id: 7,
      siteUrl: "sc-domain:example.com",
      capturedAt: "2026-01-01T00:00:00.000Z",
      startDate: "2025-12-01",
      endDate: "2025-12-31",
    };
    expect(() => storedSnapshotSchema.parse(fixture)).toThrow();
  });
});

describe("gscMetricsSchema", () => {
  it("accepts a real GscMetrics fixture", () => {
    expect(gscMetricsSchema.parse(metrics())).toEqual(metrics());
  });
});

describe("gscDiffRowSchema", () => {
  it("accepts a row with both base and current present", () => {
    const fixture = {
      query: "seo tool",
      page: "https://example.com/page",
      base: metrics(),
      current: metrics({ clicks: 20 }),
      clicksDelta: 8,
      impressionsDelta: 0,
      positionDelta: -0.5,
    };
    expect(gscDiffRowSchema.parse(fixture)).toEqual(fixture);
  });

  it("accepts a lost row with current: null", () => {
    const fixture = {
      query: "seo tool",
      page: "https://example.com/page",
      base: metrics(),
      current: null,
      clicksDelta: -12,
      impressionsDelta: -340,
      positionDelta: -4.2,
    };
    expect(gscDiffRowSchema.parse(fixture)).toEqual(fixture);
  });

  it("accepts a gained row with base: null", () => {
    const fixture = {
      query: "seo tool",
      page: "https://example.com/page",
      base: null,
      current: metrics(),
      clicksDelta: 12,
      impressionsDelta: 340,
      positionDelta: 4.2,
    };
    expect(gscDiffRowSchema.parse(fixture)).toEqual(fixture);
  });

  it("rejects a row where base is omitted rather than explicitly null", () => {
    const fixture = {
      query: "seo tool",
      page: "https://example.com/page",
      current: metrics(),
      clicksDelta: 12,
      impressionsDelta: 340,
      positionDelta: 4.2,
    };
    expect(() => gscDiffRowSchema.parse(fixture)).toThrow();
  });
});

describe("gscDiffSchema", () => {
  it("accepts a real GscDiff fixture with all four direction buckets", () => {
    const decayedRow = {
      query: "decayed query",
      page: "https://example.com/decayed",
      base: metrics(),
      current: metrics({ clicks: 2 }),
      clicksDelta: -10,
      impressionsDelta: -50,
      positionDelta: 3,
    };
    const improvedRow = {
      query: "improved query",
      page: "https://example.com/improved",
      base: metrics(),
      current: metrics({ clicks: 30 }),
      clicksDelta: 18,
      impressionsDelta: 20,
      positionDelta: -2,
    };
    const lostRow = {
      query: "lost query",
      page: "https://example.com/lost",
      base: metrics(),
      current: null,
      clicksDelta: -12,
      impressionsDelta: -340,
      positionDelta: -4.2,
    };
    const gainedRow = {
      query: "gained query",
      page: "https://example.com/gained",
      base: null,
      current: metrics(),
      clicksDelta: 12,
      impressionsDelta: 340,
      positionDelta: 4.2,
    };
    const fixture = {
      baseCount: 10,
      currentCount: 9,
      decayed: [decayedRow],
      improved: [improvedRow],
      lost: [lostRow],
      gained: [gainedRow],
    };
    expect(gscDiffSchema.parse(fixture)).toEqual(fixture);
  });

  it("rejects a payload missing one of the four buckets", () => {
    const fixture = {
      baseCount: 10,
      currentCount: 9,
      decayed: [],
      improved: [],
      lost: [],
      // gained omitted
    };
    expect(() => gscDiffSchema.parse(fixture)).toThrow();
  });
});
