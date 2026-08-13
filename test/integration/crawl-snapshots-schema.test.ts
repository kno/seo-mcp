import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/crawl/site", () => ({
  crawlSite: vi.fn(),
}));
vi.mock("../../src/db/crawl-store", () => ({
  storeCrawlSnapshot: vi.fn(),
  listCrawlSnapshots: vi.fn(),
  getCrawlSnapshotPages: vi.fn(),
  twoMostRecentCrawls: vi.fn(),
}));
vi.mock("../../src/seo/crawl-diff", () => ({
  diffCrawls: vi.fn(),
}));

import { crawlSite } from "../../src/crawl/site";
import {
  storeCrawlSnapshot,
  listCrawlSnapshots,
  getCrawlSnapshotPages,
  twoMostRecentCrawls,
} from "../../src/db/crawl-store";
import { diffCrawls } from "../../src/seo/crawl-diff";
import { buildServer } from "../../src/server";
import {
  snapshotCrawlResultSchema,
  listCrawlSnapshotsResultSchema,
  compareCrawlsResultSchema,
} from "../../src/schemas/crawl-snapshots";

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

describe("snapshot_crawl registration exposes an outputSchema", () => {
  it("declares outputSchema as the published snapshotCrawlResultSchema", () => {
    const tool = registeredTool("snapshot_crawl", { DB: {} });
    expect(tool.outputSchema).toBe(snapshotCrawlResultSchema);
  });

  it("round-trips a real result through structuredContent", async () => {
    vi.mocked(crawlSite).mockResolvedValue({
      crawled: 5,
      failed: 0,
      issueCounts: { "missing-h1": 1 },
      pages: [],
    } as never);
    vi.mocked(storeCrawlSnapshot).mockResolvedValue({
      snapshotId: 9,
      pageCount: 5,
    });

    const tool = registeredTool("snapshot_crawl", { DB: {} });
    const response = await tool.handler({ url: "https://example.com" }, {});

    expect(response.isError).toBeUndefined();
    expect(snapshotCrawlResultSchema.parse(response.structuredContent)).toEqual(
      response.structuredContent,
    );
  });
});

describe("list_crawl_snapshots registration exposes an outputSchema", () => {
  it("declares outputSchema as the published listCrawlSnapshotsResultSchema", () => {
    const tool = registeredTool("list_crawl_snapshots", { DB: {} });
    expect(tool.outputSchema).toBe(listCrawlSnapshotsResultSchema);
  });

  it("round-trips a real result through structuredContent", async () => {
    vi.mocked(listCrawlSnapshots).mockResolvedValue([
      {
        id: 1,
        url: "https://example.com",
        capturedAt: "2026-01-01T00:00:00.000Z",
        label: null,
        crawled: 5,
        failed: 0,
        issueCounts: {},
      },
    ]);

    const tool = registeredTool("list_crawl_snapshots", { DB: {} });
    const response = await tool.handler({ url: "https://example.com" }, {});

    expect(response.isError).toBeUndefined();
    expect(
      listCrawlSnapshotsResultSchema.parse(response.structuredContent),
    ).toEqual(response.structuredContent);
  });
});

describe("compare_crawls registration exposes an outputSchema", () => {
  it("declares outputSchema as the published compareCrawlsResultSchema", () => {
    const tool = registeredTool("compare_crawls", { DB: {} });
    expect(tool.outputSchema).toBe(compareCrawlsResultSchema);
  });

  it("round-trips a real result through structuredContent", async () => {
    vi.mocked(twoMostRecentCrawls).mockResolvedValue({
      base: {
        id: 1,
        url: "https://example.com",
        capturedAt: "2026-01-01T00:00:00.000Z",
        label: null,
        crawled: 5,
        failed: 0,
        issueCounts: {},
      },
      current: {
        id: 2,
        url: "https://example.com",
        capturedAt: "2026-01-02T00:00:00.000Z",
        label: null,
        crawled: 5,
        failed: 0,
        issueCounts: {},
      },
    });
    vi.mocked(getCrawlSnapshotPages).mockResolvedValue([]);
    vi.mocked(diffCrawls).mockReturnValue({
      newPages: [],
      removedPages: [],
      newIssues: [],
      resolvedIssues: [],
      issueCountDeltas: {},
    });

    const tool = registeredTool("compare_crawls", { DB: {} });
    const response = await tool.handler({ url: "https://example.com" }, {});

    expect(response.isError).toBeUndefined();
    expect(compareCrawlsResultSchema.parse(response.structuredContent)).toEqual(
      response.structuredContent,
    );
  });
});
