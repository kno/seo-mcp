import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  storeCrawlSnapshot,
  listCrawlSnapshots,
  getCrawlSnapshotPages,
  twoMostRecentCrawls,
} from "../../src/db/crawl-store";
import { LIMITS } from "../../src/config";
import type { SiteCrawlResult, SitePageAnalysis } from "../../src/crawl/site";

const DB = (env as { DB: D1Database }).DB;

function analysis(codes: string[]): SitePageAnalysis {
  return {
    issues: codes.map((code) => ({
      code,
      severity: "warning" as const,
      message: code,
    })),
  } as unknown as SitePageAnalysis;
}

function site(
  pages: Array<{ url: string; codes?: string[]; error?: string }>,
): SiteCrawlResult {
  const built = pages.map((p) =>
    p.error
      ? { url: p.url, error: p.error }
      : { url: p.url, result: analysis(p.codes ?? []) },
  );
  const crawled = built.filter((p) => "result" in p).length;
  const failed = built.filter((p) => "error" in p).length;
  const issueCounts: Record<string, number> = {};
  for (const p of pages)
    for (const c of p.codes ?? []) issueCounts[c] = (issueCounts[c] ?? 0) + 1;
  return {
    site: "https://example.com",
    sitemap: "https://example.com/sitemap.xml",
    sitemapFound: true,
    crawlPolicy: {
      robotsUrl: "https://example.com/robots.txt",
      robotsFound: true,
      userAgent: "test",
      sitemapsDeclared: [],
      disallowedSkipped: { count: 0, sample: [] },
    },
    requested: pages.length,
    crawled,
    failed,
    documentsRead: 1,
    subrequests: 1,
    bytesRead: 1,
    outputBytes: 1,
    pages: built,
    issueCounts,
    summary: {
      pagesAnalyzed: crawled,
      duplicateTitles: [],
      duplicateDescriptions: [],
      missingH1: { count: 0, sample: [] },
      multipleH1: { count: 0, sample: [] },
      thinContent: { count: 0, sample: [] },
      nonIndexable: { count: 0, sample: [] },
      imagesMissingAlt: { pages: 0, images: 0 },
    },
    linkGraph: {
      crawledPages: crawled,
      orphanPages: { count: 0, sample: [] },
      topLinkedPages: [],
    },
  };
}

beforeAll(async () => {
  await DB.exec(
    "CREATE TABLE IF NOT EXISTS crawl_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL, captured_at TEXT NOT NULL, label TEXT, crawled INTEGER NOT NULL, failed INTEGER NOT NULL, issue_counts TEXT NOT NULL)",
  );
  await DB.exec(
    "CREATE TABLE IF NOT EXISTS crawl_snapshot_pages (snapshot_id INTEGER NOT NULL REFERENCES crawl_snapshots (id) ON DELETE CASCADE, page_url TEXT NOT NULL, issue_codes TEXT NOT NULL)",
  );
  await DB.exec(
    "CREATE INDEX IF NOT EXISTS idx_crawl_snapshots_url ON crawl_snapshots (url, captured_at)",
  );
  await DB.exec(
    "CREATE INDEX IF NOT EXISTS idx_crawl_snapshot_pages_snapshot ON crawl_snapshot_pages (snapshot_id)",
  );
});

beforeEach(async () => {
  await DB.exec("DELETE FROM crawl_snapshot_pages");
  await DB.exec("DELETE FROM crawl_snapshots");
});

