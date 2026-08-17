import { describe, expect, it } from "vitest";
import {
  resolveSiteCredentials,
  globalCredentials,
} from "../../src/google/credentials";
import { encryptCredential } from "../../src/crypto/credential-cipher";
import type { Env } from "../../src/config";

const ENCRYPTION_KEY = (() => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
})();

interface FakeSiteRow {
  id: number;
  url: string;
  label: string | null;
  created_at: string;
}

interface FakeCredentialRow {
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

function fakeDb(opts: {
  site?: FakeSiteRow;
  credential?: FakeCredentialRow;
}): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(..._args: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes("FROM sites")) {
                const url = _args[0];
                return (
                  opts.site && opts.site.url === url ? opts.site : null
                ) as T | null;
              }
              if (sql.includes("FROM site_credentials")) {
                const siteId = _args[0];
                return (
                  opts.credential && opts.credential.site_id === siteId
                    ? opts.credential
                    : null
                ) as T | null;
              }
              return null as T | null;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

async function encryptedCredentialRow(
  siteId: number,
  refreshToken: string,
  overrides: Partial<FakeCredentialRow> = {},
): Promise<FakeCredentialRow> {
  const encrypted = await encryptCredential(
    refreshToken,
    ENCRYPTION_KEY,
    `site:${siteId}:refresh_token`,
  );
  return {
    site_id: siteId,
    client_id: "site-client-id",
    refresh_token_ciphertext: encrypted.ciphertext,
    refresh_token_iv: encrypted.iv,
    google_account_email: "owner@example.com",
    account_key: "ak_site123",
    ads_customer_id: null,
    scopes: "openid email webmasters.readonly adwords",
    connected_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const GLOBAL_ENV: Env = {
  GOOGLE_CLIENT_ID: "global-client-id",
  GOOGLE_CLIENT_SECRET: "global-client-secret",
  GOOGLE_REFRESH_TOKEN: "global-refresh-token",
  DOMAIN_CREDENTIAL_ENCRYPTION_KEY: ENCRYPTION_KEY,
};

describe("resolveSiteCredentials", () => {
  it("resolves a connected site entirely to its own credentials", async () => {
    const site: FakeSiteRow = {
      id: 7,
      url: "sc-domain:example.com",
      label: null,
      created_at: "2026-01-01T00:00:00.000Z",
    };
    const credential = await encryptedCredentialRow(7, "site-refresh-token");
    const env: Env = { ...GLOBAL_ENV, DB: fakeDb({ site, credential }) };

    const resolved = await resolveSiteCredentials(env, "sc-domain:example.com");

    expect(resolved.source).toBe("site");
    expect(resolved.accountKey).toBe("ak_site123");
    expect(resolved.accountLabel).toBe("owner@example.com");
    expect(resolved.credentials.clientId).toBe("site-client-id");
    expect(resolved.credentials.refreshToken).toBe("site-refresh-token");
  });

  it("falls back to the global tier when the site has no credential row", async () => {
    const env: Env = { ...GLOBAL_ENV, DB: fakeDb({}) };

    const resolved = await resolveSiteCredentials(
      env,
      "sc-domain:unconnected.com",
    );

    expect(resolved.source).toBe("global");
    expect(resolved.accountKey).toBe("global");
    expect(resolved.accountLabel).toBeNull();
    expect(resolved.credentials).toEqual({
      clientId: "global-client-id",
      clientSecret: "global-client-secret",
      refreshToken: "global-refresh-token",
    });
  });

  it("never mixes tiers: an unusable site-tier attempt falls through to a complete global set", async () => {
    const site: FakeSiteRow = {
      id: 9,
      url: "sc-domain:tampered.com",
      label: null,
      created_at: "2026-01-01T00:00:00.000Z",
    };
    // Ciphertext encrypted under the wrong AAD (site 999) simulates an
    // unusable site-tier credential (fails decrypt) rather than a partial
    // write — the resolution must not complete a set with any site field.
    const credential = await encryptCredential(
      "site-refresh-token",
      ENCRYPTION_KEY,
      "site:999:refresh_token",
    ).then((encrypted) => ({
      site_id: 9,
      client_id: "site-client-id",
      refresh_token_ciphertext: encrypted.ciphertext,
      refresh_token_iv: encrypted.iv,
      google_account_email: "owner@example.com",
      account_key: "ak_site999",
      ads_customer_id: null,
      scopes: "openid",
      connected_at: "2026-01-01T00:00:00.000Z",
    }));
    const env: Env = { ...GLOBAL_ENV, DB: fakeDb({ site, credential }) };

    const resolved = await resolveSiteCredentials(
      env,
      "sc-domain:tampered.com",
    );

    expect(resolved.source).toBe("global");
    expect(resolved.credentials).toEqual({
      clientId: "global-client-id",
      clientSecret: "global-client-secret",
      refreshToken: "global-refresh-token",
    });
  });

  it("throws the literal message when neither tier has usable credentials", async () => {
    const env: Env = { DB: fakeDb({}) };

    await expect(
      resolveSiteCredentials(env, "sc-domain:nowhere.com"),
    ).rejects.toThrow("Google credentials are not configured");
  });

  it("throws the literal message with no siteUrl and no global tier configured", async () => {
    await expect(resolveSiteCredentials({}, undefined)).rejects.toThrow(
      "Google credentials are not configured",
    );
  });
});

describe("globalCredentials", () => {
  it("resolves the global env tier", () => {
    const resolved = globalCredentials(GLOBAL_ENV);
    expect(resolved.clientId).toBe("global-client-id");
    expect(resolved.clientSecret).toBe("global-client-secret");
    expect(resolved.refreshToken).toBe("global-refresh-token");
  });

  it("throws the literal message when the global tier is absent", () => {
    expect(() => globalCredentials({})).toThrow(
      "Google credentials are not configured",
    );
  });
});
