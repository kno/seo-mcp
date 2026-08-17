import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SiteProvider } from "../app/SiteContext";
import { SeoIntelligenceContainer } from "./SeoIntelligenceContainer";

const STORAGE_KEY = "seo-mcp:active-site";

describe("SeoIntelligenceContainer seeds both siteUrl seed points from SiteContext's activeSite", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    // The mocked `list_sites` response must include whatever URL the test
    // pre-populates `localStorage` with — otherwise `SiteContext`'s own
    // fetch-driven reconciliation (a persisted selection no longer in the
    // fetched list falls back to the first site, or `null`) nulls it out
    // before the tab switch below ever mounts `DomainReportTab`.
    global.fetch = vi.fn(async () => ({
      json: () =>
        Promise.resolve({
          data: {
            count: 1,
            sites: [
              {
                id: 1,
                url: window.localStorage.getItem(STORAGE_KEY) ?? "",
                label: null,
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          },
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

  it("pre-fills the shared GSC selector's site URL from the persisted active site", () => {
    window.localStorage.setItem(STORAGE_KEY, "sc-domain:active-site.com");

    render(
      <SiteProvider>
        <SeoIntelligenceContainer />
      </SiteProvider>,
    );

    const input = screen.getByLabelText(
      /site url \(property\)/i,
    ) as HTMLInputElement;
    expect(input.value).toBe("sc-domain:active-site.com");
  });

  it("pre-fills the domain report tab's own URL field from the persisted active site", async () => {
    window.localStorage.setItem(STORAGE_KEY, "https://active-site.com");
    const user = userEvent.setup();

    render(
      <SiteProvider>
        <SeoIntelligenceContainer />
      </SiteProvider>,
    );

    await user.click(screen.getByRole("tab", { name: /domain report/i }));

    const input = screen.getByLabelText("Site URL") as HTMLInputElement;
    expect(input.value).toBe("https://active-site.com");
  });
});
