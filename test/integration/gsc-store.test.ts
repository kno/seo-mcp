import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  storeGscSnapshot,
  listSnapshots,
  getSnapshotRows,
  twoMostRecent,
  deleteGscSnapshot,
} from "../../src/db/gsc-store";
import { LIMITS } from "../../src/config";
import type { GscRow } from "../../src/google/search-console";

const DB = (env as { DB: D1Database }).DB;

function row(
  query: string,
  page: string,
  clicks: number,
  impressions: number,
  position: number,
): GscRow {
  const ctr = impressions > 0 ? clicks / impressions : 0;
  return { keys: [query, page], clicks, impressions, ctr, position };
}

beforeAll(async () => {
  await DB.exec(
    "CREATE TABLE IF NOT EXISTS gsc_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, site_url TEXT NOT NULL, captured_at TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, label TEXT)",
  );
  await DB.exec(
    "CREATE TABLE IF NOT EXISTS gsc_rows (snapshot_id INTEGER NOT NULL REFERENCES gsc_snapshots (id) ON DELETE CASCADE, query TEXT NOT NULL, page TEXT NOT NULL, clicks REAL NOT NULL, impressions REAL NOT NULL, ctr REAL NOT NULL, position REAL NOT NULL)",
  );
  await DB.exec(
    "CREATE INDEX IF NOT EXISTS idx_gsc_snapshots_site ON gsc_snapshots (site_url, captured_at)",
  );
  await DB.exec(
    "CREATE INDEX IF NOT EXISTS idx_gsc_rows_snapshot ON gsc_rows (snapshot_id)",
  );
});

beforeEach(async () => {
  await DB.exec("DELETE FROM gsc_rows");
  await DB.exec("DELETE FROM gsc_snapshots");
});

