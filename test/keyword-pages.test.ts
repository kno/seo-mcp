import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mapKeywordsToPages,
  findContentGaps,
  mapKeywordsToPagesForSite,
  findContentGapsForSite,
} from "../src/seo/keyword-pages";
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
  clicks: number,
  impressions: number,
  position: number,
  ctr = 0.1,
): GscRow => ({ keys, clicks, impressions, ctr, position });

// ---------------------------------------------------------------------------
// mapKeywordsToPages — pure unit tests
// ---------------------------------------------------------------------------

describe("mapKeywordsToPages", () => {
  it("returns [] for empty input", () => {
    expect(mapKeywordsToPages([])).toEqual([]);
  });

  it("groups two queries on the same page", () => {
    const rows = [
      makeRow(["shoes", "https://x/a"], 10, 100, 5),
      makeRow(["boots", "https://x/a"], 4, 50, 8),
    ];
    const pages = mapKeywordsToPages(rows);
    expect(pages).toHaveLength(1);
    expect(pages[0].page).toBe("https://x/a");
    expect(pages[0].queryCount).toBe(2);
    expect(pages[0].totalClicks).toBe(14);
    expect(pages[0].totalImpressions).toBe(150);
  });

  it("sorts topQueries by clicks DESC then impressions DESC", () => {
    const rows = [
      makeRow(["low", "https://x/a"], 1, 100, 5),
      makeRow(["high", "https://x/a"], 10, 20, 8),
      makeRow(["mid-a", "https://x/a"], 5, 60, 4),
      makeRow(["mid-b", "https://x/a"], 5, 40, 4),
    ];
    const pages = mapKeywordsToPages(rows);
    expect(pages[0].topQueries.map((q) => q.query)).toEqual([
      "high",
      "mid-a",
      "mid-b",
      "low",
    ]);
  });

  it("caps topQueries at topQueriesPerPage (default 10)", () => {
    const rows = Array.from({ length: 15 }, (_, i) =>
      makeRow([`q-${i}`, "https://x/a"], 15 - i, 100, 5),
    );
    const pages = mapKeywordsToPages(rows);
    expect(pages[0].queryCount).toBe(15);
    expect(pages[0].topQueries).toHaveLength(10);
  });

  it("respects a custom topQueriesPerPage option", () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      makeRow([`q-${i}`, "https://x/a"], 5 - i, 100, 5),
    );
    const pages = mapKeywordsToPages(rows, { topQueriesPerPage: 2 });
    expect(pages[0].topQueries).toHaveLength(2);
  });

  it("sorts pages by totalClicks DESC then totalImpressions DESC", () => {
    const rows = [
      makeRow(["q1", "https://x/low"], 1, 10, 5),
      makeRow(["q2", "https://x/high"], 10, 100, 5),
      makeRow(["q3", "https://x/mid"], 5, 50, 5),
    ];
    const pages = mapKeywordsToPages(rows);
    expect(pages.map((p) => p.page)).toEqual([
      "https://x/high",
      "https://x/mid",
      "https://x/low",
    ]);
  });

  it("tie-breaks equal totals by page ASC", () => {
    const rows = [
      makeRow(["q1", "https://x/z"], 5, 50, 5),
      makeRow(["q2", "https://x/a"], 5, 50, 5),
    ];
    const pages = mapKeywordsToPages(rows);
    expect(pages.map((p) => p.page)).toEqual(["https://x/a", "https://x/z"]);
  });

  it("caps results via the limit option", () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      makeRow([`q-${i}`, `https://x/${i}`], 10 - i, 100, 5),
    );
    const pages = mapKeywordsToPages(rows, { limit: 2 });
    expect(pages).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// findContentGaps — pure unit tests
// ---------------------------------------------------------------------------

