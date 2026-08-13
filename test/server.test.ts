import { describe, expect, it, vi } from "vitest";

vi.mock("../src/crawl/page", () => ({
  crawlPage: vi.fn(),
}));

import { crawlPage } from "../src/crawl/page";
import { buildServer } from "../src/server";

type ToolHandle = {
  outputSchema?: unknown;
  handler: (
    args: unknown,
    ctx: unknown,
  ) => Promise<{ isError?: boolean; content: unknown[] }>;
};

function registeredTool(name: string): ToolHandle {
  const server = buildServer({});
  return (server as unknown as { _registeredTools: Record<string, ToolHandle> })
    ._registeredTools[name];
}

describe("buildServer tool registration", () => {
  it.each([
    "health",
    "crawl_page",
    "crawl_site",
    "check_links",
    "analyze_pagespeed",
    "search_console_query",
    "find_striking_distance_keywords",
    "find_low_ctr_opportunities",
    "snapshot_search_console",
    "list_search_console_snapshots",
    "compare_search_console",
  ])("declares an outputSchema for the in-scope tool %s", (name) => {
    expect(registeredTool(name).outputSchema).toBeDefined();
  });

  it.each(["get_keyword_metrics", "discover_keywords", "cluster_keywords"])(
    "leaves the deferred tool %s without an outputSchema",
    (name) => {
      expect(registeredTool(name).outputSchema).toBeUndefined();
    },
  );

  it("surfaces a result violating its own output schema as a tool failure instead of a thrown error", async () => {
    vi.mocked(crawlPage).mockResolvedValue({
      // Missing every required PageAnalysis field on purpose: simulates an
      // internal bug producing a result that does not match the schema.
      url: "https://example.com/",
    } as never);

    const tool = registeredTool("crawl_page");
    const result = await tool.handler({ url: "https://example.com/" }, {});

    expect(result.isError).toBe(true);
  });
});
