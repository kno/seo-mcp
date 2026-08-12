import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  findCannibalization,
  buildSeoOpportunities,
  findKeywordCannibalization,
  findSeoOpportunities,
} from "../src/seo/intelligence";
import { resetGoogleTokenCache } from "../src/google/auth";
import type { Env } from "../src/config";
import type { GscRow } from "../src/google/search-console";

const env: Env = {
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  GOOGLE_REFRESH_TOKEN: "refresh-token",
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
// findCannibalization — pure unit tests
// ---------------------------------------------------------------------------

describe("findCannibalization", () => {
  it("returns [] for empty input", () => {
    expect(findCannibalization([])).toEqual([]);
  });

  it("groups a query with 2 qualifying pages into one group", () => {
    const rows = [
      makeRow(["shoes", "https://x/a"], 100, 8, 0.1, 10),
      makeRow(["shoes", "https://x/b"], 50, 9, 0.1, 4),
    ];
    const groups = findCannibalization(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].query).toBe("shoes");
    expect(groups[0].pageCount).toBe(2);
    expect(groups[0].totalImpressions).toBe(150);
    expect(groups[0].totalClicks).toBe(14);
  });

  it("excludes a query with only one qualifying page", () => {
    const rows = [
      makeRow(["hats", "https://x/only"], 80, 5, 0.1),
      makeRow(["shoes", "https://x/a"], 100, 8, 0.1),
      makeRow(["shoes", "https://x/b"], 50, 9, 0.1),
    ];
    const groups = findCannibalization(rows);
    expect(groups.map((g) => g.query)).toEqual(["shoes"]);
  });

  it("applies the minImpressions filter to pages (default 10)", () => {
    const rows = [
      makeRow(["shoes", "https://x/a"], 100, 8, 0.1),
      makeRow(["shoes", "https://x/b"], 9, 9, 0.1), // below default 10
    ];
    // only one qualifying page → not cannibalized
    expect(findCannibalization(rows)).toEqual([]);
  });

  it("respects a custom minImpressions option", () => {
    const rows = [
      makeRow(["shoes", "https://x/a"], 100, 8, 0.1),
      makeRow(["shoes", "https://x/b"], 40, 9, 0.1),
    ];
    expect(findCannibalization(rows, { minImpressions: 50 })).toEqual([]);
    expect(findCannibalization(rows, { minImpressions: 30 })).toHaveLength(1);
  });

  it("sorts pages within a group by impressions DESC", () => {
    const rows = [
      makeRow(["shoes", "https://x/low"], 20, 8, 0.1),
      makeRow(["shoes", "https://x/high"], 200, 9, 0.1),
      makeRow(["shoes", "https://x/mid"], 80, 7, 0.1),
    ];
    const groups = findCannibalization(rows);
    expect(groups[0].pages.map((p) => p.impressions)).toEqual([200, 80, 20]);
  });

  it("caps pages per group at 10", () => {
    const rows = Array.from({ length: 15 }, (_, i) =>
      makeRow(["shoes", `https://x/${i}`], 100 - i, 8, 0.1),
    );
    const groups = findCannibalization(rows);
    expect(groups[0].pageCount).toBe(15);
    expect(groups[0].pages).toHaveLength(10);
  });

  it("sorts groups by totalImpressions DESC then query ASC", () => {
    const rows = [
      makeRow(["b-query", "https://x/a"], 30, 8, 0.1),
      makeRow(["b-query", "https://x/b"], 20, 9, 0.1),
      makeRow(["a-query", "https://x/a"], 500, 8, 0.1),
      makeRow(["a-query", "https://x/b"], 400, 9, 0.1),
    ];
    const groups = findCannibalization(rows);
    expect(groups.map((g) => g.query)).toEqual(["a-query", "b-query"]);
  });

  it("tie-breaks equal totalImpressions by query ASC", () => {
    const rows = [
      makeRow(["z-query", "https://x/a"], 50, 8, 0.1),
      makeRow(["z-query", "https://x/b"], 50, 9, 0.1),
      makeRow(["a-query", "https://x/a"], 50, 8, 0.1),
      makeRow(["a-query", "https://x/b"], 50, 9, 0.1),
    ];
    const groups = findCannibalization(rows);
    expect(groups.map((g) => g.query)).toEqual(["a-query", "z-query"]);
  });

  it("caps the number of groups via the limit option", () => {
    const rows = Array.from({ length: 6 }, (_, i) => [
      makeRow([`q-${i}`, "https://x/a"], 100, 8, 0.1),
      makeRow([`q-${i}`, "https://x/b"], 50, 9, 0.1),
    ]).flat();
    const groups = findCannibalization(rows, { limit: 3 });
    expect(groups).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// buildSeoOpportunities — pure unit tests
// ---------------------------------------------------------------------------

const mixedRows = (): GscRow[] => [
  // low_ctr: position <= 10, impressions >= 10, ctr <= 0.02
  makeRow(["ctr-kw", "https://x/p1"], 100, 5, 0.01, 1),
  // striking_distance: position 11-20
  makeRow(["sd-kw", "https://x/p2"], 60, 15, 0.03, 2),
  // cannibalization: query with 2 pages, high ctr so not low_ctr
  makeRow(["cannib-kw", "https://x/a"], 40, 8, 0.5, 20),
  makeRow(["cannib-kw", "https://x/b"], 30, 9, 0.5, 15),
];

describe("buildSeoOpportunities", () => {
  it("returns [] for empty input", () => {
    expect(buildSeoOpportunities([])).toEqual([]);
  });

  it("produces opportunities of all three types", () => {
    const opps = buildSeoOpportunities(mixedRows());
    const types = opps.map((o) => o.type).sort();
    expect(types).toEqual(["cannibalization", "low_ctr", "striking_distance"]);
  });

  it("computes priorityScore as impact / effort", () => {
    const opps = buildSeoOpportunities(mixedRows());
    const low = opps.find((o) => o.type === "low_ctr")!;
    const sd = opps.find((o) => o.type === "striking_distance")!;
    const can = opps.find((o) => o.type === "cannibalization")!;
    expect(low.impact).toBe(100);
    expect(low.effort).toBe(1);
    expect(low.priorityScore).toBe(100);
    expect(sd.impact).toBe(60);
    expect(sd.effort).toBe(2);
    expect(sd.priorityScore).toBe(30);
    expect(can.impact).toBe(70);
    expect(can.effort).toBe(3);
    expect(can.priorityScore).toBeCloseTo(70 / 3);
  });

  it("sorts opportunities by priorityScore DESC", () => {
    const opps = buildSeoOpportunities(mixedRows());
    expect(opps.map((o) => o.type)).toEqual([
      "low_ctr", // 100
      "striking_distance", // 30
      "cannibalization", // 23.33
    ]);
  });

  it("sets page to null for cannibalization opportunities", () => {
    const opps = buildSeoOpportunities(mixedRows());
    const can = opps.find((o) => o.type === "cannibalization")!;
    expect(can.page).toBeNull();
    expect(can.currentPosition).toBeNull();
    expect(can.query).toBe("cannib-kw");
  });

  it("carries query/page/position for row-based opportunities", () => {
    const opps = buildSeoOpportunities(mixedRows());
    const low = opps.find((o) => o.type === "low_ctr")!;
    expect(low.query).toBe("ctr-kw");
    expect(low.page).toBe("https://x/p1");
    expect(low.currentPosition).toBe(5);
    expect(low.recommendation).toContain("click-through");
  });

  it("caps results via the limit option", () => {
    const opps = buildSeoOpportunities(mixedRows(), { limit: 1 });
    expect(opps).toHaveLength(1);
    expect(opps[0].type).toBe("low_ctr");
  });

  it("tie-breaks equal priorityScore by type ASC then query ASC", () => {
    // two low_ctr rows with impressions 50 → priority 50 each
    const rows = [
      makeRow(["z-kw", "https://x/z"], 50, 5, 0.01),
      makeRow(["a-kw", "https://x/a"], 50, 5, 0.01),
    ];
    const opps = buildSeoOpportunities(rows);
    expect(opps.map((o) => o.query)).toEqual(["a-kw", "z-kw"]);
  });
});

// ---------------------------------------------------------------------------
// findKeywordCannibalization — integration with fetcher spy
// ---------------------------------------------------------------------------

const cannibalPayload = () =>
  Response.json({
    rows: [
      {
        keys: ["shoes", "https://x/a"],
        clicks: 10,
        impressions: 100,
        ctr: 0.1,
        position: 8,
      },
      {
        keys: ["shoes", "https://x/b"],
        clicks: 4,
        impressions: 50,
        ctr: 0.08,
        position: 9,
      },
      {
        keys: ["hats", "https://x/only"],
        clicks: 2,
        impressions: 80,
        ctr: 0.02,
        position: 5,
      },
    ],
  });

describe("findKeywordCannibalization", () => {
  it("requests rowLimit = maxGscRows (250)", async () => {
    const fetcher = dispatcher(cannibalPayload);
    await findKeywordCannibalization(
      {
        siteUrl: "sc-domain:example.com",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      },
      env,
      fetcher,
    );
    const gscCall = fetcher.mock.calls.find((c) =>
      c[0].toString().includes("searchconsole.googleapis.com"),
    )!;
    const body = JSON.parse(String(gscCall[1]!.body));
    expect(body.rowLimit).toBe(250);
  });

  it("synthesizes cannibalization groups over returned rows", async () => {
    const fetcher = dispatcher(cannibalPayload);
    const result = await findKeywordCannibalization(
      {
        siteUrl: "sc-domain:example.com",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      },
      env,
      fetcher,
    );
    expect(result.count).toBe(1);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].query).toBe("shoes");
    expect(result.siteUrl).toBe("sc-domain:example.com");
  });
});

// ---------------------------------------------------------------------------
// findSeoOpportunities — integration with fetcher spy
// ---------------------------------------------------------------------------

const opportunitiesPayload = () =>
  Response.json({
    rows: [
      {
        keys: ["ctr-kw", "https://x/p1"],
        clicks: 1,
        impressions: 100,
        ctr: 0.01,
        position: 5,
      },
      {
        keys: ["sd-kw", "https://x/p2"],
        clicks: 2,
        impressions: 60,
        ctr: 0.03,
        position: 15,
      },
      {
        keys: ["cannib-kw", "https://x/a"],
        clicks: 20,
        impressions: 40,
        ctr: 0.5,
        position: 8,
      },
      {
        keys: ["cannib-kw", "https://x/b"],
        clicks: 15,
        impressions: 30,
        ctr: 0.5,
        position: 9,
      },
    ],
  });

describe("findSeoOpportunities", () => {
  it("requests rowLimit = maxGscRows (250)", async () => {
    const fetcher = dispatcher(opportunitiesPayload);
    await findSeoOpportunities(
      {
        siteUrl: "sc-domain:example.com",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      },
      env,
      fetcher,
    );
    const gscCall = fetcher.mock.calls.find((c) =>
      c[0].toString().includes("searchconsole.googleapis.com"),
    )!;
    const body = JSON.parse(String(gscCall[1]!.body));
    expect(body.rowLimit).toBe(250);
  });

  it("synthesizes a prioritized opportunity list over returned rows", async () => {
    const fetcher = dispatcher(opportunitiesPayload);
    const result = await findSeoOpportunities(
      {
        siteUrl: "sc-domain:example.com",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      },
      env,
      fetcher,
    );
    expect(result.count).toBe(result.opportunities.length);
    expect(result.opportunities.map((o) => o.type)).toEqual([
      "low_ctr",
      "striking_distance",
      "cannibalization",
    ]);
    expect(result.siteUrl).toBe("sc-domain:example.com");
  });
});
