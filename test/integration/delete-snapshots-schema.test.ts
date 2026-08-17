import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/db/gsc-store", () => ({
  storeGscSnapshot: vi.fn(),
  listSnapshots: vi.fn(),
  getSnapshotRows: vi.fn(),
  twoMostRecent: vi.fn(),
  deleteGscSnapshot: vi.fn(),
}));
vi.mock("../../src/db/crawl-store", () => ({
  storeCrawlSnapshot: vi.fn(),
  listCrawlSnapshots: vi.fn(),
  getCrawlSnapshotPages: vi.fn(),
  twoMostRecentCrawls: vi.fn(),
  deleteCrawlSnapshot: vi.fn(),
}));

import { deleteGscSnapshot } from "../../src/db/gsc-store";
import { deleteCrawlSnapshot } from "../../src/db/crawl-store";
import { buildServer } from "../../src/server";
import { deleteSearchConsoleSnapshotResultSchema } from "../../src/schemas/gsc-snapshots";
import { deleteCrawlSnapshotResultSchema } from "../../src/schemas/crawl-snapshots";

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

afterEach(() => {
  vi.clearAllMocks();
});

function registeredTool(
  name: string,
  env: Record<string, unknown> = {},
): ToolHandle {
  const server = buildServer(env as never);
  return (server as unknown as { _registeredTools: Record<string, ToolHandle> })
    ._registeredTools[name];
}

describe("delete_search_console_snapshot registration exposes an outputSchema", () => {
  it("declares outputSchema as the published deleteSearchConsoleSnapshotResultSchema", () => {
    const tool = registeredTool("delete_search_console_snapshot", { DB: {} });
    expect(tool.outputSchema).toBe(deleteSearchConsoleSnapshotResultSchema);
  });

  it("round-trips a real result through structuredContent", async () => {
    vi.mocked(deleteGscSnapshot).mockResolvedValue(true);

    const tool = registeredTool("delete_search_console_snapshot", { DB: {} });
    const response = await tool.handler({ snapshotId: 7, confirm: true }, {});

    expect(response.isError).toBeUndefined();
    expect(
      deleteSearchConsoleSnapshotResultSchema.parse(response.structuredContent),
    ).toEqual(response.structuredContent);
    expect(response.structuredContent).toEqual({
      snapshotId: 7,
      deleted: true,
    });
  });

  it("refuses to delete when confirm is not true, without calling the store", async () => {
    const tool = registeredTool("delete_search_console_snapshot", { DB: {} });
    const response = await tool.handler({ snapshotId: 7, confirm: false }, {});

    expect(response.isError).toBe(true);
    expect(deleteGscSnapshot).not.toHaveBeenCalled();
  });

  it("reports D1-not-configured when DB is absent, before the confirm check", async () => {
    const tool = registeredTool("delete_search_console_snapshot", {});
    const response = await tool.handler({ snapshotId: 7, confirm: true }, {});

    expect(response.isError).toBe(true);
    expect(deleteGscSnapshot).not.toHaveBeenCalled();
  });
});

describe("delete_crawl_snapshot registration exposes an outputSchema", () => {
  it("declares outputSchema as the published deleteCrawlSnapshotResultSchema", () => {
    const tool = registeredTool("delete_crawl_snapshot", { DB: {} });
    expect(tool.outputSchema).toBe(deleteCrawlSnapshotResultSchema);
  });

  it("round-trips a real result through structuredContent", async () => {
    vi.mocked(deleteCrawlSnapshot).mockResolvedValue(false);

    const tool = registeredTool("delete_crawl_snapshot", { DB: {} });
    const response = await tool.handler({ snapshotId: 999, confirm: true }, {});

    expect(response.isError).toBeUndefined();
    expect(
      deleteCrawlSnapshotResultSchema.parse(response.structuredContent),
    ).toEqual(response.structuredContent);
    expect(response.structuredContent).toEqual({
      snapshotId: 999,
      deleted: false,
    });
  });

  it("refuses to delete when confirm is not true, without calling the store", async () => {
    const tool = registeredTool("delete_crawl_snapshot", { DB: {} });
    const response = await tool.handler({ snapshotId: 3, confirm: false }, {});

    expect(response.isError).toBe(true);
    expect(deleteCrawlSnapshot).not.toHaveBeenCalled();
  });
});
