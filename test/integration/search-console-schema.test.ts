import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/google/search-console", () => ({
  searchConsoleQuery: vi.fn(),
}));

import {
  searchConsoleQuery,
  type GscQueryResult,
} from "../../src/google/search-console";
import { buildServer } from "../../src/server";
import { gscQueryResultSchema } from "../../src/schemas/search-console";

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

function registeredTool(name: string): ToolHandle {
  const server = buildServer({});
  return (server as unknown as { _registeredTools: Record<string, ToolHandle> })
    ._registeredTools[name];
}

describe("search_console_query registration exposes an outputSchema", () => {
  it("declares outputSchema as the published gscQueryResultSchema", () => {
    const tool = registeredTool("search_console_query");
    expect(tool.outputSchema).toBe(gscQueryResultSchema);
  });

  it("round-trips a real result through structuredContent, matching the schema", async () => {
    const result = {
      siteUrl: "sc-domain:example.com",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      dimensions: ["query", "page"] as GscQueryResult["dimensions"],
      rowCount: 1,
      rows: [
        {
          keys: ["seo tool", "https://example.com/page"],
          clicks: 12,
          impressions: 340,
          ctr: 0.035,
          position: 4.2,
        },
      ],
    };
    vi.mocked(searchConsoleQuery).mockResolvedValue(result);

    const tool = registeredTool("search_console_query");
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
    expect(gscQueryResultSchema.parse(response.structuredContent)).toEqual(
      result,
    );
  });

  it("surfaces a schema-violating result as a tool failure, not invalid structuredContent", async () => {
    vi.mocked(searchConsoleQuery).mockResolvedValue({
      // Missing every required field on purpose.
      siteUrl: "sc-domain:example.com",
    } as never);

    const tool = registeredTool("search_console_query");
    const response = await tool.handler(
      {
        siteUrl: "sc-domain:example.com",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      },
      {},
    );

    expect(response.isError).toBe(true);
  });
});
