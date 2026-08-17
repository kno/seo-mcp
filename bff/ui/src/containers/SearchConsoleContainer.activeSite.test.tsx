import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SiteProvider } from "../app/SiteContext";
import { SearchConsoleContainer } from "./SearchConsoleContainer";

const STORAGE_KEY = "seo-mcp:active-site";

describe("SearchConsoleContainer seeds from SiteContext's activeSite", () => {
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

  it("pre-fills the site URL field from the persisted active site", () => {
    window.localStorage.setItem(STORAGE_KEY, "sc-domain:active-site.com");

    render(
      <SiteProvider>
        <SearchConsoleContainer />
      </SiteProvider>,
    );

    const input = screen.getByLabelText(/site url/i) as HTMLInputElement;
    expect(input.value).toBe("sc-domain:active-site.com");
  });

  it("renders an empty site URL field when there is no persisted active site", () => {
    render(
      <SiteProvider>
        <SearchConsoleContainer />
      </SiteProvider>,
    );

    const input = screen.getByLabelText(/site url/i) as HTMLInputElement;
    expect(input.value).toBe("");
  });
});
