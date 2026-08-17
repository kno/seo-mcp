import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SiteProvider } from "../app/SiteContext";
import { PageSpeedContainer } from "./PageSpeedContainer";

const STORAGE_KEY = "seo-mcp:active-site";

describe("PageSpeedContainer seeds from SiteContext's activeSite", () => {
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

  it("pre-fills the page URL field from the persisted active site", () => {
    window.localStorage.setItem(STORAGE_KEY, "https://active-site.com/page");

    render(
      <SiteProvider>
        <PageSpeedContainer />
      </SiteProvider>,
    );

    const input = screen.getByLabelText(/page url/i) as HTMLInputElement;
    expect(input.value).toBe("https://active-site.com/page");
  });

  it("renders an empty page URL field when there is no persisted active site", () => {
    render(
      <SiteProvider>
        <PageSpeedContainer />
      </SiteProvider>,
    );

    const input = screen.getByLabelText(/page url/i) as HTMLInputElement;
    expect(input.value).toBe("");
  });
});
