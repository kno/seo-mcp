import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getKeywordMetrics,
  discoverKeywords,
  normalizeMetric,
} from "../src/google/ads";
import { resetGoogleTokenCache } from "../src/google/auth";
import type { Env } from "../src/config";

const env: Env = {
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  GOOGLE_REFRESH_TOKEN: "refresh-token",
  GOOGLE_ADS_DEVELOPER_TOKEN: "dev-token",
  GOOGLE_ADS_CUSTOMER_ID: "123-456-7890",
};

beforeEach(() => {
  resetGoogleTokenCache();
});

function dispatcher(adsResponse: () => Response) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = input.toString();
    if (url.includes("oauth2.googleapis.com/token")) {
      return Response.json({ access_token: "access-123", expires_in: 3600 });
    }
    return adsResponse();
  });
}

const historicalPayload = () =>
  Response.json({
    results: [
      {
        text: "jardinería",
        keywordMetrics: {
          competition: "MEDIUM",
          competitionIndex: "45",
          avgMonthlySearches: "1200",
          lowTopOfPageBidMicros: "250000",
          highTopOfPageBidMicros: "1500000",
          monthlySearchVolumes: [
            { month: "JANUARY", year: "2026", monthlySearches: "1000" },
            { month: "FEBRUARY", year: "2026", monthlySearches: "1400" },
          ],
        },
      },
    ],
  });

// ---------------------------------------------------------------------------
// normalizeMetric — pure unit tests
// ---------------------------------------------------------------------------

