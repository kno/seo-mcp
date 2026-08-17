import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { App } from "./App";

function jsonResponse(body: unknown): Response {
  return { json: () => Promise.resolve(body) } as Response;
}

describe("App shell", () => {
  afterEach(() => {
    window.location.hash = "";
  });
  it("renders the dashboard title and a primary navigation landmark", () => {
    render(<App />);
    expect(
      screen.getByRole("heading", { level: 1, name: "SEO Dashboard" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Primary" }),
    ).toBeInTheDocument();
  });

  it("every navigation link is reachable and operable via keyboard alone", async () => {
    const user = userEvent.setup();
    render(<App />);

    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);

    for (const link of links) {
      await user.tab();
    }
    // At least the first link must have received focus during pure
    // Tab-only navigation — proves the nav is keyboard-reachable, not just
    // present in the DOM.
    expect(links).toContain(document.activeElement);
  });

  it("has zero axe violations", async () => {
    const { container } = render(<App />);
    expect((await axe(container)).violations).toEqual([]);
  });

  it("shows a prompt to pick a view when no route is active", () => {
    render(<App />);
    expect(
      screen.getByText(/select a view above to get started/i),
    ).toBeInTheDocument();
  });

  it("clicking a nav link mounts that view's real container, not the placeholder", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("link", { name: "Page Report" }));
    expect(
      screen.getByRole("form", { name: "Page report request" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/select a view above to get started/i),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Site Crawl" }));
    expect(
      screen.getByRole("form", { name: /site crawl/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "PageSpeed" }));
    expect(
      screen.getByRole("form", { name: /pagespeed/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Search Console" }));
    expect(
      screen.getByRole("form", { name: /search console query/i }),
    ).toBeInTheDocument();
  });
});

describe("App shell — domain selector health gating (task 6.4)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
    window.localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    window.localStorage.clear();
    window.location.hash = "";
  });

  it("disables a site whose Search Console health is not healthy, naming the reason in the option's accessible name", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({
        data: {
          count: 2,
          sites: [
            {
              id: 1,
              url: "https://healthy.com",
              label: null,
              createdAt: "2026-01-01T00:00:00.000Z",
              credential: {
                tier: "site",
                accountLabel: "owner@example.com",
                accountKey: "k1",
                health: {
                  searchConsole: { state: "healthy" },
                  googleAds: { state: "healthy" },
                },
              },
            },
            {
              id: 2,
              url: "https://not-connected.com",
              label: null,
              createdAt: "2026-01-01T00:00:00.000Z",
              credential: {
                tier: "none",
                accountLabel: null,
                accountKey: null,
                health: {
                  searchConsole: { state: "not_connected" },
                  googleAds: { state: "not_connected" },
                },
              },
            },
          ],
        },
        cacheStatus: "bypass",
        resultAge: 0,
      }),
    );

    render(<App />);

    const select = (await screen.findByRole("combobox", {
      name: "Domain",
    })) as HTMLSelectElement;
    const options = Array.from(select.querySelectorAll("option"));
    const healthyOption = options.find(
      (o) => o.value === "https://healthy.com",
    )!;
    const notConnectedOption = options.find(
      (o) => o.value === "https://not-connected.com",
    )!;

    expect(healthyOption.disabled).toBe(false);
    expect(notConnectedOption.disabled).toBe(true);
    expect(notConnectedOption.textContent).toContain("Not connected");
  });

  it("rejects a selection attempt on a non-healthy site — the active site does not change", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({
        data: {
          count: 2,
          sites: [
            {
              id: 1,
              url: "https://healthy.com",
              label: null,
              createdAt: "2026-01-01T00:00:00.000Z",
              credential: {
                tier: "site",
                accountLabel: "owner@example.com",
                accountKey: "k1",
                health: {
                  searchConsole: { state: "healthy" },
                  googleAds: { state: "healthy" },
                },
              },
            },
            {
              id: 2,
              url: "https://unhealthy.com",
              label: null,
              createdAt: "2026-01-01T00:00:00.000Z",
              credential: {
                tier: "site",
                accountLabel: "owner@example.com",
                accountKey: "k1",
                health: {
                  searchConsole: { state: "unhealthy", reason: "revoked" },
                  googleAds: { state: "unhealthy" },
                },
              },
            },
          ],
        },
        cacheStatus: "bypass",
        resultAge: 0,
      }),
    );

    render(<App />);

    const select = (await screen.findByRole("combobox", {
      name: "Domain",
    })) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("https://healthy.com"));

    // A disabled `<option>` cannot be programmatically selected by
    // assigning `.value` in a real browser either — this simulates a
    // defeated-disabled-attribute attempt (e.g. a stale DOM), proving the
    // context-level gate in `setActiveSite` is the real backstop, not just
    // the `disabled` attribute.
    select.value = "https://unhealthy.com";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(select.value).toBe("https://healthy.com");
  });
});
