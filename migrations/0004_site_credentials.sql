-- Per-site Google credential storage for the "Connect Google Account" flow.
-- Additive only; never drop or alter `site_credentials` in a later migration
-- (it holds refresh tokens unrecoverable without re-consent).

CREATE TABLE IF NOT EXISTS site_credentials (
  site_id                  INTEGER PRIMARY KEY,  -- 1:1 with sites.id
  client_id                TEXT NOT NULL,
  refresh_token_ciphertext TEXT NOT NULL,        -- base64, AES-GCM
  refresh_token_iv         TEXT NOT NULL,        -- base64, 12 random bytes PER WRITE
  google_account_email     TEXT NOT NULL,
  account_key              TEXT NOT NULL,
  ads_customer_id          TEXT,                 -- resolved by the Ads probe; NULL when absent/ambiguous
  scopes                   TEXT NOT NULL,
  connected_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_site_credentials_account ON site_credentials(account_key);

CREATE TABLE IF NOT EXISTS site_credential_health (
  site_id           INTEGER NOT NULL,
  source            TEXT NOT NULL,  -- 'search-console' | 'google-ads'
  credential_source TEXT NOT NULL,  -- 'site' | 'global'
  account_key       TEXT NOT NULL,  -- health is scoped to the credential IDENTITY
  state             TEXT NOT NULL,  -- 'healthy' | 'unhealthy' ONLY
  reason            TEXT,           -- credential_rejected | property_not_accessible |
                                     -- property_unverified | probe_failed |
                                     -- ads_no_accessible_customer | ads_customer_ambiguous
  detail            TEXT,           -- e.g. permissionLevel. NEVER credential material.
  checked_at        TEXT NOT NULL,
  expires_at        TEXT NOT NULL,
  PRIMARY KEY (site_id, source)
);
