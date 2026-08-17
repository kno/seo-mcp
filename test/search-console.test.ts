import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchConsoleQuery } from "../src/google/search-console";
import { resetGoogleTokenCache } from "../src/google/auth";
import type { GoogleOAuthCredentials } from "../src/google/credentials";

const credentials: GoogleOAuthCredentials = {
  clientId: "client-id",
  clientSecret: "client-secret",
  refreshToken: "refresh-token",
};

beforeEach(() => {
  resetGoogleTokenCache();
});

function dispatcher(gscResponse: () => Response) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = input.toString();
    if (url.includes("oauth2.googleapis.com/token")) {
      return Response.json({ access_token: "access-123", expires_in: 3600 });
    }
    return gscResponse();
  });
}

const rowsPayload = () =>
  Response.json({
    rows: [
      {
        keys: ["seo tool", "https://example.com/page"],
        clicks: 12,
        impressions: 340,
        ctr: 0.035,
        position: 4.2,
      },
      {
        keys: ["mcp server"],
        clicks: 3,
        impressions: 90,
        ctr: 0.033,
        position: 7.5,
      },
    ],
  });

describe("searchConsoleQuery", () => {
  it("queries the encoded property with a bearer token and defaulted params", async () => {
    const fetcher = dispatcher(rowsPayload);

    const result = await searchConsoleQuery(
      {
        siteUrl: "sc-domain:example.com",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      },
      credentials,
      fetcher,
    );

    const gscCall = fetcher.mock.calls.find((c) =>
      c[0].toString().includes("searchconsole.googleapis.com"),
    )!;
    const url = gscCall[0].toString();
    expect(url).toContain(encodeURIComponent("sc-domain:example.com"));
    expect(url.endsWith("/searchAnalytics/query")).toBe(true);

    const init = gscCall[1]!;
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer access-123");

    const body = JSON.parse(String(init.body));
    expect(body.dimensions).toEqual(["query", "page"]);
    expect(body.rowLimit).toBe(100);
    expect(body.startDate).toBe("2026-01-01");
    expect(body.endDate).toBe("2026-01-31");

    expect(result.rowCount).toBe(2);
    expect(result.rows[0]).toEqual({
      keys: ["seo tool", "https://example.com/page"],
      clicks: 12,
      impressions: 340,
      ctr: 0.035,
      position: 4.2,
    });
    expect(result.dimensions).toEqual(["query", "page"]);
    expect(result.siteUrl).toBe("sc-domain:example.com");
  });

  it("caps rowLimit at LIMITS.maxGscRows", async () => {
    const fetcher = dispatcher(rowsPayload);

    await searchConsoleQuery(
      {
        siteUrl: "https://example.com/",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        rowLimit: 5000,
      },
      credentials,
      fetcher,
    );

    const gscCall = fetcher.mock.calls.find((c) =>
      c[0].toString().includes("searchconsole.googleapis.com"),
    )!;
    const body = JSON.parse(String(gscCall[1]!.body));
    expect(body.rowLimit).toBe(250);
  });

  it("normalizes missing numeric fields to 0 and keys to []", async () => {
    const fetcher = dispatcher(() => Response.json({ rows: [{}] }));

    const result = await searchConsoleQuery(
      {
        siteUrl: "https://example.com/",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      },
      credentials,
      fetcher,
    );

    expect(result.rows[0]).toEqual({
      keys: [],
      clicks: 0,
      impressions: 0,
      ctr: 0,
      position: 0,
    });
  });

  it("surfaces the Search Console error message on a non-ok response", async () => {
    const fetcher = dispatcher(() =>
      Response.json(
        { error: { message: "User does not have sufficient permission" } },
        { status: 403 },
      ),
    );

    await expect(
      searchConsoleQuery(
        {
          siteUrl: "https://example.com/",
          startDate: "2026-01-01",
          endDate: "2026-01-31",
        },
        credentials,
        fetcher,
      ),
    ).rejects.toThrow("User does not have sufficient permission");
  });
});