describe("findContentGaps", () => {
  it("returns [] for empty input", () => {
    expect(findContentGaps([])).toEqual([]);
  });

  it("includes a row at position 21 with impressions 10", () => {
    const rows = [makeRow(["kw", "https://x/a"], 0, 10, 21)];
    const gaps = findContentGaps(rows);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].query).toBe("kw");
    expect(gaps[0].page).toBe("https://x/a");
    expect(gaps[0].impressions).toBe(10);
    expect(gaps[0].position).toBe(21);
  });

  it("excludes a row at position 20 (default threshold 21)", () => {
    const rows = [makeRow(["kw", "https://x/a"], 0, 10, 20)];
    expect(findContentGaps(rows)).toEqual([]);
  });

  it("excludes a row with impressions 9 (below default 10)", () => {
    const rows = [makeRow(["kw", "https://x/a"], 0, 9, 21)];
    expect(findContentGaps(rows)).toEqual([]);
  });

  it("sorts by impressions DESC then position ASC then query ASC", () => {
    const rows = [
      makeRow(["b-kw", "https://x/b"], 0, 50, 25),
      makeRow(["a-kw", "https://x/a"], 0, 100, 30),
      makeRow(["c-kw", "https://x/c"], 0, 100, 22),
    ];
    const gaps = findContentGaps(rows);
    expect(gaps.map((g) => g.query)).toEqual(["c-kw", "a-kw", "b-kw"]);
  });

  it("respects custom minPosition and minImpressions options", () => {
    const rows = [
      makeRow(["kw1", "https://x/a"], 0, 5, 15),
      makeRow(["kw2", "https://x/b"], 0, 20, 40),
    ];
    const gaps = findContentGaps(rows, { minPosition: 12, minImpressions: 5 });
    expect(gaps.map((g) => g.query)).toEqual(["kw2", "kw1"]);
  });

  it("caps results via the limit option", () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      makeRow([`kw-${i}`, `https://x/${i}`], 0, 100 - i, 25),
    );
    const gaps = findContentGaps(rows, { limit: 2 });
    expect(gaps).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// mapKeywordsToPagesForSite — integration with fetcher spy
// ---------------------------------------------------------------------------

const keywordPagesPayload = () =>
  Response.json({
    rows: [
      {
        keys: ["shoes", "https://x/a"],
        clicks: 10,
        impressions: 100,
        ctr: 0.1,
        position: 5,
      },
      {
        keys: ["boots", "https://x/a"],
        clicks: 4,
        impressions: 50,
        ctr: 0.08,
        position: 8,
      },
    ],
  });

describe("mapKeywordsToPagesForSite", () => {
  it("requests rowLimit = maxGscRows (250)", async () => {
    const fetcher = dispatcher(keywordPagesPayload);
    await mapKeywordsToPagesForSite(
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

  it("synthesizes page → top queries mapping over returned rows", async () => {
    const fetcher = dispatcher(keywordPagesPayload);
    const result = await mapKeywordsToPagesForSite(
      {
        siteUrl: "sc-domain:example.com",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      },
      env,
      fetcher,
    );
    expect(result.count).toBe(1);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].page).toBe("https://x/a");
    expect(result.pages[0].queryCount).toBe(2);
    expect(result.siteUrl).toBe("sc-domain:example.com");
  });
});

// ---------------------------------------------------------------------------
// findContentGapsForSite — integration with fetcher spy
// ---------------------------------------------------------------------------

const contentGapsPayload = () =>
  Response.json({
    rows: [
      {
        keys: ["big-gap", "https://x/a"],
        clicks: 0,
        impressions: 100,
        ctr: 0,
        position: 25,
      },
      {
        keys: ["ranked-well", "https://x/b"],
        clicks: 5,
        impressions: 50,
        ctr: 0.1,
        position: 5,
      },
    ],
  });

describe("findContentGapsForSite", () => {
  it("requests rowLimit = maxGscRows (250)", async () => {
    const fetcher = dispatcher(contentGapsPayload);
    await findContentGapsForSite(
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

  it("synthesizes content gaps over returned rows", async () => {
    const fetcher = dispatcher(contentGapsPayload);
    const result = await findContentGapsForSite(
      {
        siteUrl: "sc-domain:example.com",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      },
      env,
      fetcher,
    );
    expect(result.count).toBe(1);
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].query).toBe("big-gap");
    expect(result.siteUrl).toBe("sc-domain:example.com");
  });
});