describe("gsc-store (real D1 via Miniflare)", () => {
  it("stores a snapshot and round-trips its rows", async () => {
    const rows = [
      row("shoes", "/p1", 100, 1000, 3),
      row("boots", "/p2", 50, 800, 7),
    ];
    const { snapshotId, rowCount } = await storeGscSnapshot(DB, {
      siteUrl: "sc-domain:example.com",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      label: "july",
      capturedAt: "2026-08-01T00:00:00.000Z",
      rows,
    });

    expect(snapshotId).toBeGreaterThan(0);
    expect(rowCount).toBe(2);

    const stored = await getSnapshotRows(DB, snapshotId);
    expect(stored).toHaveLength(2);
    expect(stored).toEqual(
      expect.arrayContaining([
        {
          keys: ["shoes", "/p1"],
          clicks: 100,
          impressions: 1000,
          ctr: 0.1,
          position: 3,
        },
        {
          keys: ["boots", "/p2"],
          clicks: 50,
          impressions: 800,
          ctr: 0.0625,
          position: 7,
        },
      ]),
    );
  });

  it("stores rows with empty query/page keys defaults", async () => {
    const { snapshotId } = await storeGscSnapshot(DB, {
      siteUrl: "sc-domain:example.com",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      capturedAt: "2026-08-01T00:00:00.000Z",
      rows: [{ keys: [], clicks: 1, impressions: 10, ctr: 0.1, position: 2 }],
    });
    const stored = await getSnapshotRows(DB, snapshotId);
    expect(stored[0].keys).toEqual(["", ""]);
  });

  it("lists snapshots ordered by captured_at DESC and respects limit", async () => {
    const base = {
      siteUrl: "sc-domain:example.com",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      rows: [] as GscRow[],
    };
    await storeGscSnapshot(DB, {
      ...base,
      label: "oldest",
      capturedAt: "2026-08-01T00:00:00.000Z",
    });
    await storeGscSnapshot(DB, {
      ...base,
      label: "middle",
      capturedAt: "2026-08-05T00:00:00.000Z",
    });
    await storeGscSnapshot(DB, {
      ...base,
      label: "newest",
      capturedAt: "2026-08-10T00:00:00.000Z",
    });

    const all = await listSnapshots(DB, "sc-domain:example.com");
    expect(all.map((s) => s.label)).toEqual(["newest", "middle", "oldest"]);
    expect(all[0].siteUrl).toBe("sc-domain:example.com");
    expect(all[0].capturedAt).toBe("2026-08-10T00:00:00.000Z");

    const limited = await listSnapshots(DB, "sc-domain:example.com", 2);
    expect(limited.map((s) => s.label)).toEqual(["newest", "middle"]);
  });

  it("scopes list by site_url", async () => {
    await storeGscSnapshot(DB, {
      siteUrl: "sc-domain:a.com",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      capturedAt: "2026-08-01T00:00:00.000Z",
      rows: [],
    });
    await storeGscSnapshot(DB, {
      siteUrl: "sc-domain:b.com",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      capturedAt: "2026-08-02T00:00:00.000Z",
      rows: [],
    });
    const forA = await listSnapshots(DB, "sc-domain:a.com");
    expect(forA).toHaveLength(1);
    expect(forA[0].siteUrl).toBe("sc-domain:a.com");
  });

  it("twoMostRecent returns current=newest and base=previous", async () => {
    const base = {
      siteUrl: "sc-domain:example.com",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      rows: [] as GscRow[],
    };
    const first = await storeGscSnapshot(DB, {
      ...base,
      label: "first",
      capturedAt: "2026-08-01T00:00:00.000Z",
    });
    const second = await storeGscSnapshot(DB, {
      ...base,
      label: "second",
      capturedAt: "2026-08-05T00:00:00.000Z",
    });
    const third = await storeGscSnapshot(DB, {
      ...base,
      label: "third",
      capturedAt: "2026-08-10T00:00:00.000Z",
    });

    const pair = await twoMostRecent(DB, "sc-domain:example.com");
    expect(pair).not.toBeNull();
    expect(pair!.current.id).toBe(third.snapshotId);
    expect(pair!.base.id).toBe(second.snapshotId);
    expect(first.snapshotId).toBeGreaterThan(0);
  });

  it("twoMostRecent returns null with fewer than two snapshots", async () => {
    expect(await twoMostRecent(DB, "sc-domain:none.com")).toBeNull();
    await storeGscSnapshot(DB, {
      siteUrl: "sc-domain:none.com",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      capturedAt: "2026-08-01T00:00:00.000Z",
      rows: [],
    });
    expect(await twoMostRecent(DB, "sc-domain:none.com")).toBeNull();
  });

  it("deleteGscSnapshot removes an existing snapshot and cascades its rows", async () => {
    const { snapshotId } = await storeGscSnapshot(DB, {
      siteUrl: "sc-domain:example.com",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      capturedAt: "2026-08-01T00:00:00.000Z",
      rows: [row("shoes", "/p1", 100, 1000, 3)],
    });

    const deleted = await deleteGscSnapshot(DB, snapshotId);
    expect(deleted).toBe(true);

    const remaining = await listSnapshots(DB, "sc-domain:example.com");
    expect(remaining).toHaveLength(0);

    // Prove the ON DELETE CASCADE actually fired, not just trust the
    // migration file — query the child table directly.
    const { results: childRows } = await DB.prepare(
      "SELECT * FROM gsc_rows WHERE snapshot_id = ?",
    )
      .bind(snapshotId)
      .all();
    expect(childRows).toHaveLength(0);
  });

  it("deleteGscSnapshot returns false for a non-existent id", async () => {
    expect(await deleteGscSnapshot(DB, 999999)).toBe(false);
  });

  it("caps stored rows at LIMITS.maxSnapshotRows", async () => {
    const original = LIMITS.maxSnapshotRows;
    (LIMITS as { maxSnapshotRows: number }).maxSnapshotRows = 3;
    try {
      const rows = Array.from({ length: 10 }, (_, i) =>
        row(`q${i}`, `/p${i}`, i, i * 10, i + 1),
      );
      const { snapshotId, rowCount } = await storeGscSnapshot(DB, {
        siteUrl: "sc-domain:cap.com",
        startDate: "2026-07-01",
        endDate: "2026-07-31",
        capturedAt: "2026-08-01T00:00:00.000Z",
        rows,
      });
      expect(rowCount).toBe(3);
      const stored = await getSnapshotRows(DB, snapshotId);
      expect(stored).toHaveLength(3);
    } finally {
      (LIMITS as { maxSnapshotRows: number }).maxSnapshotRows = original;
    }
  });
});
