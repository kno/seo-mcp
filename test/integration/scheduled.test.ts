import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runScheduledSnapshots } from "../../src/scheduled";
import { resetGoogleTokenCache } from "../../src/google/auth";
import type { Env } from "../../src/config";

const DB = (env as { DB: D1Database }).DB;

beforeAll(async () => {
  await DB.exec(
    "CREATE TABLE IF NOT EXISTS gsc_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, site_url TEXT NOT NULL, captured_at TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, label TEXT)",
  );
  await DB.exec(
    "CREATE TABLE IF NOT EXISTS gsc_rows (snapshot_id INTEGER NOT NULL REFERENCES gsc_snapshots (id) ON DELETE CASCADE, query TEXT NOT NULL, page TEXT NOT NULL, clicks REAL NOT NULL, impressions REAL NOT NULL, ctr REAL NOT NULL, position REAL NOT NULL)",
  );
});

beforeEach(async () => {
  resetGoogleTokenCache();
  await DB.exec("DELETE FROM gsc_rows");
  await DB.exec("DELETE FROM gsc_snapshots");
});

function dispatcher() {
  return vi.fn<typeof fetch>(async (input) => {
    const url = input.toString();
    if (url.includes("oauth2.googleapis.com/token")) {
      return Response.json({ access_token: "access-123", expires_in: 3600 });
    }
    return Response.json({
      rows: [
        {
          keys: ["seo tool", "https://example.com/page"],
          clicks: 12,
          impressions: 340,
          ctr: 0.035,
          position: 4.2,
        },
      ],
    });
  });
}

describe("runScheduledSnapshots (real D1 via Miniflare)", () => {
  it("stores one snapshot per configured property", async () => {
    const scheduledEnv: Env = {
      ...(env as unknown as Env),
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret",
      GOOGLE_REFRESH_TOKEN: "refresh-token",
      GSC_SNAPSHOT_PROPERTIES: "sc-domain:example.com",
    };
    const fetcher = dispatcher();

    const summary = await runScheduledSnapshots(scheduledEnv, fetcher, () =>
      Date.UTC(2026, 7, 12),
    );

    expect(summary.attempted).toBe(1);
    expect(summary.stored).toBe(1);
    expect(summary.skipped).toEqual([]);

    const { results } = await DB.prepare(
      "SELECT site_url, label, start_date, end_date FROM gsc_snapshots",
    ).all<{
      site_url: string;
      label: string;
      start_date: string;
      end_date: string;
    }>();
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      site_url: "sc-domain:example.com",
      label: "scheduled",
      start_date: "2026-07-12",
      end_date: "2026-08-09",
    });
  });
});
