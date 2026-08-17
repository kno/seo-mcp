import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SiteProvider } from "../app/SiteContext";
import { HistoryContainer } from "./HistoryContainer";

const STORAGE_KEY = "seo-mcp:active-site";

describe("HistoryContainer seeds both URL fields from SiteContext's activeSite", () => {
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

  it("pre-fills the GSC history and crawl history URL fields from the persisted active site", () => {
    window.localStorage.setItem(STORAGE_KEY, "https://active-site.com");

    render(
      <SiteProvider>
        <HistoryContainer />
      </SiteProvider>,
    );

    const gscInput = screen.getByLabelText(
      /search console site url/i,
    ) as HTMLInputElement;
    expect(gscInput.value).toBe("https://active-site.com");

    const crawlInput = screen.getByLabelText(
      /crawl site url/i,
    ) as HTMLInputElement;
    expect(crawlInput.value).toBe("https://active-site.com");
  });
});
