import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/google/opportunities", () => ({
  findStrikingDistanceKeywords: vi.fn(),
  findLowCtrOpportunities: vi.fn(),
}));
vi.mock("../../src/db/gsc-store", () => ({
  storeGscSnapshot: vi.fn(),
  listSnapshots: vi.fn(),
  getSnapshotRows: vi.fn(),
  twoMostRecent: vi.fn(),
}));
vi.mock("../../src/seo/gsc-diff", () => ({
  diffGscRows: vi.fn(),
}));
vi.mock("../../src/google/search-console", () => ({
  searchConsoleQuery: vi.fn(),
}));
vi.mock("../../src/google/credentials", () => ({
  resolveSiteCredentials: vi.fn().mockResolvedValue({
    credentials: { clientId: "c", clientSecret: "s", refreshToken: "r" },
    source: "global",
    accountKey: "global",
    accountLabel: null,
  }),
}));

import {
  findStrikingDistanceKeywords,
  findLowCtrOpportunities,
} from "../../src/google/opportunities";
import { searchConsoleQuery } from "../../src/google/search-console";
import {
  storeGscSnapshot,
  listSnapshots,
  getSnapshotRows,
  twoMostRecent,
} from "../../src/db/gsc-store";
import { diffGscRows } from "../../src/seo/gsc-diff";
import { buildServer } from "../../src/server";
import { opportunityResultSchema } from "../../src/schemas/opportunities";
import {
  snapshotSearchConsoleResultSchema,
  listSearchConsoleSnapshotsResultSchema,
  compareSearchConsoleResultSchema,
} from "../../src/schemas/gsc-snapshots";

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

function registeredTool(
  name: string,
  env: Record<string, unknown> = {},
): ToolHandle {
  const server = buildServer(env as never);
  return (server as unknown as { _registeredTools: Record<string, ToolHandle> })
    ._registeredTools[name];
}

function gscRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    keys: ["seo tool", "https://example.com/page"],
    clicks: 12,
    impressions: 340,
    ctr: 0.035,
    position: 4.2,
    ...overrides,
  };
}

describe("find_striking_distance_keywords registration exposes an outputSchema", () => {
  it("declares outputSchema as the published opportunityResultSchema", () => {
    const tool = registeredTool("find_striking_distance_keywords");
    expect(tool.outputSchema).toBe(opportunityResultSchema);
  });

  it("round-trips a real OpportunityResult through structuredContent", async () => {
    const result = {
      siteUrl: "sc-domain:example.com",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      dimensions: ["query", "page"],
      criteria: {
        minPosition: 11,
        maxPosition: 20,
        minImpressions: 1,
        limit: 25,
      },
      rowCount: 1,
      rows: [gscRow()],
    };
    vi.mocked(findStrikingDistanceKeywords).mockResolvedValue(result);

    const tool = registeredTool("find_striking_distance_keywords");
    const response = await tool.handler(
      {
        siteUrl: "sc-domain:example.com",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      },
      {},
    );

    expect(response.isError).toBeUndefined();
    expect(response.structuredContent).toEqual(result);
    expect(opportunityResultSchema.parse(response.structuredContent)).toEqual(
      result,
    );
  });
});

describe("find_low_ctr_opportunities registration exposes an outputSchema", () => {
  it("declares outputSchema as the published opportunityResultSchema", () => {
    const tool = registeredTool("find_low_ctr_opportunities");
    expect(tool.outputSchema).toBe(opportunityResultSchema);
  });

  it("round-trips a real OpportunityResult through structuredContent", async () => {
    const result = {
      siteUrl: "sc-domain:example.com",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      dimensions: ["query", "page"],
      criteria: {
        maxPosition: 10,
        minImpressions: 10,
        maxCtr: 0.02,
        limit: 25,
      },
      rowCount: 1,
      rows: [gscRow()],
    };
    vi.mocked(findLowCtrOpportunities).mockResolvedValue(result);

    const tool = registeredTool("find_low_ctr_opportunities");
    const response = await tool.handler(
      {
        siteUrl: "sc-domain:example.com",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      },
      {},
    );

    expect(response.isError).toBeUndefined();
    expect(response.structuredContent).toEqual(result);
    expect(opportunityResultSchema.parse(response.structuredContent)).toEqual(
      result,
    );
  });
});

