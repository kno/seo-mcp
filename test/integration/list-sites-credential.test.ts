import { env as workerEnv } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../../src/server";
import { addSite } from "../../src/db/site-store";
import {
  upsertSiteCredential,
  upsertSiteCredentialHealth,
} from "../../src/db/site-credential-store";
import { encryptCredential } from "../../src/crypto/credential-cipher";
import { resetGoogleTokenCache } from "../../src/google/auth";
import type { Env } from "../../src/config";

const DB = (workerEnv as { DB: D1Database }).DB;

const ENCRYPTION_KEY = (() => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
})();

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
  resetGoogleTokenCache();
});

const ENV: Env = {
  DB,
  DOMAIN_CREDENTIAL_ENCRYPTION_KEY: ENCRYPTION_KEY,
  GOOGLE_CLIENT_SECRET: "global-client-secret",
};

type ToolHandle = {
  handler: (
    args: unknown,
    ctx: unknown,
  ) => Promise<{
    isError?: boolean;
    content: unknown[];
    structuredContent?: unknown;
  }>;
};

function listSitesTool(env: Env): ToolHandle {
  const server = buildServer(env as never);
  return (server as unknown as { _registeredTools: Record<string, ToolHandle> })
    ._registeredTools["list_sites"];
}

describe("list_sites round-trips the credential field with zero Google calls and no secret leak", () => {
  it("reports not_connected for a site with no credential row", async () => {
    await addSite(DB, { url: "https://plain.example.com" });
    const fetcher = vi.fn<typeof fetch>();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetcher;

    try {
      const tool = listSitesTool(ENV);
      const response = await tool.handler({}, {});

      expect(response.isError).toBeUndefined();
      expect(fetcher).not.toHaveBeenCalled();
      const site = (
        response.structuredContent as {
          sites: Array<{ credential: { tier: string } }>;
        }
      ).sites[0];
      expect(site.credential.tier).toBe("none");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reports a connected site's cached health with no secret leak in the response", async () => {
    const { site } = await addSite(DB, { url: "sc-domain:connected.com" });
    const encrypted = await encryptCredential(
      "top-secret-refresh-token",
      ENCRYPTION_KEY,
      `site:${site!.id}:refresh_token`,
    );
    await upsertSiteCredential(DB, {
      siteId: site!.id,
      clientId: "site-client-id",
      refreshTokenCiphertext: encrypted.ciphertext,
      refreshTokenIv: encrypted.iv,
      googleAccountEmail: "owner@example.com",
      accountKey: "ak_site123",
      scopes: "openid email webmasters.readonly adwords",
      connectedAt: "2026-08-17T00:00:00.000Z",
    });
    await upsertSiteCredentialHealth(DB, {
      siteId: site!.id,
      source: "search-console",
      credentialSource: "site",
      accountKey: "ak_site123",
      state: "healthy",
      checkedAt: "2026-08-17T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    const fetcher = vi.fn<typeof fetch>();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetcher;

    try {
      const tool = listSitesTool(ENV);
      const response = await tool.handler({}, {});

      expect(response.isError).toBeUndefined();
      expect(fetcher).not.toHaveBeenCalled();

      const structured = response.structuredContent as {
        sites: Array<{
          credential: {
            tier: string;
            accountLabel: string | null;
            health: { searchConsole: { state: string } };
          };
        }>;
      };
      expect(structured.sites[0].credential.tier).toBe("site");
      expect(structured.sites[0].credential.accountLabel).toBe(
        "owner@example.com",
      );
      expect(structured.sites[0].credential.health.searchConsole.state).toBe(
        "healthy",
      );

      const serialized = JSON.stringify(response);
      expect(serialized).not.toContain("top-secret-refresh-token");
      expect(serialized).not.toContain(encrypted.ciphertext);
      expect(serialized).not.toContain(encrypted.iv);
      expect(serialized).not.toContain(ENCRYPTION_KEY);
      expect(serialized).not.toContain("site-client-id");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
