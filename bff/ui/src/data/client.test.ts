import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchUsage, requestTool, userIntent } from "./client";
import { SecretCell } from "./secret";

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

  it("consumes a secret cell into a POST body exactly once, never into the URL, and never retains it", async () => {
    const mockResponse = {
      json: () =>
        Promise.resolve({ data: {}, cacheStatus: "bypass", resultAge: 0 }),
    };
    vi.mocked(global.fetch).mockResolvedValue(mockResponse as Response);

    const intent = userIntent({ type: "submit" });
    const controller = new AbortController();
    const secret = SecretCell.from("real-api-key");

    await requestTool(
      "analyze_pagespeed",
      { url: "https://example.com", strategy: "mobile" },
      intent,
      { signal: controller.signal, secrets: { apiKey: secret } },
    );

    expect(global.fetch).toHaveBeenCalledWith("/api/tools/analyze_pagespeed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://example.com",
        strategy: "mobile",
        apiKey: "real-api-key",
      }),
      signal: controller.signal,
    });
    // The secret never appears in the request URL itself.
    const requestUrl = String(vi.mocked(global.fetch).mock.calls[0]?.[0]);
    expect(requestUrl).not.toContain("real-api-key");
    // The cell was consumed by requestTool building the body; a second read
    // (e.g. from a caller that mistakenly held the same cell) returns
    // undefined.
    expect(secret.take()).toBeUndefined();
  });

  it("omits the secret param entirely when the cell has already been taken", async () => {
    const mockResponse = {
      json: () =>
        Promise.resolve({ data: {}, cacheStatus: "bypass", resultAge: 0 }),
    };
    vi.mocked(global.fetch).mockResolvedValue(mockResponse as Response);

    const intent = userIntent({ type: "submit" });
    const controller = new AbortController();
    const secret = SecretCell.from("real-api-key");
    secret.take(); // exhausted before requestTool ever sees it

    await requestTool(
      "analyze_pagespeed",
      { url: "https://example.com", strategy: "mobile" },
      intent,
      { signal: controller.signal, secrets: { apiKey: secret } },
    );

    const requestUrl = String(vi.mocked(global.fetch).mock.calls[0]?.[0]);
    expect(requestUrl).not.toContain("apiKey");
  });
});

describe("fetchUsage", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("issues a GET request to the distinct /api/usage route, never /api/tools/*", async () => {
    const snapshot = {
      callCount: 3,
      windowSeconds: 3600,
      windowElapsedSeconds: 120,
      estimate: true as const,
      note: "estimate only",
    };
    vi.mocked(global.fetch).mockResolvedValue({
      json: () => Promise.resolve(snapshot),
    } as Response);

    const result = await fetchUsage();

    expect(global.fetch).toHaveBeenCalledWith("/api/usage", {
      method: "GET",
      signal: undefined,
    });
    expect(result).toEqual(snapshot);
  });
});
