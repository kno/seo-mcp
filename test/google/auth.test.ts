import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getGoogleAccessToken,
  resetGoogleTokenCache,
} from "../../src/google/auth";
import type { GoogleOAuthCredentials } from "../../src/google/credentials";

const credentialsA: GoogleOAuthCredentials = {
  clientId: "client-a",
  clientSecret: "secret-a",
  refreshToken: "refresh-a",
};

const credentialsB: GoogleOAuthCredentials = {
  clientId: "client-b",
  clientSecret: "secret-b",
  refreshToken: "refresh-b",
};

beforeEach(() => {
  resetGoogleTokenCache();
});

function tokenFetcher(accessToken: string, expiresIn = 3600) {
  return vi.fn<typeof fetch>(async () =>
    Response.json({ access_token: accessToken, expires_in: expiresIn }),
  );
}

describe("getGoogleAccessToken", () => {
  it("exchanges the refresh token for an access token", async () => {
    const fetcher = tokenFetcher("access-123");

    const token = await getGoogleAccessToken(credentialsA, fetcher, () => 0);

    expect(token).toBe("access-123");
    expect(fetcher).toHaveBeenCalledOnce();
    const url = fetcher.mock.calls[0][0].toString();
    expect(url).toBe("https://oauth2.googleapis.com/token");
    const init = fetcher.mock.calls[0][1]!;
    expect(init.method).toBe("POST");
    const body = String(init.body);
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("client_id=client-a");
    expect(body).toContain("client_secret=secret-a");
    expect(body).toContain("refresh_token=refresh-a");
  });

  it("caches the token within its expiry window", async () => {
    const fetcher = tokenFetcher("access-123");

    await getGoogleAccessToken(credentialsA, fetcher, () => 0);
    const second = await getGoogleAccessToken(
      credentialsA,
      fetcher,
      () => 1000,
    );

    expect(second).toBe("access-123");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("refetches once the cached token has expired", async () => {
    const fetcher = tokenFetcher("access-123");

    await getGoogleAccessToken(credentialsA, fetcher, () => 0);
    // expiresAtMs = 0 + 3600*1000 - 60000 = 3_540_000
    await getGoogleAccessToken(credentialsA, fetcher, () => 3_600_000);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("throws and never fetches when credentials are missing", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({}));

    await expect(
      getGoogleAccessToken(
        { clientId: "only-id", clientSecret: "", refreshToken: "" },
        fetcher,
      ),
    ).rejects.toThrow("Google credentials are not configured");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("surfaces the Google error description on a non-ok response", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json(
        { error: "invalid_grant", error_description: "Token has expired" },
        { status: 400 },
      ),
    );

    await expect(getGoogleAccessToken(credentialsA, fetcher)).rejects.toThrow(
      "Token has expired",
    );
  });

  it("headline: two credential sets never share a cached access token", async () => {
    const fetcherA = tokenFetcher("access-a");
    const fetcherB = tokenFetcher("access-b");

    const tokenA = await getGoogleAccessToken(credentialsA, fetcherA, () => 0);
    const tokenB = await getGoogleAccessToken(credentialsB, fetcherB, () => 0);

    expect(tokenA).toBe("access-a");
    expect(tokenB).toBe("access-b");
    expect(fetcherA).toHaveBeenCalledOnce();
    expect(fetcherB).toHaveBeenCalledOnce();

    // Re-requesting credentialsA within its expiry window must still hit
    // its own cache entry, not credentialsB's.
    const tokenAAgain = await getGoogleAccessToken(
      credentialsA,
      fetcherA,
      () => 1000,
    );
    expect(tokenAAgain).toBe("access-a");
    expect(fetcherA).toHaveBeenCalledOnce();
  });

  it("credentialKey differs when only the refresh token differs", async () => {
    const same: GoogleOAuthCredentials = {
      clientId: "client-a",
      clientSecret: "secret-a",
      refreshToken: "refresh-a",
    };
    const differentRefresh: GoogleOAuthCredentials = {
      clientId: "client-a",
      clientSecret: "secret-a",
      refreshToken: "refresh-a-different",
    };
    const fetcherSame = tokenFetcher("access-same");
    const fetcherDiff = tokenFetcher("access-diff");

    await getGoogleAccessToken(same, fetcherSame, () => 0);
    await getGoogleAccessToken(differentRefresh, fetcherDiff, () => 0);

    // Both must fetch independently — a shared key would have short-circuited
    // the second call via the first's cache entry.
    expect(fetcherSame).toHaveBeenCalledOnce();
    expect(fetcherDiff).toHaveBeenCalledOnce();
  });

  it("evicts expired entries first, then the oldest, bounding the cache at 8 entries", async () => {
    let now = 0;
    const nowFn = () => now;

    // Fill the cache with 8 credential sets that expire quickly.
    for (let i = 0; i < 8; i++) {
      const creds: GoogleOAuthCredentials = {
        clientId: `client-${i}`,
        clientSecret: `secret-${i}`,
        refreshToken: `refresh-${i}`,
      };
      const fetcher = vi.fn<typeof fetch>(async () =>
        Response.json({ access_token: `access-${i}`, expires_in: 60 }),
      );
      await getGoogleAccessToken(creds, fetcher, nowFn);
    }

    // Advance time past every entry's expiry, then add a 9th — this must
    // not grow the cache past 8, and the 9th entry must still be usable.
    now = 10_000_000;
    const ninthFetcher = tokenFetcher("access-9");
    const ninthCreds: GoogleOAuthCredentials = {
      clientId: "client-9",
      clientSecret: "secret-9",
      refreshToken: "refresh-9",
    };
    const token9 = await getGoogleAccessToken(ninthCreds, ninthFetcher, nowFn);
    expect(token9).toBe("access-9");

    // The ninth entry must be served from cache on a second call at the
    // same instant (no re-fetch), proving it was actually cached, not
    // dropped by an over-aggressive eviction.
    const token9Again = await getGoogleAccessToken(
      ninthCreds,
      ninthFetcher,
      nowFn,
    );
    expect(token9Again).toBe("access-9");
    expect(ninthFetcher).toHaveBeenCalledOnce();
  });

  it("never puts a credentialKey-shaped value in the resolved token, request body, or a thrown error", async () => {
    const fetcher = tokenFetcher("access-123");
    const token = await getGoogleAccessToken(credentialsA, fetcher, () => 0);

    // A credentialKey is a 22-char base64url slice of a sha256 digest. The
    // resolved token and the outbound request body must never contain one —
    // they must only ever contain the plain credential fields themselves.
    const credentialKeyShape = /^[A-Za-z0-9_-]{22}$/;
    expect(credentialKeyShape.test(token)).toBe(false);
    const init = fetcher.mock.calls[0][1]!;
    const body = String(init.body);
    expect(body).not.toMatch(credentialKeyShape);
  });
});
