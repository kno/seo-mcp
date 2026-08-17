import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SiteProvider } from "../app/SiteContext";
import { GscInsightsContainer } from "./GscInsightsContainer";

const STORAGE_KEY = "seo-mcp:active-site";

describe("GscInsightsContainer seeds from SiteContext's activeSite", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn(async () => ({
      json: () =>
        Promise.resolve({
          data: { count: 0, sites: [] },
          cacheStatus: "bypass",
          resultAge: 0,
        }),
    })) as unknown as typeof fetch;
    window.localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    window.localStorage.clear();
  });

  it("pre-fills the shared site URL selector from the persisted active site", () => {
    window.localStorage.setItem(STORAGE_KEY, "sc-domain:active-site.com");

    render(
      <SiteProvider>
        <GscInsightsContainer />
      </SiteProvider>,
    );

    const input = screen.getByLabelText(/site url/i) as HTMLInputElement;
    expect(input.value).toBe("sc-domain:active-site.com");
  });
});
