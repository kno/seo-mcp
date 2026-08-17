/**
 * Read/write for `site_credentials` and `site_credential_health`
 * (`migrations/0004_site_credentials.sql`). This module never encrypts or
 * decrypts anything itself — callers pass an already-encrypted
 * `refreshTokenCiphertext`/`refreshTokenIv` pair (see
 * `src/crypto/credential-cipher.ts`), so no plaintext refresh token ever
 * passes through here.
 */

export interface SiteCredentialInput {
  siteId: number;
  clientId: string;
  refreshTokenCiphertext: string;
  refreshTokenIv: string;
  googleAccountEmail: string;
  accountKey: string;
  adsCustomerId?: string | null;
  scopes: string;
  connectedAt: string;
}

export interface SiteCredentialRecord {
  siteId: number;
  clientId: string;
  refreshTokenCiphertext: string;
  refreshTokenIv: string;
  googleAccountEmail: string;
  accountKey: string;
  adsCustomerId: string | null;
  scopes: string;
  connectedAt: string;
}

interface SiteCredentialRow {
  site_id: number;
  client_id: string;
  refresh_token_ciphertext: string;
  refresh_token_iv: string;
  google_account_email: string;
  account_key: string;
  ads_customer_id: string | null;
  scopes: string;
  connected_at: string;
}

function toSiteCredentialRecord(row: SiteCredentialRow): SiteCredentialRecord {
  return {
    siteId: row.site_id,
    clientId: row.client_id,
    refreshTokenCiphertext: row.refresh_token_ciphertext,
    refreshTokenIv: row.refresh_token_iv,
    googleAccountEmail: row.google_account_email,
    accountKey: row.account_key,
    adsCustomerId: row.ads_customer_id,
    scopes: row.scopes,
    connectedAt: row.connected_at,
  };
}

export async function upsertSiteCredential(
  db: D1Database,
  input: SiteCredentialInput,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO site_credentials
        (site_id, client_id, refresh_token_ciphertext, refresh_token_iv, google_account_email, account_key, ads_customer_id, scopes, connected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (site_id) DO UPDATE SET
        client_id = excluded.client_id,
        refresh_token_ciphertext = excluded.refresh_token_ciphertext,
        refresh_token_iv = excluded.refresh_token_iv,
        google_account_email = excluded.google_account_email,
        account_key = excluded.account_key,
        ads_customer_id = excluded.ads_customer_id,
        scopes = excluded.scopes,
        connected_at = excluded.connected_at`,
    )
    .bind(
      input.siteId,
      input.clientId,
      input.refreshTokenCiphertext,
      input.refreshTokenIv,
      input.googleAccountEmail,
      input.accountKey,
      input.adsCustomerId ?? null,
      input.scopes,
      input.connectedAt,
    )
    .run();
}

export async function getSiteCredential(
  db: D1Database,
  siteId: number,
): Promise<SiteCredentialRecord | null> {
  const row = await db
    .prepare(
      "SELECT site_id, client_id, refresh_token_ciphertext, refresh_token_iv, google_account_email, account_key, ads_customer_id, scopes, connected_at FROM site_credentials WHERE site_id = ?",
    )
    .bind(siteId)
    .first<SiteCredentialRow>();
  return row ? toSiteCredentialRecord(row) : null;
}

export async function deleteSiteCredential(
  db: D1Database,
  siteId: number,
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM site_credentials WHERE site_id = ?")
    .bind(siteId)
    .run();
  return result.meta.changes > 0;
}

export type CredentialHealthSource = "search-console" | "google-ads";
export type CredentialHealthTier = "site" | "global";
export type CredentialHealthState = "healthy" | "unhealthy";

export interface SiteCredentialHealthInput {
  siteId: number;
  source: CredentialHealthSource;
  credentialSource: CredentialHealthTier;
  accountKey: string;
  state: CredentialHealthState;
  reason?: string | null;
  detail?: string | null;
  checkedAt: string;
  expiresAt: string;
}

export interface SiteCredentialHealthRecord {
  siteId: number;
  source: CredentialHealthSource;
  credentialSource: CredentialHealthTier;
  accountKey: string;
  state: CredentialHealthState;
  reason: string | null;
  detail: string | null;
  checkedAt: string;
  expiresAt: string;
}

interface SiteCredentialHealthRow {
  site_id: number;
  source: CredentialHealthSource;
  credential_source: CredentialHealthTier;
  account_key: string;
  state: CredentialHealthState;
  reason: string | null;
  detail: string | null;
  checked_at: string;
  expires_at: string;
}

function toHealthRecord(
  row: SiteCredentialHealthRow,
): SiteCredentialHealthRecord {
  return {
    siteId: row.site_id,
    source: row.source,
    credentialSource: row.credential_source,
    accountKey: row.account_key,
    state: row.state,
    reason: row.reason,
    detail: row.detail,
    checkedAt: row.checked_at,
    expiresAt: row.expires_at,
  };
}

export async function upsertSiteCredentialHealth(
  db: D1Database,
  input: SiteCredentialHealthInput,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO site_credential_health
        (site_id, source, credential_source, account_key, state, reason, detail, checked_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (site_id, source) DO UPDATE SET
        credential_source = excluded.credential_source,
        account_key = excluded.account_key,
        state = excluded.state,
        reason = excluded.reason,
        detail = excluded.detail,
        checked_at = excluded.checked_at,
        expires_at = excluded.expires_at`,
    )
    .bind(
      input.siteId,
      input.source,
      input.credentialSource,
      input.accountKey,
      input.state,
      input.reason ?? null,
      input.detail ?? null,
      input.checkedAt,
      input.expiresAt,
    )
    .run();
}

export async function getSiteCredentialHealth(
  db: D1Database,
  siteId: number,
  source: CredentialHealthSource,
): Promise<SiteCredentialHealthRecord | null> {
  const row = await db
    .prepare(
      "SELECT site_id, source, credential_source, account_key, state, reason, detail, checked_at, expires_at FROM site_credential_health WHERE site_id = ? AND source = ?",
    )
    .bind(siteId, source)
    .first<SiteCredentialHealthRow>();
  return row ? toHealthRecord(row) : null;
}

export async function deleteSiteCredentialHealth(
  db: D1Database,
  siteId: number,
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM site_credential_health WHERE site_id = ?")
    .bind(siteId)
    .run();
  return result.meta.changes > 0;
}
