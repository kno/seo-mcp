import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SiteProvider } from "../app/SiteContext";
import { setPendingDrillDown } from "../app/navigation";
import { PageReportContainer } from "./PageReportContainer";

const STORAGE_KEY = "seo-mcp:active-site";

/**
 * `SiteContext`'s `activeSite` is seeded SYNCHRONOUSLY from `localStorage`
 * at `SiteProvider` mount (`readStoredActiveSite`, before its own
 * `list_sites` fetch ever resolves) — so a container's own mount-time
 * `useState` initializer already sees it on the very first render, exactly
 * like `CrawlForm`'s existing `initialUrl` drill-down prop. These tests
 * pre-populate `localStorage` rather than only mocking the fetch response,
 * to exercise that real synchronous timing rather than an async update
 * that would arrive too late for a `useState` initializer to observe.
 */
describe("PageReportContainer seeds from SiteContext's activeSite", () => {
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

  it("pre-fills the URL field from the persisted active site when no drill-down is pending", () => {
    window.localStorage.setItem(STORAGE_KEY, "https://active-site.com");

    render(
      <SiteProvider>
        <PageReportContainer />
      </SiteProvider>,
    );

    const input = screen.getByLabelText(/page url/i) as HTMLInputElement;
    expect(input.value).toBe("https://active-site.com");
  });

  it("still lets a pending drill-down win over the active site", () => {
    window.localStorage.setItem(STORAGE_KEY, "https://active-site.com");
    setPendingDrillDown("page-report", "https://drilldown.com/page");

    render(
      <SiteProvider>
        <PageReportContainer />
      </SiteProvider>,
    );

    const input = screen.getByLabelText(/page url/i) as HTMLInputElement;
    expect(input.value).toBe("https://drilldown.com/page");
  });

  it("renders an empty URL field when there is no persisted active site and no drill-down", () => {
    render(
      <SiteProvider>
        <PageReportContainer />
      </SiteProvider>,
    );

    const input = screen.getByLabelText(/page url/i) as HTMLInputElement;
    expect(input.value).toBe("");
  });
});
