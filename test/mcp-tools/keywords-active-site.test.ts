import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../../src/server";
import { encryptCredential } from "../../src/crypto/credential-cipher";
import { resetGoogleTokenCache } from "../../src/google/auth";
import type { Env } from "../../src/config";

/**
 * Mirrors `test/google/credentials.test.ts`'s established fake-D1 pattern:
 * the exact `prepare(sql).bind(...)` shapes `src/db/site-store.ts`/
 * `src/db/site-credential-store.ts` issue.
 */
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
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes("FROM sites")) {
                const url = args[0];
                return (
                  opts.site && opts.site.url === url ? opts.site : null
                ) as T | null;
              }
              if (sql.includes("FROM site_credentials")) {
                const siteId = args[0];
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

const ENCRYPTION_KEY = (() => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
})();

async function encryptedCredentialRow(
  siteId: number,
  refreshToken: string,
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
  };
}

type ToolHandle = {
  handler: (
    args: unknown,
    ctx: unknown,
  ) => Promise<{ isError?: boolean; content: unknown[] }>;
};

function registeredTool(
  server: ReturnType<typeof buildServer>,
  name: string,
): ToolHandle {
  return (server as unknown as { _registeredTools: Record<string, ToolHandle> })
    ._registeredTools[name];
}

function tokenAndDataFetch(dataResponse: () => Response) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = input.toString();
    if (url.includes("oauth2.googleapis.com/token")) {
      return Response.json({ access_token: "access-123", expires_in: 3600 });
    }
    return dataResponse();
  });
}

const GLOBAL_ENV: Env = {
  GOOGLE_CLIENT_ID: "global-client-id",
  GOOGLE_CLIENT_SECRET: "global-client-secret",
  GOOGLE_REFRESH_TOKEN: "global-refresh-token",
  GOOGLE_ADS_DEVELOPER_TOKEN: "dev-token",
  GOOGLE_ADS_CUSTOMER_ID: "123-456-7890",
  DOMAIN_CREDENTIAL_ENCRYPTION_KEY: ENCRYPTION_KEY,
};

describe("get_keyword_metrics/discover_keywords bind to the active site via the requestContext header, not a tool argument (Threat Matrix row g)", () => {
  beforeEach(() => resetGoogleTokenCache());
  afterEach(() => vi.unstubAllGlobals());

  it("with no activeSiteUrl in the requestContext, resolves the exact same global tier as before this change", async () => {
    const fetcher = tokenAndDataFetch(() =>
      Response.json({ results: [{ text: "kw", keywordMetrics: {} }] }),
    );
    vi.stubGlobal("fetch", fetcher);

    const env: Env = { ...GLOBAL_ENV, DB: fakeDb({}) };
    const server = buildServer(env);
    const tool = registeredTool(server, "get_keyword_metrics");
    const result = await tool.handler({ keywords: ["seo"] }, {});

    expect(result.isError).toBeFalsy();
    const tokenCall = fetcher.mock.calls.find((c) =>
      c[0].toString().includes("oauth2.googleapis.com"),
    )!;
    expect(String(tokenCall[1]!.body)).toContain(
      "refresh_token=global-refresh-token",
    );
  });

  it("with activeSiteUrl set to a site with its own connected site_credentials row, resolves THAT site's credentials instead of global", async () => {
    const site: FakeSiteRow = {
      id: 7,
      url: "sc-domain:example.com",
      label: null,
      created_at: "2026-01-01T00:00:00.000Z",
    };
    const credential = await encryptedCredentialRow(7, "site-refresh-token");
    const fetcher = tokenAndDataFetch(() =>
      Response.json({ results: [{ text: "kw", keywordMetrics: {} }] }),
    );
    vi.stubGlobal("fetch", fetcher);

    const env: Env = { ...GLOBAL_ENV, DB: fakeDb({ site, credential }) };
    const server = buildServer(env, {
      activeSiteUrl: "sc-domain:example.com",
    });
    const tool = registeredTool(server, "get_keyword_metrics");
    const result = await tool.handler({ keywords: ["seo"] }, {});

    expect(result.isError).toBeFalsy();
    const tokenCall = fetcher.mock.calls.find((c) =>
      c[0].toString().includes("oauth2.googleapis.com"),
    )!;
    expect(String(tokenCall[1]!.body)).toContain(
      "refresh_token=site-refresh-token",
    );
  });

  it("discover_keywords also resolves the active site's credentials", async () => {
    const site: FakeSiteRow = {
      id: 8,
      url: "sc-domain:discover.example.com",
      label: null,
      created_at: "2026-01-01T00:00:00.000Z",
    };
    const credential = await encryptedCredentialRow(
      8,
      "discover-site-refresh-token",
    );
    const fetcher = tokenAndDataFetch(() =>
      Response.json({ results: [{ text: "kw", keywordIdeaMetrics: {} }] }),
    );
    vi.stubGlobal("fetch", fetcher);

    const env: Env = { ...GLOBAL_ENV, DB: fakeDb({ site, credential }) };
    const server = buildServer(env, {
      activeSiteUrl: "sc-domain:discover.example.com",
    });
    const tool = registeredTool(server, "discover_keywords");
    const result = await tool.handler({ seedKeywords: ["seo"] }, {});

    expect(result.isError).toBeFalsy();
    const tokenCall = fetcher.mock.calls.find((c) =>
      c[0].toString().includes("oauth2.googleapis.com"),
    )!;
    expect(String(tokenCall[1]!.body)).toContain(
      "refresh_token=discover-site-refresh-token",
    );
  });
});
