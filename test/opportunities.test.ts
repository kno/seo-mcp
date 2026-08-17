import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  strikingDistanceKeywords,
  lowCtrOpportunities,
  findStrikingDistanceKeywords,
  findLowCtrOpportunities,
} from "../src/google/opportunities";
import { resetGoogleTokenCache } from "../src/google/auth";
import type { GoogleOAuthCredentials } from "../src/google/credential-types";
import type { GscRow } from "../src/google/search-console";

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

const makeRow = (
  keys: string[],
  impressions: number,
  position: number,
  ctr: number,
  clicks = 0,
): GscRow => ({ keys, clicks, impressions, ctr, position });

// ---------------------------------------------------------------------------
// strikingDistanceKeywords — pure unit tests
// ---------------------------------------------------------------------------

describe("strikingDistanceKeywords", () => {
  it("returns [] for empty input", () => {
    expect(strikingDistanceKeywords([])).toEqual([]);
  });

  it("includes rows with position exactly 11 and 20 (inclusive boundaries)", () => {
    const rows = [makeRow(["a"], 100, 11, 0.05), makeRow(["b"], 80, 20, 0.04)];
    const result = strikingDistanceKeywords(rows);
    expect(result).toHaveLength(2);
  });

  it("excludes rows with position 10.9 (below minPosition) and 20.1 (above maxPosition)", () => {
    const rows = [
      makeRow(["too-high"], 200, 10.9, 0.1),
      makeRow(["too-low"], 150, 20.1, 0.01),
      makeRow(["ok"], 100, 15, 0.03),
    ];
    const result = strikingDistanceKeywords(rows);
    expect(result).toHaveLength(1);
    expect(result[0].keys).toEqual(["ok"]);
  });

  it("excludes rows where impressions < minImpressions", () => {
    const rows = [
      makeRow(["low-imp"], 0, 15, 0.03),
      makeRow(["ok"], 5, 15, 0.03),
    ];
    // default minImpressions = 1
    const result = strikingDistanceKeywords(rows);
    expect(result).toHaveLength(1);
    expect(result[0].keys).toEqual(["ok"]);
  });

  it("respects custom minImpressions option", () => {
    const rows = [
      makeRow(["low"], 50, 15, 0.03),
      makeRow(["high"], 200, 15, 0.03),
    ];
    const result = strikingDistanceKeywords(rows, { minImpressions: 100 });
    expect(result).toHaveLength(1);
    expect(result[0].keys).toEqual(["high"]);
  });

  it("sorts by impressions DESC as primary key", () => {
    const rows = [
      makeRow(["low"], 10, 15, 0.03),
      makeRow(["high"], 500, 15, 0.03),
      makeRow(["mid"], 200, 15, 0.03),
    ];
    const result = strikingDistanceKeywords(rows);
    expect(result.map((r) => r.impressions)).toEqual([500, 200, 10]);
  });

  it("tie-breaks by position ASC then keys ASC", () => {
    const rows = [
      makeRow(["z-keyword"], 100, 14, 0.03),
      makeRow(["a-keyword"], 100, 14, 0.03),
      makeRow(["m-keyword"], 100, 12, 0.03),
    ];
    const result = strikingDistanceKeywords(rows);
    expect(result[0].keys).toEqual(["m-keyword"]); // position 12 wins
    expect(result[1].keys).toEqual(["a-keyword"]); // then alpha
    expect(result[2].keys).toEqual(["z-keyword"]);
  });

  it("slices to limit", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      makeRow([`kw-${i}`], 100 - i, 15, 0.03),
    );
    const result = strikingDistanceKeywords(rows, { limit: 5 });
    expect(result).toHaveLength(5);
  });

  it("applies default limit of 25", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      makeRow([`kw-${i}`], 100 - i, 15, 0.03),
    );
    const result = strikingDistanceKeywords(rows);
    expect(result).toHaveLength(25);
  });
});

// ---------------------------------------------------------------------------
// lowCtrOpportunities — pure unit tests
// ---------------------------------------------------------------------------

