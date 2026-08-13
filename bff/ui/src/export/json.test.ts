import { describe, expect, it } from "vitest";
import type { PageSpeedResult } from "../../../../src/pagespeed/types";
import { buildJsonExport, serializeJsonExport } from "./json";

const PAGESPEED_RESULT: PageSpeedResult = {
  url: "https://example.com",
  strategy: "mobile",
  performanceScore: 90,
  labMetrics: { firstContentfulPaintMs: 800 },
  opportunities: [],
};

describe("buildJsonExport — JSON fidelity", () => {
  it("carries the rendered result verbatim, by reference, with no reshaping", () => {
    const exported = buildJsonExport({
      tool: "analyze_pagespeed",
      result: PAGESPEED_RESULT,
      cacheStatus: "miss",
      resultAge: 0,
      bounds: [],
    });

    // Reference identity, not a deep-equal copy: proves no field was
    // dropped, renamed, or added anywhere in `result`.
    expect(exported.result).toBe(PAGESPEED_RESULT);
  });

  it("reflects the currently rendered result, not a previously exported one", () => {
    const first = buildJsonExport({
      tool: "analyze_pagespeed",
      result: PAGESPEED_RESULT,
      cacheStatus: "miss",
      resultAge: 0,
      bounds: [],
    });
    const refreshed: PageSpeedResult = {
      ...PAGESPEED_RESULT,
      performanceScore: 42,
    };
    const second = buildJsonExport({
      tool: "analyze_pagespeed",
      result: refreshed,
      cacheStatus: "miss",
      resultAge: 0,
      bounds: [],
    });

    expect(first.result.performanceScore).toBe(90);
    expect(second.result.performanceScore).toBe(42);
  });
});

describe("buildJsonExport — freshness", () => {
  it("carries the result's resultAge in provenance", () => {
    const exported = buildJsonExport({
      tool: "analyze_pagespeed",
      result: PAGESPEED_RESULT,
      cacheStatus: "hit",
      resultAge: 300,
      bounds: [],
    });

    expect(exported.provenance.cacheStatus).toBe("hit");
    expect(exported.provenance.resultAge).toBe(300);
  });

  it("stamps exportedAt at build time rather than leaving it undefined", () => {
    const fixedNow = new Date("2026-08-13T10:00:00.000Z");
    const exported = buildJsonExport({
      tool: "analyze_pagespeed",
      result: PAGESPEED_RESULT,
      cacheStatus: "miss",
      resultAge: 0,
      bounds: [],
      now: () => fixedNow,
    });

    expect(exported.provenance.exportedAt).toBe("2026-08-13T10:00:00.000Z");
  });
});

describe("buildJsonExport — truncation/sample markers", () => {
  it("carries an empty bounds array (no fabricated marker) for a complete result", () => {
    const exported = buildJsonExport({
      tool: "analyze_pagespeed",
      result: PAGESPEED_RESULT,
      cacheStatus: "miss",
      resultAge: 0,
      bounds: [],
    });

    expect(exported.provenance.bounds).toEqual([]);
  });

  it("carries the caller-supplied bounds for a truncated result", () => {
    const exported = buildJsonExport({
      tool: "crawl_site",
      result: { fake: "result" },
      cacheStatus: "miss",
      resultAge: 0,
      bounds: [
        {
          kind: "output_bytes",
          scope: "outputBytes",
          limitName: "maxSiteOutputBytes",
          limitValue: 256_000,
          shown: 3,
          total: 5,
        },
      ],
    });

    expect(exported.provenance.bounds).toHaveLength(1);
    expect(exported.provenance.bounds[0]?.kind).toBe("output_bytes");
  });
});

describe("buildJsonExport — no secret material", () => {
  it("never contains the PageSpeed apiKey: the schema itself has no such field", () => {
    const exported = buildJsonExport({
      tool: "analyze_pagespeed",
      result: PAGESPEED_RESULT,
      cacheStatus: "miss",
      resultAge: 0,
      bounds: [],
    });

    const serialized = serializeJsonExport(exported);
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("THE_SECRET_KEY");
  });

  it("never contains MCP_AUTH_TOKEN or a value derived from it", () => {
    const exported = buildJsonExport({
      tool: "crawl_page",
      result: { url: "https://example.com" },
      cacheStatus: "miss",
      resultAge: 0,
      bounds: [],
    });

    expect(serializeJsonExport(exported)).not.toContain("MCP_AUTH_TOKEN");
  });
});

describe("buildJsonExport — authenticated-source freshness", () => {
  const SOURCE_FRESHNESS = {
    source: "search-console" as const,
    asOf: "2026-08-11",
    lagDays: 2,
    basis: "assumed" as const,
  };

  it("carries sourceFreshness in provenance when supplied", () => {
    const exported = buildJsonExport({
      tool: "search_console_query",
      result: { rowCount: 1 },
      cacheStatus: "miss",
      resultAge: 0,
      bounds: [],
      sourceFreshness: SOURCE_FRESHNESS,
    });

    expect(exported.provenance.sourceFreshness).toEqual(SOURCE_FRESHNESS);
  });

  it("omits sourceFreshness entirely for a non-authenticated result", () => {
    const exported = buildJsonExport({
      tool: "analyze_pagespeed",
      result: PAGESPEED_RESULT,
      cacheStatus: "miss",
      resultAge: 0,
      bounds: [],
    });

    expect(exported.provenance.sourceFreshness).toBeUndefined();
    expect(Object.keys(exported.provenance)).not.toContain("sourceFreshness");
  });

  it("carries a bound-provenance marker for a capped search_console_query export", () => {
    const exported = buildJsonExport({
      tool: "search_console_query",
      result: { rowCount: 250 },
      cacheStatus: "miss",
      resultAge: 0,
      bounds: [
        {
          kind: "probe_cap",
          scope: "rowCount",
          limitName: "maxGscRows",
          limitValue: 250,
          shown: 250,
        },
      ],
      sourceFreshness: SOURCE_FRESHNESS,
    });

    expect(exported.provenance.bounds).toHaveLength(1);
    expect(exported.provenance.bounds[0]?.limitName).toBe("maxGscRows");
  });
});
