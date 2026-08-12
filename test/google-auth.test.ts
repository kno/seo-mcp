import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getGoogleAccessToken,
  resetGoogleTokenCache,
} from "../src/google/auth";
import type { Env } from "../src/config";

const creds: Env = {
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  GOOGLE_REFRESH_TOKEN: "refresh-token",
};

beforeEach(() => {
  resetGoogleTokenCache();
});

describe("getGoogleAccessToken", () => {
  it("exchanges the refresh token for an access token", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ access_token: "access-123", expires_in: 3600 }),
    );

    const token = await getGoogleAccessToken(creds, fetcher, () => 0);

    expect(token).toBe("access-123");
    expect(fetcher).toHaveBeenCalledOnce();
    const url = fetcher.mock.calls[0][0].toString();
    expect(url).toBe("https://oauth2.googleapis.com/token");
    const init = fetcher.mock.calls[0][1]!;
    expect(init.method).toBe("POST");
    const body = String(init.body);
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("client_id=client-id");
    expect(body).toContain("client_secret=client-secret");
    expect(body).toContain("refresh_token=refresh-token");
  });

  it("caches the token within its expiry window", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ access_token: "access-123", expires_in: 3600 }),
    );

    await getGoogleAccessToken(creds, fetcher, () => 0);
    const second = await getGoogleAccessToken(creds, fetcher, () => 1000);

    expect(second).toBe("access-123");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("refetches once the cached token has expired", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ access_token: "access-123", expires_in: 3600 }),
    );

    await getGoogleAccessToken(creds, fetcher, () => 0);
    // expiresAtMs = 0 + 3600*1000 - 60000 = 3_540_000
    await getGoogleAccessToken(creds, fetcher, () => 3_600_000);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("throws and never fetches when credentials are missing", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({}));

    await expect(
      getGoogleAccessToken({ GOOGLE_CLIENT_ID: "only-id" }, fetcher),
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

    await expect(getGoogleAccessToken(creds, fetcher)).rejects.toThrow(
      "Token has expired",
    );
  });
});
