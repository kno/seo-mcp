import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/google/ads", () => ({
  getKeywordMetrics: vi.fn(),
  discoverKeywords: vi.fn(),
}));

import { getKeywordMetrics, discoverKeywords } from "../../src/google/ads";
import { buildServer } from "../../src/server";
import {
  keywordMetricsResultSchema,
  clusterResultSchema,
} from "../../src/schemas/keywords";

type ToolHandle = {
  outputSchema?: unknown;
  handler: (
    args: unknown,
    ctx: unknown,
  ) => Promise<{
    isError?: boolean;
    content: unknown[];
    structuredContent?: unknown;
  }>;
};

// `get_keyword_metrics`/`discover_keywords` now resolve credentials via
// `resolveSiteCredentials` before calling the (mocked) `getKeywordMetrics`/
// `discoverKeywords` — an env with no Google credentials at all would throw
// there before ever reaching the mock this suite exercises.
const GLOBAL_ENV = {
  GOOGLE_CLIENT_ID: "global-client-id",
  GOOGLE_CLIENT_SECRET: "global-client-secret",
  GOOGLE_REFRESH_TOKEN: "global-refresh-token",
};

function registeredTool(name: string): ToolHandle {
  const server = buildServer(GLOBAL_ENV);
  return (server as unknown as { _registeredTools: Record<string, ToolHandle> })
    ._registeredTools[name];
}

function metric(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    keyword: "seo tool",
    avgMonthlySearches: 1200,
    competition: "MEDIUM",
    competitionIndex: 45,
    lowTopOfPageBid: 0.5,
    highTopOfPageBid: 2.25,
    ...overrides,
  };
}

describe("get_keyword_metrics registration exposes an outputSchema", () => {
  it("declares outputSchema as the published keywordMetricsResultSchema", () => {
    const tool = registeredTool("get_keyword_metrics");
    expect(tool.outputSchema).toBe(keywordMetricsResultSchema);
  });

  it("round-trips a real KeywordMetricsResult through structuredContent", async () => {
    const result = {
      customerId: "1234567890",
      count: 1,
      keywords: [metric()],
    };
    vi.mocked(getKeywordMetrics).mockResolvedValue(result);

    const tool = registeredTool("get_keyword_metrics");
    const response = await tool.handler({ keywords: ["seo tool"] }, {});

    expect(response.isError).toBeUndefined();
    expect(response.structuredContent).toEqual(result);
    expect(
      keywordMetricsResultSchema.parse(response.structuredContent),
    ).toEqual(result);
  });
});

describe("discover_keywords registration exposes an outputSchema", () => {
  it("declares outputSchema as the published keywordMetricsResultSchema", () => {
    const tool = registeredTool("discover_keywords");
    expect(tool.outputSchema).toBe(keywordMetricsResultSchema);
  });

  it("round-trips a real KeywordMetricsResult through structuredContent", async () => {
    const result = {
      customerId: "1234567890",
      count: 1,
      keywords: [metric({ keyword: "seo audit" })],
    };
    vi.mocked(discoverKeywords).mockResolvedValue(result);

    const tool = registeredTool("discover_keywords");
    const response = await tool.handler({ seedKeywords: ["seo tool"] }, {});

    expect(response.isError).toBeUndefined();
    expect(response.structuredContent).toEqual(result);
    expect(
      keywordMetricsResultSchema.parse(response.structuredContent),
    ).toEqual(result);
  });
});

describe("cluster_keywords registration exposes an outputSchema", () => {
  it("declares outputSchema as the published clusterResultSchema", () => {
    const tool = registeredTool("cluster_keywords");
    expect(tool.outputSchema).toBe(clusterResultSchema);
  });

  it("round-trips a real ClusterResult through structuredContent (no mock needed, pure function)", async () => {
    const tool = registeredTool("cluster_keywords");
    const response = await tool.handler(
      { keywords: ["seo tool", "comprar seo tool"] },
      {},
    );

    expect(response.isError).toBeUndefined();
    expect(clusterResultSchema.parse(response.structuredContent)).toEqual(
      response.structuredContent,
    );
  });
});
