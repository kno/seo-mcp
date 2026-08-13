import type * as z from "zod/v4";
import { LIMITS } from "../config";
import type { GscRow } from "../google/search-console";
import { storedSnapshotSchema } from "../schemas/gsc-snapshots";

export type StoredSnapshot = z.infer<typeof storedSnapshotSchema>;

interface SnapshotInput {
  siteUrl: string;
  startDate: string;
  endDate: string;
  label?: string;
  capturedAt: string;
  rows: GscRow[];
}

interface SnapshotRecord {
  id: number;
  site_url: string;
  captured_at: string;
  start_date: string;
  end_date: string;
  label: string | null;
}

function toStored(record: SnapshotRecord): StoredSnapshot {
  return {
    id: record.id,
    siteUrl: record.site_url,
    capturedAt: record.captured_at,
    startDate: record.start_date,
    endDate: record.end_date,
    label: record.label,
  };
}

export async function storeGscSnapshot(
  db: D1Database,
  snapshot: SnapshotInput,
): Promise<{ snapshotId: number; rowCount: number }> {
  const inserted = await db
    .prepare(
      "INSERT INTO gsc_snapshots (site_url, captured_at, start_date, end_date, label) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(
      snapshot.siteUrl,
      snapshot.capturedAt,
      snapshot.startDate,
      snapshot.endDate,
      snapshot.label ?? null,
    )
    .run();

  const snapshotId = Number(inserted.meta.last_row_id);
  const rows = snapshot.rows.slice(0, LIMITS.maxSnapshotRows);

  if (rows.length > 0) {
    const statement = db.prepare(
      "INSERT INTO gsc_rows (snapshot_id, query, page, clicks, impressions, ctr, position) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    await db.batch(
      rows.map((row) =>
        statement.bind(
          snapshotId,
          row.keys[0] ?? "",
          row.keys[1] ?? "",
          row.clicks,
          row.impressions,
          row.ctr,
          row.position,
        ),
      ),
    );
  }

  return { snapshotId, rowCount: rows.length };
}

export async function listSnapshots(
  db: D1Database,
  siteUrl: string,
  limit?: number,
): Promise<StoredSnapshot[]> {
  const { results } = await db
    .prepare(
      "SELECT id, site_url, captured_at, start_date, end_date, label FROM gsc_snapshots WHERE site_url = ? ORDER BY captured_at DESC, id DESC LIMIT ?",
    )
    .bind(siteUrl, limit ?? 20)
    .all<SnapshotRecord>();
  return results.map(toStored);
}

export async function getSnapshotRows(
  db: D1Database,
  snapshotId: number,
): Promise<GscRow[]> {
  const { results } = await db
    .prepare(
      "SELECT query, page, clicks, impressions, ctr, position FROM gsc_rows WHERE snapshot_id = ?",
    )
    .bind(snapshotId)
    .all<{
      query: string;
      page: string;
      clicks: number;
      impressions: number;
      ctr: number;
      position: number;
    }>();
  return results.map((r) => ({
    keys: [r.query, r.page],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
  }));
}

export async function twoMostRecent(
  db: D1Database,
  siteUrl: string,
): Promise<{ base: StoredSnapshot; current: StoredSnapshot } | null> {
  const recent = await listSnapshots(db, siteUrl, 2);
  if (recent.length < 2) return null;
  return { current: recent[0], base: recent[1] };
}
