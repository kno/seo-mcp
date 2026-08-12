import { LIMITS } from "../config";
import type { SiteCrawlResult } from "../crawl/site";
import type { CrawlSnapshotPage } from "../seo/crawl-diff";

export interface StoredCrawlSnapshot {
  id: number;
  url: string;
  capturedAt: string;
  label: string | null;
  crawled: number;
  failed: number;
  issueCounts: Record<string, number>;
}

interface CrawlSnapshotInput {
  url: string;
  capturedAt: string;
  label?: string;
  site: SiteCrawlResult;
}

interface CrawlSnapshotRecord {
  id: number;
  url: string;
  captured_at: string;
  label: string | null;
  crawled: number;
  failed: number;
  issue_counts: string;
}

function toStored(record: CrawlSnapshotRecord): StoredCrawlSnapshot {
  return {
    id: record.id,
    url: record.url,
    capturedAt: record.captured_at,
    label: record.label,
    crawled: record.crawled,
    failed: record.failed,
    issueCounts: JSON.parse(record.issue_counts) as Record<string, number>,
  };
}

export async function storeCrawlSnapshot(
  db: D1Database,
  snapshot: CrawlSnapshotInput,
): Promise<{ snapshotId: number; pageCount: number }> {
  const { site } = snapshot;
  const inserted = await db
    .prepare(
      "INSERT INTO crawl_snapshots (url, captured_at, label, crawled, failed, issue_counts) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(
      snapshot.url,
      snapshot.capturedAt,
      snapshot.label ?? null,
      site.crawled,
      site.failed,
      JSON.stringify(site.issueCounts),
    )
    .run();

  const snapshotId = Number(inserted.meta.last_row_id);
  const pages = site.pages
    .filter((page) => page.result)
    .slice(0, LIMITS.maxCrawlSnapshotPages);

  if (pages.length > 0) {
    const statement = db.prepare(
      "INSERT INTO crawl_snapshot_pages (snapshot_id, page_url, issue_codes) VALUES (?, ?, ?)",
    );
    await db.batch(
      pages.map((page) =>
        statement.bind(
          snapshotId,
          page.url,
          JSON.stringify(page.result!.issues.map((issue) => issue.code)),
        ),
      ),
    );
  }

  return { snapshotId, pageCount: pages.length };
}

export async function listCrawlSnapshots(
  db: D1Database,
  url: string,
  limit?: number,
): Promise<StoredCrawlSnapshot[]> {
  const { results } = await db
    .prepare(
      "SELECT id, url, captured_at, label, crawled, failed, issue_counts FROM crawl_snapshots WHERE url = ? ORDER BY captured_at DESC, id DESC LIMIT ?",
    )
    .bind(url, limit ?? 20)
    .all<CrawlSnapshotRecord>();
  return results.map(toStored);
}

export async function getCrawlSnapshotPages(
  db: D1Database,
  snapshotId: number,
): Promise<CrawlSnapshotPage[]> {
  const { results } = await db
    .prepare(
      "SELECT page_url, issue_codes FROM crawl_snapshot_pages WHERE snapshot_id = ?",
    )
    .bind(snapshotId)
    .all<{ page_url: string; issue_codes: string }>();
  return results.map((r) => ({
    page: r.page_url,
    issueCodes: JSON.parse(r.issue_codes) as string[],
  }));
}

export async function twoMostRecentCrawls(
  db: D1Database,
  url: string,
): Promise<{ base: StoredCrawlSnapshot; current: StoredCrawlSnapshot } | null> {
  const recent = await listCrawlSnapshots(db, url, 2);
  if (recent.length < 2) return null;
  return { current: recent[0], base: recent[1] };
}
