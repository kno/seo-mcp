-- Persisted domain list backing the dashboard's global site selector.

CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  label TEXT,
  created_at TEXT NOT NULL
);
