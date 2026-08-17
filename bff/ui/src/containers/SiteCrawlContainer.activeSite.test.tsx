import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SiteProvider } from "../app/SiteContext";
import { setPendingDrillDown } from "../app/navigation";
import { SiteCrawlContainer } from "./SiteCrawlContainer";

const STORAGE_KEY = "seo-mcp:active-site";

describe("SiteCrawlContainer seeds from SiteContext's activeSite", () => {
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

  it("pre-fills the site URL field from the persisted active site when no drill-down is pending", () => {
    window.localStorage.setItem(STORAGE_KEY, "https://active-site.com");

    render(
      <SiteProvider>
        <SiteCrawlContainer />
      </SiteProvider>,
    );

    const input = screen.getByLabelText(/site url/i) as HTMLInputElement;
    expect(input.value).toBe("https://active-site.com");
  });

  it("still lets a pending drill-down win over the active site", () => {
    window.localStorage.setItem(STORAGE_KEY, "https://active-site.com");
    setPendingDrillDown("site-crawl", "https://drilldown.com");

    render(
      <SiteProvider>
        <SiteCrawlContainer />
      </SiteProvider>,
    );

    const input = screen.getByLabelText(/site url/i) as HTMLInputElement;
    expect(input.value).toBe("https://drilldown.com");
  });
});