describe("snapshot_search_console registration exposes an outputSchema", () => {
  it("declares outputSchema as the published snapshotSearchConsoleResultSchema", () => {
    const tool = registeredTool("snapshot_search_console", { DB: {} });
    expect(tool.outputSchema).toBe(snapshotSearchConsoleResultSchema);
  });

  it("round-trips a real result through structuredContent", async () => {
    vi.mocked(searchConsoleQuery).mockResolvedValue({
      siteUrl: "sc-domain:example.com",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      dimensions: ["query", "page"],
      rowCount: 1,
      rows: [gscRow()],
    });
    vi.mocked(storeGscSnapshot).mockResolvedValue({
      snapshotId: 5,
      rowCount: 1,
    });

    const tool = registeredTool("snapshot_search_console", { DB: {} });
    const response = await tool.handler(
      {
        siteUrl: "sc-domain:example.com",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      },
      {},
    );

    expect(response.isError).toBeUndefined();
    expect(
      snapshotSearchConsoleResultSchema.parse(response.structuredContent),
    ).toEqual(response.structuredContent);
  });
});

describe("list_search_console_snapshots registration exposes an outputSchema", () => {
  it("declares outputSchema as the published listSearchConsoleSnapshotsResultSchema", () => {
    const tool = registeredTool("list_search_console_snapshots", { DB: {} });
    expect(tool.outputSchema).toBe(listSearchConsoleSnapshotsResultSchema);
  });

  it("round-trips a real result through structuredContent", async () => {
    vi.mocked(listSnapshots).mockResolvedValue([
      {
        id: 1,
        siteUrl: "sc-domain:example.com",
        capturedAt: "2026-01-01T00:00:00.000Z",
        startDate: "2025-12-01",
        endDate: "2025-12-31",
        label: null,
      },
    ]);

    const tool = registeredTool("list_search_console_snapshots", { DB: {} });
    const response = await tool.handler(
      { siteUrl: "sc-domain:example.com" },
      {},
    );

    expect(response.isError).toBeUndefined();
    expect(
      listSearchConsoleSnapshotsResultSchema.parse(response.structuredContent),
    ).toEqual(response.structuredContent);
  });
});

describe("compare_search_console registration exposes an outputSchema", () => {
  it("declares outputSchema as the published compareSearchConsoleResultSchema", () => {
    const tool = registeredTool("compare_search_console", { DB: {} });
    expect(tool.outputSchema).toBe(compareSearchConsoleResultSchema);
  });

  it("round-trips a real result through structuredContent", async () => {
    vi.mocked(twoMostRecent).mockResolvedValue({
      base: {
        id: 1,
        siteUrl: "sc-domain:example.com",
        capturedAt: "2026-01-01T00:00:00.000Z",
        startDate: "2025-12-01",
        endDate: "2025-12-31",
        label: null,
      },
      current: {
        id: 2,
        siteUrl: "sc-domain:example.com",
        capturedAt: "2026-01-02T00:00:00.000Z",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        label: null,
      },
    });
    vi.mocked(getSnapshotRows).mockResolvedValue([]);
    vi.mocked(diffGscRows).mockReturnValue({
      baseCount: 1,
      currentCount: 1,
      decayed: [],
      improved: [],
      lost: [],
      gained: [],
    });

    const tool = registeredTool("compare_search_console", { DB: {} });
    const response = await tool.handler(
      { siteUrl: "sc-domain:example.com" },
      {},
    );

    expect(response.isError).toBeUndefined();
    expect(
      compareSearchConsoleResultSchema.parse(response.structuredContent),
    ).toEqual(response.structuredContent);
  });
});
