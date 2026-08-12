import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listBusinessLocations,
  getBusinessReviews,
  getBusinessPerformance,
  replyToReview,
  updateBusinessInfo,
  createLocalPost,
} from "../src/google/business";
import { resetGoogleTokenCache } from "../src/google/auth";
import type { Env } from "../src/config";

const env: Env = {
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  GOOGLE_REFRESH_TOKEN: "refresh-token",
  GOOGLE_BUSINESS_ACCOUNT: "accounts/123",
  GOOGLE_BUSINESS_LOCATION: "accounts/123/locations/456",
};

beforeEach(() => {
  resetGoogleTokenCache();
});

const TOKEN_URL = "oauth2.googleapis.com/token";

// A fetcher spy that answers the OAuth token endpoint plus a caller-provided
// business endpoint responder keyed by URL.
function dispatcher(responder: (url: string) => Response) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = input.toString();
    if (url.includes(TOKEN_URL)) {
      return Response.json({ access_token: "access-123", expires_in: 3600 });
    }
    return responder(url);
  });
}

function businessCall(fetcher: ReturnType<typeof dispatcher>) {
  return fetcher.mock.calls.find((c) => !c[0].toString().includes(TOKEN_URL))!;
}

// ---------------------------------------------------------------------------
// listBusinessLocations
// ---------------------------------------------------------------------------

const accountsPayload = () =>
  Response.json({
    accounts: [
      { name: "accounts/123", accountName: "Acme Corp" },
      { name: "accounts/999", accountName: "Other" },
    ],
  });

const locationsPayload = () =>
  Response.json({
    locations: [
      {
        name: "locations/456",
        title: "Acme Downtown",
        websiteUri: "https://acme.example",
        phoneNumbers: { primaryPhone: "+1 555 111 2222" },
        storefrontAddress: {
          addressLines: ["1 Main St"],
          locality: "Springfield",
          administrativeArea: "IL",
          postalCode: "62704",
        },
      },
    ],
  });

describe("listBusinessLocations", () => {
  it("lists accounts then locations for the configured account with the readMask", async () => {
    const fetcher = dispatcher((url) => {
      if (url.includes("mybusinessaccountmanagement.googleapis.com")) {
        return accountsPayload();
      }
      return locationsPayload();
    });

    const result = await listBusinessLocations(env, fetcher);

    const urls = fetcher.mock.calls
      .map((c) => c[0].toString())
      .filter((u) => !u.includes(TOKEN_URL));

    expect(urls[0]).toBe(
      "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
    );
    expect(urls[1]).toBe(
      "https://mybusinessbusinessinformation.googleapis.com/v1/accounts/123/locations?readMask=name,title,storefrontAddress,websiteUri,phoneNumbers&pageSize=100",
    );

    // authorization header present on the business call
    const headers = new Headers(businessCall(fetcher)[1]!.headers);
    expect(headers.get("authorization")).toBe("Bearer access-123");

    expect(result.accounts).toEqual([
      { name: "accounts/123", accountName: "Acme Corp" },
      { name: "accounts/999", accountName: "Other" },
    ]);
    expect(result.locations).toEqual([
      {
        name: "locations/456",
        title: "Acme Downtown",
        websiteUri: "https://acme.example",
        phone: "+1 555 111 2222",
        address: "1 Main St, Springfield, IL, 62704",
      },
    ]);
  });

  it("falls back to the first listed account when none is configured", async () => {
    const noAccount: Env = { ...env, GOOGLE_BUSINESS_ACCOUNT: undefined };
    const fetcher = dispatcher((url) => {
      if (url.includes("mybusinessaccountmanagement.googleapis.com")) {
        return Response.json({
          accounts: [{ name: "accounts/777", accountName: "First" }],
        });
      }
      return Response.json({ locations: [] });
    });

    await listBusinessLocations(noAccount, fetcher);

    const urls = fetcher.mock.calls
      .map((c) => c[0].toString())
      .filter((u) => !u.includes(TOKEN_URL));
    expect(urls[1]).toContain("/v1/accounts/777/locations?");
  });

  it("surfaces the Google error message on a non-ok response", async () => {
    const fetcher = dispatcher(() =>
      Response.json(
        { error: { message: "Business Profile access not approved" } },
        { status: 403 },
      ),
    );

    await expect(listBusinessLocations(env, fetcher)).rejects.toThrow(
      "Business Profile access not approved",
    );
  });
});

// ---------------------------------------------------------------------------
// getBusinessReviews
// ---------------------------------------------------------------------------

const reviewsPayload = () =>
  Response.json({
    reviews: [
      {
        name: "accounts/123/locations/456/reviews/r1",
        reviewer: { displayName: "Jane" },
        starRating: "FIVE",
        comment: "Great!",
        createTime: "2026-01-01T00:00:00Z",
        reviewReply: {
          comment: "Thank you!",
          updateTime: "2026-01-02T00:00:00Z",
        },
      },
      {
        name: "accounts/123/locations/456/reviews/r2",
        reviewer: { displayName: "Bob" },
        starRating: "THREE",
      },
    ],
  });