describe("normalizeMetric", () => {
  it("coerces string numeric fields and divides micros by 1e6", () => {
    const result = normalizeMetric("seo tool", {
      competition: "HIGH",
      competitionIndex: "80",
      avgMonthlySearches: "500",
      lowTopOfPageBidMicros: "300000",
      highTopOfPageBidMicros: "2000000",
    });
    expect(result).toEqual({
      keyword: "seo tool",
      avgMonthlySearches: 500,
      competition: "HIGH",
      competitionIndex: 80,
      lowTopOfPageBid: 0.3,
      highTopOfPageBid: 2,
    });
  });

  it("falls back avgMonthlySearches to the mean of monthlySearchVolumes", () => {
    const result = normalizeMetric("jardinería", {
      competition: "MEDIUM",
      monthlySearchVolumes: [
        { monthlySearches: "1000" },
        { monthlySearches: "1400" },
      ],
    });
    expect(result.avgMonthlySearches).toBe(1200);
  });

  it("defaults competition to UNKNOWN and numbers to 0", () => {
    const result = normalizeMetric("x", {});
    expect(result.competition).toBe("UNKNOWN");
    expect(result.competitionIndex).toBe(0);
    expect(result.avgMonthlySearches).toBe(0);
    expect(result.lowTopOfPageBid).toBe(0);
    expect(result.highTopOfPageBid).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getKeywordMetrics
// ---------------------------------------------------------------------------

describe("getKeywordMetrics", () => {
  it("builds the correct URL, headers, and body", async () => {
    const fetcher = dispatcher(historicalPayload);

    await getKeywordMetrics({ keywords: ["jardinería", "seo"] }, env, fetcher);

    const adsCall = fetcher.mock.calls.find((c) =>
      c[0].toString().includes("googleads.googleapis.com"),
    )!;
    const url = adsCall[0].toString();
    expect(url).toBe(
      "https://googleads.googleapis.com/v23/customers/1234567890:generateKeywordHistoricalMetrics",
    );

    const init = adsCall[1]!;
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer access-123");
    expect(headers.get("developer-token")).toBe("dev-token");

    const body = JSON.parse(String(init.body));
    expect(body.keywords).toEqual(["jardinería", "seo"]);
    expect(body.geoTargetConstants).toEqual(["geoTargetConstants/2724"]);
    expect(body.language).toBe("languageConstants/1003");
    expect(body.keywordPlanNetwork).toBe("GOOGLE_SEARCH");
  });

  it("caps keywords at LIMITS.maxKeywords (100)", async () => {
    const fetcher = dispatcher(historicalPayload);
    const keywords = Array.from({ length: 150 }, (_, i) => `kw-${i}`);

    await getKeywordMetrics({ keywords }, env, fetcher);

    const adsCall = fetcher.mock.calls.find((c) =>
      c[0].toString().includes("googleads.googleapis.com"),
    )!;
    const body = JSON.parse(String(adsCall[1]!.body));
    expect(body.keywords).toHaveLength(100);
  });

  it("normalizes the historical response", async () => {
    const fetcher = dispatcher(historicalPayload);

    const result = await getKeywordMetrics(
      { keywords: ["jardinería"] },
      env,
      fetcher,
    );

    expect(result.customerId).toBe("1234567890");
    expect(result.count).toBe(1);
    expect(result.keywords[0]).toEqual({
      keyword: "jardinería",
      avgMonthlySearches: 1200,
      competition: "MEDIUM",
      competitionIndex: 45,
      lowTopOfPageBid: 0.25,
      highTopOfPageBid: 1.5,
    });
  });

  it("uses custom geoTargetIds and languageId", async () => {
    const fetcher = dispatcher(historicalPayload);

    await getKeywordMetrics(
      { keywords: ["x"], geoTargetIds: ["2840", "2826"], languageId: "1000" },
      env,
      fetcher,
    );

    const adsCall = fetcher.mock.calls.find((c) =>
      c[0].toString().includes("googleads.googleapis.com"),
    )!;
    const body = JSON.parse(String(adsCall[1]!.body));
    expect(body.geoTargetConstants).toEqual([
      "geoTargetConstants/2840",
      "geoTargetConstants/2826",
    ]);
    expect(body.language).toBe("languageConstants/1000");
  });

  it("throws when the developer token is missing", async () => {
    const fetcher = dispatcher(historicalPayload);
    const noToken: Env = { ...env, GOOGLE_ADS_DEVELOPER_TOKEN: undefined };

    await expect(
      getKeywordMetrics({ keywords: ["x"] }, noToken, fetcher),
    ).rejects.toThrow("Google Ads developer token is not configured");
  });

  it("throws when no customerId param or env is present", async () => {
    const fetcher = dispatcher(historicalPayload);
    const noCustomer: Env = { ...env, GOOGLE_ADS_CUSTOMER_ID: undefined };

    await expect(
      getKeywordMetrics({ keywords: ["x"] }, noCustomer, fetcher),
    ).rejects.toThrow("Google Ads customer ID is not configured");
  });

  it("surfaces the nested Google Ads error message on a non-ok response", async () => {
    const fetcher = dispatcher(() =>
      Response.json(
        {
          error: {
            message: "top level",
            details: [
              { errors: [{ message: "The developer token is not approved" }] },
            ],
          },
        },
        { status: 403 },
      ),
    );

    await expect(
      getKeywordMetrics({ keywords: ["x"] }, env, fetcher),
    ).rejects.toThrow("The developer token is not approved");
  });
});

// ---------------------------------------------------------------------------
// discoverKeywords
// ---------------------------------------------------------------------------

const ideasPayload = () =>
  Response.json({
    results: [
      {
        text: "low",
        keywordIdeaMetrics: {
          competition: "LOW",
          competitionIndex: "10",
          avgMonthlySearches: "100",
          lowTopOfPageBidMicros: "100000",
          highTopOfPageBidMicros: "500000",
        },
      },
      {
        text: "high",
        keywordIdeaMetrics: {
          competition: "HIGH",
          competitionIndex: "90",
          avgMonthlySearches: "9000",
          lowTopOfPageBidMicros: "200000",
          highTopOfPageBidMicros: "800000",
        },
      },
      {
        text: "mid",
        keywordIdeaMetrics: {
          competition: "MEDIUM",
          competitionIndex: "50",
          avgMonthlySearches: "500",
          lowTopOfPageBidMicros: "150000",
          highTopOfPageBidMicros: "600000",
        },
      },
    ],
  });

describe("discoverKeywords", () => {
  it("uses keywordSeed for keyword-only seeds", async () => {
    const fetcher = dispatcher(ideasPayload);

    await discoverKeywords(
      { seedKeywords: ["jardín", "plantas"] },
      env,
      fetcher,
    );

    const adsCall = fetcher.mock.calls.find((c) =>
      c[0].toString().includes("googleads.googleapis.com"),
    )!;
    const url = adsCall[0].toString();
    expect(url).toBe(
      "https://googleads.googleapis.com/v23/customers/1234567890:generateKeywordIdeas",
    );
    const body = JSON.parse(String(adsCall[1]!.body));
    expect(body.keywordSeed).toEqual({ keywords: ["jardín", "plantas"] });
    expect(body.urlSeed).toBeUndefined();
    expect(body.keywordAndUrlSeed).toBeUndefined();
  });

  it("uses urlSeed for url-only seeds", async () => {
    const fetcher = dispatcher(ideasPayload);

    await discoverKeywords({ seedUrl: "https://example.com" }, env, fetcher);

    const adsCall = fetcher.mock.calls.find((c) =>
      c[0].toString().includes("googleads.googleapis.com"),
    )!;
    const body = JSON.parse(String(adsCall[1]!.body));
    expect(body.urlSeed).toEqual({ url: "https://example.com" });
    expect(body.keywordSeed).toBeUndefined();
  });

  it("uses keywordAndUrlSeed when both are provided", async () => {
    const fetcher = dispatcher(ideasPayload);

    await discoverKeywords(
      { seedKeywords: ["jardín"], seedUrl: "https://example.com" },
      env,
      fetcher,
    );

    const adsCall = fetcher.mock.calls.find((c) =>
      c[0].toString().includes("googleads.googleapis.com"),
    )!;
    const body = JSON.parse(String(adsCall[1]!.body));
    expect(body.keywordAndUrlSeed).toEqual({
      url: "https://example.com",
      keywords: ["jardín"],
    });
    expect(body.keywordSeed).toBeUndefined();
    expect(body.urlSeed).toBeUndefined();
  });

  it("throws when no seed is provided", async () => {
    const fetcher = dispatcher(ideasPayload);

    await expect(discoverKeywords({}, env, fetcher)).rejects.toThrow(
      "Provide seedKeywords or seedUrl",
    );
  });

  it("throws when seedKeywords is empty and no url", async () => {
    const fetcher = dispatcher(ideasPayload);

    await expect(
      discoverKeywords({ seedKeywords: [] }, env, fetcher),
    ).rejects.toThrow("Provide seedKeywords or seedUrl");
  });

  it("normalizes and sorts by avgMonthlySearches DESC", async () => {
    const fetcher = dispatcher(ideasPayload);

    const result = await discoverKeywords(
      { seedKeywords: ["x"] },
      env,
      fetcher,
    );

    expect(result.keywords.map((k) => k.keyword)).toEqual([
      "high",
      "mid",
      "low",
    ]);
    expect(result.keywords[0].avgMonthlySearches).toBe(9000);
  });

  it("respects the limit", async () => {
    const fetcher = dispatcher(ideasPayload);

    const result = await discoverKeywords(
      { seedKeywords: ["x"], limit: 2 },
      env,
      fetcher,
    );

    expect(result.count).toBe(2);
    expect(result.keywords).toHaveLength(2);
  });

  it("sends login-customer-id header only when env.GOOGLE_ADS_LOGIN_CUSTOMER_ID is set", async () => {
    const fetcherNoLogin = dispatcher(ideasPayload);
    await discoverKeywords({ seedKeywords: ["x"] }, env, fetcherNoLogin);
    const callNoLogin = fetcherNoLogin.mock.calls.find((c) =>
      c[0].toString().includes("googleads.googleapis.com"),
    )!;
    expect(new Headers(callNoLogin[1]!.headers).get("login-customer-id")).toBe(
      null,
    );

    const fetcherLogin = dispatcher(ideasPayload);
    const withLogin: Env = {
      ...env,
      GOOGLE_ADS_LOGIN_CUSTOMER_ID: "999-888-7777",
    };
    await discoverKeywords({ seedKeywords: ["x"] }, withLogin, fetcherLogin);
    const callLogin = fetcherLogin.mock.calls.find((c) =>
      c[0].toString().includes("googleads.googleapis.com"),
    )!;
    expect(new Headers(callLogin[1]!.headers).get("login-customer-id")).toBe(
      "9998887777",
    );
  });
});
