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
    });
  });

  it("gives search_console_query a timeout above gscTimeoutMs + googleTokenTimeoutMs (15s + 10s), per design.md", () => {
    expect(TOOL_TIMEOUT_MS.search_console_query).toBeGreaterThan(
      15_000 + 10_000,
    );
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
