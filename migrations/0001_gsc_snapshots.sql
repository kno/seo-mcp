-- Search Console snapshots for period-over-period comparison and content-decay detection.

CREATE TABLE IF NOT EXISTS gsc_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_url TEXT NOT NULL,
  captured_at TEXT NOT NULL, -- ISO-8601 timestamp when the snapshot was stored
  start_date TEXT NOT NULL,  -- GSC query range start (YYYY-MM-DD)
  end_date TEXT NOT NULL,    -- GSC query range end (YYYY-MM-DD)
  label TEXT                 -- optional human label
);

CREATE TABLE IF NOT EXISTS gsc_rows (
  snapshot_id INTEGER NOT NULL REFERENCES gsc_snapshots (id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  page TEXT NOT NULL,
  clicks REAL NOT NULL,
  impressions REAL NOT NULL,
  ctr REAL NOT NULL,
  position REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gsc_snapshots_site ON gsc_snapshots (site_url, captured_at);
CREATE INDEX IF NOT EXISTS idx_gsc_rows_snapshot ON gsc_rows (snapshot_id);
