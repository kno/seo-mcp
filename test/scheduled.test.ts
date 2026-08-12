import { describe, expect, it } from "vitest";
import {
  parseProperties,
  runScheduledSnapshots,
  snapshotWindow,
} from "../src/scheduled";
import type { Env } from "../src/config";

describe("snapshotWindow", () => {
  it("returns endDate = now-3d and startDate = now-31d as UTC YYYY-MM-DD", () => {
    const fixed = Date.UTC(2026, 7, 12, 10, 30, 0); // 2026-08-12T10:30:00Z
    const { startDate, endDate } = snapshotWindow(() => fixed);
    expect(endDate).toBe("2026-08-09");
    expect(startDate).toBe("2026-07-12");
  });

  it("drops the time component and stays deterministic", () => {
    const fixed = Date.UTC(2026, 0, 5, 23, 59, 59); // 2026-01-05T23:59:59Z
    const { startDate, endDate } = snapshotWindow(() => fixed);
    expect(endDate).toBe("2026-01-02");
    expect(startDate).toBe("2025-12-05");
  });
});

describe("parseProperties", () => {
  it("splits on comma, trims, and drops empties", () => {
    expect(parseProperties("a.com, b.com ,,  c.com ")).toEqual([
      "a.com",
      "b.com",
      "c.com",
    ]);
  });

  it("returns an empty array for undefined or blank input", () => {
    expect(parseProperties(undefined)).toEqual([]);
    expect(parseProperties("   ")).toEqual([]);
    expect(parseProperties(",, ,")).toEqual([]);
  });
});

describe("runScheduledSnapshots", () => {
  it("skips with no-db when env.DB is missing", async () => {
    const env = {} as Env;
    const summary = await runScheduledSnapshots(env);
    expect(summary).toEqual({ attempted: 0, stored: 0, skipped: ["no-db"] });
  });

  it("skips with no-properties when no properties are configured", async () => {
    const env = { DB: {} as unknown as D1Database } as Env;
    const summary = await runScheduledSnapshots(env);
    expect(summary).toEqual({
      attempted: 0,
      stored: 0,
      skipped: ["no-properties"],
    });
  });
});
