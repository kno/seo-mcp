import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { pageSpeedResultSchema } from "../../../../src/schemas/pagespeed";
import type { PageSpeedResult } from "../../../../src/pagespeed/types";
import { PageSpeedContainer } from "./PageSpeedContainer";

/**
 * The dedicated secrets suite for `pagespeed-view`'s "PageSpeed API Key Is
 * Never Persisted or Echoed" requirement — one test per property named in
 * that requirement: storage, URL, echo, export, cache-key. `THE_KEY` is a
 * value distinctive enough that any accidental leak into the DOM, storage,
 * navigation state, or a serialized shape would be trivially detectable by
 * substring search.
 */
const THE_KEY = "shhh-do-not-leak-me-1234567890";

const RESULT: PageSpeedResult = {
  url: "https://example.com",
  strategy: "mobile",
  performanceScore: 90,
  accessibilityScore: 80,
  bestPracticesScore: 100,
  seoScore: 95,
  labMetrics: {
    firstContentfulPaintMs: 800,
    largestContentfulPaintMs: 2400,
    totalBlockingTimeMs: 50,
    cumulativeLayoutShift: 0.05,
    speedIndexMs: 1200,
  },
  opportunities: [],
};

function jsonResponse(body: unknown): Response {
  return { json: () => Promise.resolve(body) } as Response;
}

async function submitWithKey(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/page url/i), "https://example.com");
  await user.type(screen.getByLabelText(/api key/i), THE_KEY);
  await user.click(screen.getByRole("button", { name: /analyze/i }));
}

describe("pagespeed-view secrets suite", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
    localStorage.clear();
    sessionStorage.clear();
    document.cookie = "";
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("storage: the key is never written to localStorage, sessionStorage, or a cookie", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({ data: RESULT, cacheStatus: "bypass", resultAge: 0 }),
    );
    const user = userEvent.setup();
    render(<PageSpeedContainer />);

    await submitWithKey(user);
    await screen.findByText("90");

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      expect(
        key === null ? "" : (localStorage.getItem(key) ?? ""),
      ).not.toContain(THE_KEY);
    }
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      expect(
        key === null ? "" : (sessionStorage.getItem(key) ?? ""),
      ).not.toContain(THE_KEY);
    }
    expect(document.cookie).not.toContain(THE_KEY);
  });

  it("URL: the key never appears in window.location or any pushed/replaced navigation state", async () => {
    const pushStateSpy = vi.spyOn(window.history, "pushState");
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({ data: RESULT, cacheStatus: "bypass", resultAge: 0 }),
    );
    const user = userEvent.setup();
    render(<PageSpeedContainer />);

    await submitWithKey(user);
    await screen.findByText("90");

    expect(window.location.href).not.toContain(THE_KEY);
    expect(window.location.search).not.toContain(THE_KEY);
    expect(window.location.hash).not.toContain(THE_KEY);
    for (const call of pushStateSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(THE_KEY);
    }
    for (const call of replaceStateSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(THE_KEY);
    }
    pushStateSpy.mockRestore();
    replaceStateSpy.mockRestore();
  });

  it("echo: the rendered result never redisplays the submitted key, and the key never appears in the request URL", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({ data: RESULT, cacheStatus: "bypass", resultAge: 0 }),
    );
    const user = userEvent.setup();
    const { container } = render(<PageSpeedContainer />);

    await submitWithKey(user);
    await screen.findByText("90");

    // A key-bearing request goes over POST with a JSON body
    // (`bff/src/router.ts`'s one secret-bearing route), never as a
    // query-string parameter — the request URL itself never contains it.
    const requestUrl = String(vi.mocked(global.fetch).mock.calls[0]?.[0]);
    expect(requestUrl).not.toContain(THE_KEY);

    // What is fully within the UI's control: nothing rendered on screen,
    // anywhere in the DOM, ever shows the key back to the user.
    expect(container.innerHTML).not.toContain(THE_KEY);
  });

  it("export: PageSpeedResult's own schema has no field that could carry the key into a future export", () => {
    const shape = pageSpeedResultSchema.shape as Record<string, unknown>;
    expect(Object.keys(shape)).not.toContain("apiKey");
    expect(Object.keys(shape).join(",").toLowerCase()).not.toContain("key");
  });

  it("cache-key: submitting twice with different keys for the same URL never short-circuits on a client-side cache", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({ data: RESULT, cacheStatus: "bypass", resultAge: 0 }),
    );
    const user = userEvent.setup();
    render(<PageSpeedContainer />);

    await user.type(screen.getByLabelText(/page url/i), "https://example.com");
    await user.type(screen.getByLabelText(/api key/i), "first-key");
    await user.click(screen.getByRole("button", { name: /analyze/i }));
    await screen.findByText("90");

    await user.clear(screen.getByLabelText(/page url/i));
    await user.type(screen.getByLabelText(/page url/i), "https://example.com");
    await user.clear(screen.getByLabelText(/api key/i));
    await user.type(screen.getByLabelText(/api key/i), "second-key");
    await user.click(screen.getByRole("button", { name: /analyze/i }));
    await screen.findByText("90");

    // No memoization keyed by (url, apiKey) short-circuits the second call —
    // every submit is a real network request, never served from an
    // in-memory result cache that could itself be keyed by the secret.
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("structural: PageSpeedContainer holds no in-memory result cache/memo keyed by request input", () => {
    const source = readFileSync(
      join(__dirname, "PageSpeedContainer.tsx"),
      "utf-8",
    );
    expect(source).not.toMatch(/new Map\(/);
    expect(source).not.toMatch(/useMemo\(/);
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("sessionStorage");
  });
});