describe("getBusinessReviews", () => {
  it("builds the v4 reviews URL with pageSize and normalizes reviews", async () => {
    const fetcher = dispatcher(() => reviewsPayload());

    const result = await getBusinessReviews({}, env, fetcher);

    const url = businessCall(fetcher)[0].toString();
    expect(url).toBe(
      "https://mybusiness.googleapis.com/v4/accounts/123/locations/456/reviews?pageSize=20",
    );

    expect(result.location).toBe("accounts/123/locations/456");
    expect(result.reviews).toEqual([
      {
        name: "accounts/123/locations/456/reviews/r1",
        reviewer: "Jane",
        starRating: "FIVE",
        comment: "Great!",
        createTime: "2026-01-01T00:00:00Z",
        reply: { comment: "Thank you!", updateTime: "2026-01-02T00:00:00Z" },
      },
      {
        name: "accounts/123/locations/456/reviews/r2",
        reviewer: "Bob",
        starRating: "THREE",
        comment: undefined,
        createTime: undefined,
        reply: null,
      },
    ]);
  });

  it("caps pageSize at LIMITS.maxBusinessReviews (50)", async () => {
    const fetcher = dispatcher(() => reviewsPayload());

    await getBusinessReviews({ pageSize: 500 }, env, fetcher);

    const url = businessCall(fetcher)[0].toString();
    expect(url).toContain("pageSize=50");
  });

  it("uses the location param over the env default", async () => {
    const fetcher = dispatcher(() => reviewsPayload());

    await getBusinessReviews(
      { location: "accounts/9/locations/9" },
      env,
      fetcher,
    );

    const url = businessCall(fetcher)[0].toString();
    expect(url).toContain("/v4/accounts/9/locations/9/reviews?");
  });

  it("throws when no location is configured or provided", async () => {
    const noLoc: Env = { ...env, GOOGLE_BUSINESS_LOCATION: undefined };
    const fetcher = dispatcher(() => reviewsPayload());

    await expect(getBusinessReviews({}, noLoc, fetcher)).rejects.toThrow(
      "Business location not configured",
    );
    expect(businessCallCount(fetcher)).toBe(0);
  });
});

function businessCallCount(fetcher: ReturnType<typeof dispatcher>) {
  return fetcher.mock.calls.filter((c) => !c[0].toString().includes(TOKEN_URL))
    .length;
}

// ---------------------------------------------------------------------------
// getBusinessPerformance
// ---------------------------------------------------------------------------

const performancePayload = () =>
  Response.json({
    multiDailyMetricTimeSeries: [
      {
        dailyMetricTimeSeries: [
          {
            dailyMetric: "CALL_CLICKS",
            timeSeries: {
              datedValues: [
                { date: { year: 2026, month: 1, day: 1 }, value: "10" },
                { date: { year: 2026, month: 1, day: 2 }, value: "12" },
              ],
            },
          },
        ],
      },
    ],
  });

