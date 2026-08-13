import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestTool, userIntent } from "./client";

describe("userIntent", () => {
  it("mints a token from a real user-gesture event type", () => {
    const intent = userIntent({ type: "click" });
    expect(intent).toBeDefined();
  });

  it("mints a token from a form submit event type", () => {
    const intent = userIntent({ type: "submit" });
    expect(intent).toBeDefined();
  });

  it("throws for a non-gesture event type such as a synthetic 'load' or 'visibilitychange' event", () => {
    expect(() => userIntent({ type: "visibilitychange" })).toThrow(
      /user-gesture/,
    );
    expect(() => userIntent({ type: "load" })).toThrow(/user-gesture/);
  });
});

describe("requestTool", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("issues a GET request to /api/tools/{tool} with the input serialized as a query string", async () => {
    const mockResponse = {
      json: () =>
        Promise.resolve({
          data: { ok: true },
          cacheStatus: "hit",
          resultAge: 5,
        }),
    };
    vi.mocked(global.fetch).mockResolvedValue(mockResponse as Response);

    const intent = userIntent({ type: "click" });
    const controller = new AbortController();
    const result = await requestTool<{ ok: boolean }>(
      "crawl_page",
      { url: "https://example.com" },
      intent,
      { signal: controller.signal },
    );

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/tools/crawl_page?url=https%3A%2F%2Fexample.com",
      { method: "GET", signal: controller.signal },
    );
    expect(result).toEqual({
      data: { ok: true },
      cacheStatus: "hit",
      resultAge: 5,
    });
  });

  it("appends refresh=1 when opts.refresh is true, matching the BFF's cache-bypass query flag", async () => {
    const mockResponse = {
      json: () =>
        Promise.resolve({ data: {}, cacheStatus: "miss", resultAge: 0 }),
    };
    vi.mocked(global.fetch).mockResolvedValue(mockResponse as Response);

    const intent = userIntent({ type: "submit" });
    const controller = new AbortController();
    await requestTool("health", {}, intent, {
      signal: controller.signal,
      refresh: true,
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/tools/health?refresh=1", {
      method: "GET",
      signal: controller.signal,
    });
  });

  it("returns the decoded error envelope verbatim on a BFF error response", async () => {
    const mockResponse = {
      json: () =>
        Promise.resolve({
          error: {
            code: "upstream_rate_limited",
            message: "rate limited",
            retryAfter: 30,
          },
        }),
    };
    vi.mocked(global.fetch).mockResolvedValue(mockResponse as Response);

    const intent = userIntent({ type: "click" });
    const controller = new AbortController();
    const result = await requestTool(
      "check_links",
      { url: "https://example.com" },
      intent,
      { signal: controller.signal },
    );

    expect(result).toEqual({
      error: {
        code: "upstream_rate_limited",
        message: "rate limited",
        retryAfter: 30,
      },
    });
  });
});