describe("crawl-store (real D1 via Miniflare)", () => {
  it("stores a snapshot, skips errored pages, and round-trips issue codes", async () => {
    const s = site([
      { url: "https://example.com/a", codes: ["MISSING_H1", "THIN"] },
      { url: "https://example.com/b", codes: [] },
      { url: "https://example.com/c", error: "timeout" },
    ]);
    const { snapshotId, pageCount } = await storeCrawlSnapshot(DB, {
      url: "https://example.com",
      capturedAt: "2026-08-01T00:00:00.000Z",
      label: "first",
      site: s,
    });

    expect(snapshotId).toBeGreaterThan(0);
    expect(pageCount).toBe(2);

    const pages = await getCrawlSnapshotPages(DB, snapshotId);
    expect(pages).toHaveLength(2);
    expect(pages).toEqual(
      expect.arrayContaining([
        { page: "https://example.com/a", issueCodes: ["MISSING_H1", "THIN"] },
        { page: "https://example.com/b", issueCodes: [] },
      ]),
    );
  });

  it("lists snapshots ordered by captured_at DESC with parsed issue_counts and limit", async () => {
    await storeCrawlSnapshot(DB, {
      url: "https://example.com",
      capturedAt: "2026-08-01T00:00:00.000Z",
      label: "oldest",
      site: site([{ url: "https://example.com/a", codes: ["X"] }]),
    });
    await storeCrawlSnapshot(DB, {
      url: "https://example.com",
      capturedAt: "2026-08-05T00:00:00.000Z",
      label: "middle",
      site: site([{ url: "https://example.com/a", codes: ["X", "Y"] }]),
    });
    await storeCrawlSnapshot(DB, {
      url: "https://example.com",
      capturedAt: "2026-08-10T00:00:00.000Z",
      label: "newest",
      site: site([{ url: "https://example.com/a", codes: [] }]),
    });

    const all = await listCrawlSnapshots(DB, "https://example.com");
    expect(all.map((s) => s.label)).toEqual(["newest", "middle", "oldest"]);
    expect(all[0].url).toBe("https://example.com");
    expect(all[1].issueCounts).toEqual({ X: 1, Y: 1 });
    expect(all[0].crawled).toBe(1);

    const limited = await listCrawlSnapshots(DB, "https://example.com", 2);
    expect(limited.map((s) => s.label)).toEqual(["newest", "middle"]);
  });

  it("twoMostRecentCrawls returns current=newest, base=previous", async () => {
    const first = await storeCrawlSnapshot(DB, {
      url: "https://example.com",
      capturedAt: "2026-08-01T00:00:00.000Z",
      site: site([{ url: "https://example.com/a" }]),
    });
    const second = await storeCrawlSnapshot(DB, {
      url: "https://example.com",
      capturedAt: "2026-08-05T00:00:00.000Z",
      site: site([{ url: "https://example.com/a" }]),
    });
    const third = await storeCrawlSnapshot(DB, {
      url: "https://example.com",
      capturedAt: "2026-08-10T00:00:00.000Z",
      site: site([{ url: "https://example.com/a" }]),
    });

    const pair = await twoMostRecentCrawls(DB, "https://example.com");
    expect(pair).not.toBeNull();
    expect(pair!.current.id).toBe(third.snapshotId);
    expect(pair!.base.id).toBe(second.snapshotId);
    expect(first.snapshotId).toBeGreaterThan(0);
  });

  it("twoMostRecentCrawls returns null with fewer than two snapshots", async () => {
    expect(await twoMostRecentCrawls(DB, "https://none.com")).toBeNull();
    await storeCrawlSnapshot(DB, {
      url: "https://none.com",
      capturedAt: "2026-08-01T00:00:00.000Z",
      site: site([{ url: "https://none.com/a" }]),
    });
    expect(await twoMostRecentCrawls(DB, "https://none.com")).toBeNull();
  });

  it("caps stored pages at LIMITS.maxCrawlSnapshotPages", async () => {
    const original = LIMITS.maxCrawlSnapshotPages;
    (LIMITS as { maxCrawlSnapshotPages: number }).maxCrawlSnapshotPages = 3;
    try {
      const pages = Array.from({ length: 10 }, (_, i) => ({
        url: `https://example.com/p${i}`,
        codes: ["A"],
      }));
      const { snapshotId, pageCount } = await storeCrawlSnapshot(DB, {
        url: "https://example.com",
        capturedAt: "2026-08-01T00:00:00.000Z",
        site: site(pages),
      });
      expect(pageCount).toBe(3);
      const stored = await getCrawlSnapshotPages(DB, snapshotId);
      expect(stored).toHaveLength(3);
    } finally {
      (LIMITS as { maxCrawlSnapshotPages: number }).maxCrawlSnapshotPages =
        original;
    }
  });
});
