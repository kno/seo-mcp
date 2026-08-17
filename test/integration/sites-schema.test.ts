import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/db/site-store", () => ({
  listSites: vi.fn(),
  addSite: vi.fn(),
  deleteSite: vi.fn(),
}));

import { listSites, addSite, deleteSite } from "../../src/db/site-store";
import { buildServer } from "../../src/server";
import {
  listSitesResultSchema,
  addSiteResultSchema,
  deleteSiteResultSchema,
} from "../../src/schemas/sites";

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

describe("list_sites registration exposes an outputSchema", () => {
  it("declares outputSchema as the published listSitesResultSchema", () => {
    const tool = registeredTool("list_sites", { DB: {} });
    expect(tool.outputSchema).toBe(listSitesResultSchema);
  });

  it("round-trips a real result through structuredContent", async () => {
    const sites = [
      {
        id: 1,
        url: "https://example.com",
        label: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    vi.mocked(listSites).mockResolvedValue(sites);

    const tool = registeredTool("list_sites", { DB: {} });
    const response = await tool.handler({}, {});

    expect(response.isError).toBeUndefined();
    expect(response.structuredContent).toEqual({ count: 1, sites });
  });

  it("reports D1-not-configured when DB is absent", async () => {
    const tool = registeredTool("list_sites", {});
    const response = await tool.handler({}, {});
    expect(response.isError).toBe(true);
    expect(listSites).not.toHaveBeenCalled();
  });
});

describe("add_site registration exposes an outputSchema", () => {
  it("declares outputSchema as the published addSiteResultSchema", () => {
    const tool = registeredTool("add_site", { DB: {} });
    expect(tool.outputSchema).toBe(addSiteResultSchema);
  });

  it("round-trips a real result through structuredContent", async () => {
    const site = {
      id: 1,
      url: "https://example.com",
      label: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    vi.mocked(addSite).mockResolvedValue({ added: true, site });

    const tool = registeredTool("add_site", { DB: {} });
    const response = await tool.handler({ url: "https://example.com" }, {});

    expect(response.isError).toBeUndefined();
    expect(response.structuredContent).toEqual({ added: true, site });
  });
});

describe("delete_site registration exposes an outputSchema", () => {
  it("declares outputSchema as the published deleteSiteResultSchema", () => {
    const tool = registeredTool("delete_site", { DB: {} });
    expect(tool.outputSchema).toBe(deleteSiteResultSchema);
  });

  it("round-trips a real result through structuredContent", async () => {
    vi.mocked(deleteSite).mockResolvedValue(true);

    const tool = registeredTool("delete_site", { DB: {} });
    const response = await tool.handler({ siteId: 1, confirm: true }, {});

    expect(response.isError).toBeUndefined();
    expect(response.structuredContent).toEqual({ siteId: 1, deleted: true });
  });

  it("refuses to delete when confirm is not true, without calling the store", async () => {
    const tool = registeredTool("delete_site", { DB: {} });
    const response = await tool.handler({ siteId: 1, confirm: false }, {});

    expect(response.isError).toBe(true);
    expect(deleteSite).not.toHaveBeenCalled();
  });
});
