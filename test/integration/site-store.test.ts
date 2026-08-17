import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listSites, addSite, deleteSite } from "../../src/db/site-store";

const DB = (env as { DB: D1Database }).DB;

beforeAll(async () => {
  await DB.exec(
    "CREATE TABLE IF NOT EXISTS sites (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL UNIQUE, label TEXT, created_at TEXT NOT NULL)",
  );
  await DB.exec(
    "CREATE TABLE IF NOT EXISTS site_credentials (site_id INTEGER PRIMARY KEY, client_id TEXT NOT NULL, refresh_token_ciphertext TEXT NOT NULL, refresh_token_iv TEXT NOT NULL, google_account_email TEXT NOT NULL, account_key TEXT NOT NULL, ads_customer_id TEXT, scopes TEXT NOT NULL, connected_at TEXT NOT NULL)",
  );
  await DB.exec(
    "CREATE TABLE IF NOT EXISTS site_credential_health (site_id INTEGER NOT NULL, source TEXT NOT NULL, credential_source TEXT NOT NULL, account_key TEXT NOT NULL, state TEXT NOT NULL, reason TEXT, detail TEXT, checked_at TEXT NOT NULL, expires_at TEXT NOT NULL, PRIMARY KEY (site_id, source))",
  );
});

beforeEach(async () => {
  await DB.exec("DELETE FROM sites");
});

describe("site-store (real D1 via Miniflare)", () => {
  it("addSite inserts a new site and reports added: true", async () => {
    const { added, site } = await addSite(DB, {
      url: "https://example.com",
      label: "Main",
    });
    expect(added).toBe(true);
    expect(site).not.toBeNull();
    expect(site!.url).toBe("https://example.com");
    expect(site!.label).toBe("Main");
    expect(site!.id).toBeGreaterThan(0);
  });

  it("addSite without a label stores label: null", async () => {
    const { site } = await addSite(DB, { url: "https://no-label.com" });
    expect(site!.label).toBeNull();
  });

  it("addSite is idempotent on a duplicate url (INSERT OR IGNORE)", async () => {
    await addSite(DB, { url: "https://dup.com", label: "First" });
    const { added, site } = await addSite(DB, {
      url: "https://dup.com",
      label: "Second",
    });
    expect(added).toBe(false);
    expect(site).toBeNull();

    const all = await listSites(DB);
    expect(all).toHaveLength(1);
    expect(all[0].label).toBe("First");
  });

  it("listSites returns all sites", async () => {
    await addSite(DB, { url: "https://a.com" });
    await addSite(DB, { url: "https://b.com" });
    const all = await listSites(DB);
    expect(all).toHaveLength(2);
    expect(all.map((s) => s.url).sort()).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });

  it("deleteSite removes an existing site and returns deleted: true", async () => {
    const { site } = await addSite(DB, { url: "https://delete-me.com" });
    const deleted = await deleteSite(DB, site!.id);
    expect(deleted).toBe(true);
    expect(await listSites(DB)).toHaveLength(0);
  });

  it("deleteSite returns false for a non-existent id", async () => {
    expect(await deleteSite(DB, 999999)).toBe(false);
  });
});
