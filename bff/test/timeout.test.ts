import { describe, expect, it } from "vitest";
import { TOOL_TIMEOUT_MS, withTimeout } from "../src/timeout";

describe("TOOL_TIMEOUT_MS", () => {
  it("declares the per-tool budget from the design's timeout table", () => {
    expect(TOOL_TIMEOUT_MS).toEqual({
      health: 5000,
      crawl_page: 15000,
      analyze_pagespeed: 30000,
      crawl_site: 55000,
      check_links: 55000,
      search_console_query: 27000,
      find_striking_distance_keywords: 27000,
      find_low_ctr_opportunities: 27000,
      snapshot_search_console: 28000,
      list_search_console_snapshots: 10000,
      compare_search_console: 10000,
      get_keyword_metrics: 32000,
      discover_keywords: 32000,
      cluster_keywords: 10000,
      find_seo_opportunities: 27000,
      find_keyword_cannibalization: 27000,
      map_keywords_to_pages: 27000,
      find_content_gaps: 27000,
      analyze_domain: 90000,
      snapshot_crawl: 56000,
      list_crawl_snapshots: 10000,
      compare_crawls: 10000,
      delete_search_console_snapshot: 10000,
      delete_crawl_snapshot: 10000,
      list_sites: 10000,
      add_site: 10000,
      delete_site: 10000,
    });
  });

  it("gives analyze_domain a timeout above its combined worst-case crawl + GSC enrichment budget", () => {
    expect(TOOL_TIMEOUT_MS.analyze_domain).toBeGreaterThan(15_000 + 10_000);
  });

  it("gives search_console_query a timeout above gscTimeoutMs + googleTokenTimeoutMs (15s + 10s), per design.md", () => {
    expect(TOOL_TIMEOUT_MS.search_console_query).toBeGreaterThan(
      15_000 + 10_000,
    );
  });

  it("gives every live-Google-call gsc-insight tool the same margin as search_console_query", () => {
    for (const tool of [
      "find_striking_distance_keywords",
      "find_low_ctr_opportunities",
      "snapshot_search_console",
    ] as const) {
      expect(TOOL_TIMEOUT_MS[tool]).toBeGreaterThanOrEqual(15_000 + 10_000);
    }
  });

  it("gives the D1-only snapshot tools a smaller timeout than any live-Google-call tool, since they never call Google", () => {
    for (const tool of [
      "list_search_console_snapshots",
      "compare_search_console",
    ] as const) {
      expect(TOOL_TIMEOUT_MS[tool]).toBeLessThan(
        TOOL_TIMEOUT_MS.search_console_query,
      );
    }
  });

  it("gives snapshot_crawl at least crawl_site's own worst-case budget, since it calls crawlSite internally", () => {
    expect(TOOL_TIMEOUT_MS.snapshot_crawl).toBeGreaterThanOrEqual(
      TOOL_TIMEOUT_MS.crawl_site,
    );
  });

  it("gives the D1-only crawl-snapshot tools a smaller timeout than snapshot_crawl, since they never crawl", () => {
    for (const tool of ["list_crawl_snapshots", "compare_crawls"] as const) {
      expect(TOOL_TIMEOUT_MS[tool]).toBeLessThan(
        TOOL_TIMEOUT_MS.snapshot_crawl,
      );
    }
  });
});

describe("withTimeout", () => {
  it("resolves normally when the run function completes before the timeout", async () => {
    const result = await withTimeout(
      async () => "done",
      TOOL_TIMEOUT_MS.health,
    );
    expect(result).toEqual({ ok: true, data: "done" });
  });

  it("maps an AbortError raised by the timeout signal to a timed-out result", async () => {
    const result = await withTimeout(
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
          });
        }),
      5,
    );
    expect(result).toEqual({ ok: false, timedOut: true });
  });

  it("re-throws an error unrelated to the timeout signal", async () => {
    await expect(
      withTimeout(async () => {
        throw new Error("boom");
      }, TOOL_TIMEOUT_MS.health),
    ).rejects.toThrow("boom");
  });
});