describe("lowCtrOpportunities", () => {
  it("returns [] for empty input", () => {
    expect(lowCtrOpportunities([])).toEqual([]);
  });

  it("excludes rows where position > maxPosition (default 10)", () => {
    const rows = [
      makeRow(["out"], 50, 11, 0.01),
      makeRow(["in"], 50, 10, 0.01),
    ];
    const result = lowCtrOpportunities(rows);
    expect(result).toHaveLength(1);
    expect(result[0].keys).toEqual(["in"]);
  });

  it("excludes rows where ctr > maxCtr (default 0.02)", () => {
    const rows = [
      makeRow(["high-ctr"], 50, 5, 0.05),
      makeRow(["ok-ctr"], 50, 5, 0.01),
    ];
    const result = lowCtrOpportunities(rows);
    expect(result).toHaveLength(1);
    expect(result[0].keys).toEqual(["ok-ctr"]);
  });

  it("excludes rows where impressions < minImpressions (default 10)", () => {
    const rows = [
      makeRow(["few"], 9, 5, 0.01),
      makeRow(["enough"], 10, 5, 0.01),
    ];
    const result = lowCtrOpportunities(rows);
    expect(result).toHaveLength(1);
    expect(result[0].keys).toEqual(["enough"]);
  });

  it("includes a row at pos 5, impressions 50, ctr 0.01", () => {
    const rows = [makeRow(["good"], 50, 5, 0.01)];
    const result = lowCtrOpportunities(rows);
    expect(result).toHaveLength(1);
  });

  it("sorts by impressions DESC with same tie-break", () => {
    const rows = [
      makeRow(["low"], 15, 5, 0.01),
      makeRow(["high"], 200, 5, 0.01),
    ];
    const result = lowCtrOpportunities(rows);
    expect(result[0].impressions).toBe(200);
  });

  it("slices to limit", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      makeRow([`kw-${i}`], 100 - i, 5, 0.01),
    );
    const result = lowCtrOpportunities(rows, { limit: 3 });
    expect(result).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// findStrikingDistanceKeywords — integration with fetcher spy
// ---------------------------------------------------------------------------

const mixedRowsPayload = () =>
  Response.json({
    rows: [
      // position 11-20 (striking distance)
      {
        keys: ["sd-kw-1"],
        clicks: 5,
        impressions: 300,
        ctr: 0.017,
        position: 12,
      },
      {
        keys: ["sd-kw-2"],
        clicks: 2,
        impressions: 150,
        ctr: 0.013,
        position: 18,
      },
      // position < 11 (excluded from striking distance)
      {
        keys: ["top-kw"],
        clicks: 40,
        impressions: 800,
        ctr: 0.05,
        position: 3,
      },
      // position > 20 (excluded from striking distance)
      {
        keys: ["deep-kw"],
        clicks: 0,
        impressions: 20,
        ctr: 0.0,
        position: 25,
      },
    ],
  });

describe("findStrikingDistanceKeywords", () => {
  it("requests rowLimit = maxGscRows (250) from Search Console", async () => {
    const fetcher = dispatcher(mixedRowsPayload);

    await findStrikingDistanceKeywords(
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
    const body = JSON.parse(String(gscCall[1]!.body));
    expect(body.rowLimit).toBe(250);
  });

  it("returns only filtered rows (positions 11-20)", async () => {
    const fetcher = dispatcher(mixedRowsPayload);

    const result = await findStrikingDistanceKeywords(
      {
        siteUrl: "sc-domain:example.com",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      },
      credentials,
      fetcher,
    );

    expect(result.rowCount).toBe(2);
    expect(result.rows.every((r) => r.position >= 11 && r.position <= 20)).toBe(
      true,
    );
  });

  it("criteria echoes effective thresholds", async () => {
    const fetcher = dispatcher(mixedRowsPayload);

    const result = await findStrikingDistanceKeywords(
      {
        siteUrl: "sc-domain:example.com",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        minPosition: 12,
        maxPosition: 18,
        minImpressions: 5,
        limit: 10,
      },
      credentials,
      fetcher,
    );

    expect(result.criteria).toEqual({
      minPosition: 12,
      maxPosition: 18,
      minImpressions: 5,
      limit: 10,
    });
  });

  it("defaults dimensions to ['query','page']", async () => {
    const fetcher = dispatcher(mixedRowsPayload);

    const result = await findStrikingDistanceKeywords(
      {
        siteUrl: "sc-domain:example.com",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      },
      credentials,
      fetcher,
    );

    expect(result.dimensions).toEqual(["query", "page"]);
  });

  it("rowCount matches filtered rows length", async () => {
    const fetcher = dispatcher(mixedRowsPayload);

    const result = await findStrikingDistanceKeywords(
      {
        siteUrl: "sc-domain:example.com",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      },
      credentials,
      fetcher,
    );

    expect(result.rowCount).toBe(result.rows.length);
  });
});

// ---------------------------------------------------------------------------
// findLowCtrOpportunities — integration with fetcher spy
// ---------------------------------------------------------------------------

const lowCtrPayload = () =>
  Response.json({
    rows: [
      // position <= 10, impressions >= 10, ctr <= 0.02 → included
      {
        keys: ["low-ctr-kw"],
        clicks: 1,
        impressions: 100,
        ctr: 0.01,
        position: 5,
      },
      // ctr > 0.02 → excluded
      {
        keys: ["high-ctr-kw"],
        clicks: 10,
        impressions: 200,
        ctr: 0.05,
        position: 4,
      },
      // position > 10 → excluded
      {
        keys: ["deep-kw"],
        clicks: 0,
        impressions: 50,
        ctr: 0.0,
        position: 15,
      },
      // impressions < 10 → excluded
      {
        keys: ["rare-kw"],
        clicks: 0,
        impressions: 5,
        ctr: 0.0,
        position: 3,
      },
    ],
  });

describe("findLowCtrOpportunities", () => {
  it("requests rowLimit = maxGscRows (250) from Search Console", async () => {
    const fetcher = dispatcher(lowCtrPayload);

    await findLowCtrOpportunities(
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
    const body = JSON.parse(String(gscCall[1]!.body));
    expect(body.rowLimit).toBe(250);
  });

  it("returns only filtered rows (position<=10, impressions>=10, ctr<=0.02)", async () => {
    const fetcher = dispatcher(lowCtrPayload);

    const result = await findLowCtrOpportunities(
      {
        siteUrl: "sc-domain:example.com",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      },
      credentials,
      fetcher,
    );

    expect(result.rowCount).toBe(1);
    expect(result.rows[0].keys).toEqual(["low-ctr-kw"]);
  });

  it("criteria echoes effective thresholds", async () => {
    const fetcher = dispatcher(lowCtrPayload);

    const result = await findLowCtrOpportunities(
      {
        siteUrl: "sc-domain:example.com",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        maxPosition: 8,
        minImpressions: 20,
        maxCtr: 0.03,
        limit: 15,
      },
      credentials,
      fetcher,
    );

    expect(result.criteria).toEqual({
      maxPosition: 8,
      minImpressions: 20,
      maxCtr: 0.03,
      limit: 15,
    });
  });

  it("defaults dimensions to ['query','page']", async () => {
    const fetcher = dispatcher(lowCtrPayload);

    const result = await findLowCtrOpportunities(
      {
        siteUrl: "sc-domain:example.com",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      },
      credentials,
      fetcher,
    );

    expect(result.dimensions).toEqual(["query", "page"]);
  });

  it("rowCount matches filtered rows length", async () => {
    const fetcher = dispatcher(lowCtrPayload);

    const result = await findLowCtrOpportunities(
      {
        siteUrl: "sc-domain:example.com",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      },
      credentials,
      fetcher,
    );

    expect(result.rowCount).toBe(result.rows.length);
  });
});
