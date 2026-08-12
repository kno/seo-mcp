-- Crawl snapshots for crawl history and content/issue regression detection.

CREATE TABLE IF NOT EXISTS crawl_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  label TEXT,
  crawled INTEGER NOT NULL,
  failed INTEGER NOT NULL,
  issue_counts TEXT NOT NULL  -- JSON object
);

CREATE TABLE IF NOT EXISTS crawl_snapshot_pages (
  snapshot_id INTEGER NOT NULL REFERENCES crawl_snapshots (id) ON DELETE CASCADE,
  page_url TEXT NOT NULL,
  issue_codes TEXT NOT NULL  -- JSON array of issue code strings
);

CREATE INDEX IF NOT EXISTS idx_crawl_snapshots_url ON crawl_snapshots (url, captured_at);
CREATE INDEX IF NOT EXISTS idx_crawl_snapshot_pages_snapshot ON crawl_snapshot_pages (snapshot_id);