describe("getBusinessPerformance", () => {
  it("builds the fetchMultiDailyMetricsTimeSeries URL with metrics and range", async () => {
    const fetcher = dispatcher(() => performancePayload());

    const result = await getBusinessPerformance(
      { startDate: "2026-01-01", endDate: "2026-01-02" },
      env,
      fetcher,
    );

    const url = new URL(businessCall(fetcher)[0].toString());
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://businessprofileperformance.googleapis.com/v1/accounts/123/locations/456:fetchMultiDailyMetricsTimeSeries",
    );
    expect(url.searchParams.getAll("dailyMetrics")).toEqual([
      "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
      "CALL_CLICKS",
      "WEBSITE_CLICKS",
    ]);
    expect(url.searchParams.get("dailyRange.startDate.year")).toBe("2026");
    expect(url.searchParams.get("dailyRange.startDate.month")).toBe("1");
    expect(url.searchParams.get("dailyRange.startDate.day")).toBe("1");
    expect(url.searchParams.get("dailyRange.endDate.year")).toBe("2026");
    expect(url.searchParams.get("dailyRange.endDate.month")).toBe("1");
    expect(url.searchParams.get("dailyRange.endDate.day")).toBe("2");

    expect(result.location).toBe("accounts/123/locations/456");
    expect(result.startDate).toBe("2026-01-01");
    expect(result.endDate).toBe("2026-01-02");
    expect(result.series).toEqual([
      {
        metric: "CALL_CLICKS",
        values: [
          { date: "2026-01-01", value: 10 },
          { date: "2026-01-02", value: 12 },
        ],
      },
    ]);
  });

  it("honors custom metrics", async () => {
    const fetcher = dispatcher(() => performancePayload());

    await getBusinessPerformance(
      {
        startDate: "2026-01-01",
        endDate: "2026-01-02",
        metrics: ["WEBSITE_CLICKS"],
      },
      env,
      fetcher,
    );

    const url = new URL(businessCall(fetcher)[0].toString());
    expect(url.searchParams.getAll("dailyMetrics")).toEqual(["WEBSITE_CLICKS"]);
  });

  it("throws when no location is configured or provided", async () => {
    const noLoc: Env = { ...env, GOOGLE_BUSINESS_LOCATION: undefined };
    const fetcher = dispatcher(() => performancePayload());

    await expect(
      getBusinessPerformance(
        { startDate: "2026-01-01", endDate: "2026-01-02" },
        noLoc,
        fetcher,
      ),
    ).rejects.toThrow("Business location not configured");
    expect(businessCallCount(fetcher)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// WRITE guards (most important)
// ---------------------------------------------------------------------------

const REFUSE =
  "Refusing to write: pass confirm=true to execute this Business Profile change";

describe("replyToReview", () => {
  it("refuses and does not call fetch when confirm is false/omitted", async () => {
    const fetcher = dispatcher(() => Response.json({}));

    await expect(
      replyToReview(
        {
          review: "accounts/123/locations/456/reviews/r1",
          comment: "Thanks",
          confirm: false,
        },
        env,
        fetcher,
      ),
    ).rejects.toThrow(REFUSE);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("PUTs to the review reply endpoint with the comment body when confirmed", async () => {
    const fetcher = dispatcher(() =>
      Response.json({
        comment: "Thanks",
        updateTime: "2026-01-03T00:00:00Z",
      }),
    );

    await replyToReview(
      {
        review: "accounts/123/locations/456/reviews/r1",
        comment: "Thanks",
        confirm: true,
      },
      env,
      fetcher,
    );

    const call = businessCall(fetcher);
    expect(call[0].toString()).toBe(
      "https://mybusiness.googleapis.com/v4/accounts/123/locations/456/reviews/r1/reply",
    );
    expect(call[1]!.method).toBe("PUT");
    expect(JSON.parse(String(call[1]!.body))).toEqual({ comment: "Thanks" });
  });
});

describe("updateBusinessInfo", () => {
  it("refuses and does not call fetch when confirm is false/omitted", async () => {
    const fetcher = dispatcher(() => Response.json({}));

    await expect(
      updateBusinessInfo(
        {
          updateMask: "title",
          fields: { title: "New" },
          confirm: false,
        },
        env,
        fetcher,
      ),
    ).rejects.toThrow(REFUSE);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("PATCHes the location with updateMask query and fields body when confirmed", async () => {
    const fetcher = dispatcher(() => Response.json({ title: "New" }));

    await updateBusinessInfo(
      {
        location: "locations/456",
        updateMask: "title,websiteUri",
        fields: { title: "New", websiteUri: "https://new.example" },
        confirm: true,
      },
      env,
      fetcher,
    );

    const call = businessCall(fetcher);
    expect(call[0].toString()).toBe(
      "https://mybusinessbusinessinformation.googleapis.com/v1/locations/456?updateMask=title,websiteUri",
    );
    expect(call[1]!.method).toBe("PATCH");
    expect(JSON.parse(String(call[1]!.body))).toEqual({
      title: "New",
      websiteUri: "https://new.example",
    });
  });

  it("throws when no location is configured or provided", async () => {
    const noLoc: Env = { ...env, GOOGLE_BUSINESS_LOCATION: undefined };
    const fetcher = dispatcher(() => Response.json({}));

    await expect(
      updateBusinessInfo(
        { updateMask: "title", fields: { title: "X" }, confirm: true },
        noLoc,
        fetcher,
      ),
    ).rejects.toThrow("Business location not configured");
  });
});

describe("createLocalPost", () => {
  it("refuses and does not call fetch when confirm is false/omitted", async () => {
    const fetcher = dispatcher(() => Response.json({}));

    await expect(
      createLocalPost(
        {
          post: { summary: "Hello" },
          confirm: false,
        },
        env,
        fetcher,
      ),
    ).rejects.toThrow(REFUSE);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("POSTs the localPosts endpoint with the post body when confirmed", async () => {
    const fetcher = dispatcher(() => Response.json({ name: "post/1" }));

    await createLocalPost(
      {
        post: { summary: "Hello", topicType: "STANDARD" },
        confirm: true,
      },
      env,
      fetcher,
    );

    const call = businessCall(fetcher);
    expect(call[0].toString()).toBe(
      "https://mybusiness.googleapis.com/v4/accounts/123/locations/456/localPosts",
    );
    expect(call[1]!.method).toBe("POST");
    expect(JSON.parse(String(call[1]!.body))).toEqual({
      summary: "Hello",
      topicType: "STANDARD",
    });
  });
});
