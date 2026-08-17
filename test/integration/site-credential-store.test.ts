import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  upsertSiteCredential,
  getSiteCredential,
  deleteSiteCredential,
  upsertSiteCredentialHealth,
  getSiteCredentialHealth,
} from "../../src/db/site-credential-store";
import { addSite, deleteSite } from "../../src/db/site-store";

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
  await DB.exec("DELETE FROM site_credential_health");
  await DB.exec("DELETE FROM site_credentials");
  await DB.exec("DELETE FROM sites");
});

describe("site-credential-store (real D1 via Miniflare)", () => {
  it("write persists ciphertext and IV, never a plaintext refresh token", async () => {
    const { site } = await addSite(DB, { url: "https://example.com" });

    await upsertSiteCredential(DB, {
      siteId: site!.id,
      clientId: "client-abc",
      refreshTokenCiphertext: "cipher-base64",
      refreshTokenIv: "iv-base64",
      googleAccountEmail: "owner@example.com",
      accountKey: "account-key-1",
      scopes: "openid email webmasters.readonly adwords",
      connectedAt: "2026-08-17T00:00:00.000Z",
    });

    const record = await getSiteCredential(DB, site!.id);
    expect(record).not.toBeNull();
    expect(record!.refreshTokenCiphertext).toBe("cipher-base64");
    expect(record!.refreshTokenIv).toBe("iv-base64");

    const { results: rawRows } = await DB.prepare(
      "SELECT refresh_token_ciphertext, refresh_token_iv FROM site_credentials WHERE site_id = ?",
    )
      .bind(site!.id)
      .all<{ refresh_token_ciphertext: string; refresh_token_iv: string }>();
    expect(rawRows).toHaveLength(1);
    expect(rawRows[0].refresh_token_ciphertext).not.toBe(
      "my-raw-refresh-token",
    );
  });

  it("upsertSiteCredential replaces an existing row for the same site_id", async () => {
    const { site } = await addSite(DB, { url: "https://replace.com" });
    await upsertSiteCredential(DB, {
      siteId: site!.id,
      clientId: "client-abc",
      refreshTokenCiphertext: "cipher-1",
      refreshTokenIv: "iv-1",
      googleAccountEmail: "first@example.com",
      accountKey: "key-1",
      scopes: "openid",
      connectedAt: "2026-08-01T00:00:00.000Z",
    });
    await upsertSiteCredential(DB, {
      siteId: site!.id,
      clientId: "client-abc",
      refreshTokenCiphertext: "cipher-2",
      refreshTokenIv: "iv-2",
      googleAccountEmail: "second@example.com",
      accountKey: "key-2",
      scopes: "openid",
      connectedAt: "2026-08-02T00:00:00.000Z",
    });

    const record = await getSiteCredential(DB, site!.id);
    expect(record!.googleAccountEmail).toBe("second@example.com");
    expect(record!.refreshTokenCiphertext).toBe("cipher-2");
  });

  it("getSiteCredential returns null when no row exists", async () => {
    expect(await getSiteCredential(DB, 999999)).toBeNull();
  });

  it("upsertSiteCredentialHealth writes and reads back a health row", async () => {
    const { site } = await addSite(DB, { url: "https://health.com" });
    await upsertSiteCredentialHealth(DB, {
      siteId: site!.id,
      source: "search-console",
      credentialSource: "site",
      accountKey: "key-1",
      state: "healthy",
      checkedAt: "2026-08-17T00:00:00.000Z",
      expiresAt: "2026-08-17T06:00:00.000Z",
    });

    const record = await getSiteCredentialHealth(
      DB,
      site!.id,
      "search-console",
    );
    expect(record).not.toBeNull();
    expect(record!.state).toBe("healthy");
    expect(record!.accountKey).toBe("key-1");
  });

  it("deleteSite (site-store) batch-deletes rows from site_credentials and site_credential_health, not ON DELETE CASCADE", async () => {
    const { site } = await addSite(DB, { url: "https://delete-cascade.com" });
    await upsertSiteCredential(DB, {
      siteId: site!.id,
      clientId: "client-abc",
      refreshTokenCiphertext: "cipher",
      refreshTokenIv: "iv",
      googleAccountEmail: "owner@example.com",
      accountKey: "key-1",
      scopes: "openid",
      connectedAt: "2026-08-17T00:00:00.000Z",
    });
    await upsertSiteCredentialHealth(DB, {
      siteId: site!.id,
      source: "search-console",
      credentialSource: "site",
      accountKey: "key-1",
      state: "healthy",
      checkedAt: "2026-08-17T00:00:00.000Z",
      expiresAt: "2026-08-17T06:00:00.000Z",
    });

    const deleted = await deleteSite(DB, site!.id);
    expect(deleted).toBe(true);

    expect(await getSiteCredential(DB, site!.id)).toBeNull();
    expect(
      await getSiteCredentialHealth(DB, site!.id, "search-console"),
    ).toBeNull();
  });

  it("deleteSiteCredential removes only the credentials row", async () => {
    const { site } = await addSite(DB, { url: "https://delete-cred.com" });
    await upsertSiteCredential(DB, {
      siteId: site!.id,
      clientId: "client-abc",
      refreshTokenCiphertext: "cipher",
      refreshTokenIv: "iv",
      googleAccountEmail: "owner@example.com",
      accountKey: "key-1",
      scopes: "openid",
      connectedAt: "2026-08-17T00:00:00.000Z",
    });

    expect(await deleteSiteCredential(DB, site!.id)).toBe(true);
    expect(await getSiteCredential(DB, site!.id)).toBeNull();
  });
});
