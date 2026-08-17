import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SiteProvider, useActiveSite, useSiteContext } from "./SiteContext";

const STORAGE_KEY = "seo-mcp:active-site";

const HEALTHY_CREDENTIAL = {
  tier: "site" as const,
  accountLabel: "owner@example.com",
  accountKey: "k1",
  health: {
    searchConsole: { state: "healthy" as const },
    googleAds: { state: "healthy" as const },
  },
};

const UNHEALTHY_CREDENTIAL = {
  tier: "site" as const,
  accountLabel: "owner@example.com",
  accountKey: "k1",
  health: {
    searchConsole: { state: "unhealthy" as const, reason: "revoked" },
    googleAds: { state: "unhealthy" as const },
  },
};

function TestConsumer() {
  const { sites, activeSite, setActiveSite, addSite, deleteSite, loading } =
    useSiteContext();
  return (
    <div>
      <p data-testid="loading">{String(loading)}</p>
      <p data-testid="active-site">{activeSite ?? "(none)"}</p>
      <ul data-testid="sites">
        {sites.map((site) => (
          <li key={site.id}>{site.url}</li>
        ))}
      </ul>
      <button type="button" onClick={() => setActiveSite("https://b.com")}>
        select-b
      </button>
      <button
        type="button"
        onClick={(event) => addSite(event, "https://new.com", "New")}
      >
        add
      </button>
      {sites[0] && (
        <button
          type="button"
          onClick={(event) => deleteSite(event, sites[0].id)}
        >
          delete-first
        </button>
      )}
    </div>
  );
}

function jsonResponse(body: unknown): Response {
  return { json: () => Promise.resolve(body) } as Response;
}

describe("SiteProvider", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
    window.localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    window.localStorage.clear();
  });

  it("fetches list_sites on mount and exposes the fetched sites", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({
        data: {
          count: 2,
          sites: [
            {
              id: 1,
              url: "https://a.com",
              label: null,
              createdAt: "2026-01-01T00:00:00.000Z",
              credential: HEALTHY_CREDENTIAL,
            },
            {
              id: 2,
              url: "https://b.com",
              label: null,
              createdAt: "2026-01-02T00:00:00.000Z",
              credential: HEALTHY_CREDENTIAL,
            },
          ],
        },
        cacheStatus: "bypass",
        resultAge: 0,
      }),
    );

    render(
      <SiteProvider>
        <TestConsumer />
      </SiteProvider>,
    );

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/tools/list_sites",
      expect.objectContaining({ method: "GET" }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("loading")).toHaveTextContent("false"),
    );
    expect(screen.getByTestId("sites").textContent).toContain("https://a.com");
    expect(screen.getByTestId("sites").textContent).toContain("https://b.com");
    // No stored selection yet — falls back to the first fetched site.
    expect(screen.getByTestId("active-site")).toHaveTextContent(
      "https://a.com",
    );
  });

  it("falls back to null when the persisted active site is no longer in the fetched list", async () => {
    window.localStorage.setItem(STORAGE_KEY, "https://stale.com");
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({
        data: {
          count: 1,
          sites: [
            {
              id: 1,
              url: "https://a.com",
              label: null,
              createdAt: "2026-01-01T00:00:00.000Z",
              credential: HEALTHY_CREDENTIAL,
            },
          ],
        },
        cacheStatus: "bypass",
        resultAge: 0,
      }),
    );

    render(
      <SiteProvider>
        <TestConsumer />
      </SiteProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("loading")).toHaveTextContent("false"),
    );
    expect(screen.getByTestId("active-site")).toHaveTextContent(
      "https://a.com",
    );
  });

  it("keeps the persisted active site when it IS still in the fetched list", async () => {
    window.localStorage.setItem(STORAGE_KEY, "https://b.com");
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({
        data: {
          count: 2,
          sites: [
            {
              id: 1,
              url: "https://a.com",
              label: null,
              createdAt: "2026-01-01T00:00:00.000Z",
              credential: HEALTHY_CREDENTIAL,
            },
            {
              id: 2,
              url: "https://b.com",
              label: null,
              createdAt: "2026-01-02T00:00:00.000Z",
              credential: HEALTHY_CREDENTIAL,
            },
          ],
        },
        cacheStatus: "bypass",
        resultAge: 0,
      }),
    );

    render(
      <SiteProvider>
        <TestConsumer />
      </SiteProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("loading")).toHaveTextContent("false"),
    );
    expect(screen.getByTestId("active-site")).toHaveTextContent(
      "https://b.com",
    );
  });

  it("persists setActiveSite to localStorage", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({
        data: { count: 0, sites: [] },
        cacheStatus: "bypass",
        resultAge: 0,
      }),
    );
    const user = userEvent.setup();

    render(
      <SiteProvider>
        <TestConsumer />
      </SiteProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("loading")).toHaveTextContent("false"),
    );

    await user.click(screen.getByRole("button", { name: "select-b" }));

    expect(screen.getByTestId("active-site")).toHaveTextContent(
      "https://b.com",
    );
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("https://b.com");
  });

  it("addSite POSTs via add_site as GET+query and re-fetches the list on success", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          data: { count: 0, sites: [] },
          cacheStatus: "bypass",
          resultAge: 0,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            added: true,
            site: {
              id: 1,
              url: "https://new.com",
              label: "New",
              createdAt: "2026-01-01T00:00:00.000Z",
              credential: HEALTHY_CREDENTIAL,
            },
          },
          cacheStatus: "bypass",
          resultAge: 0,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            count: 1,
            sites: [
              {
                id: 1,
                url: "https://new.com",
                label: "New",
                createdAt: "2026-01-01T00:00:00.000Z",
                credential: HEALTHY_CREDENTIAL,
              },
            ],
          },
          cacheStatus: "bypass",
          resultAge: 0,
        }),
      );
    const user = userEvent.setup();

    render(
      <SiteProvider>
        <TestConsumer />
      </SiteProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("loading")).toHaveTextContent("false"),
    );

    await user.click(screen.getByRole("button", { name: "add" }));

    await waitFor(() =>
      expect(screen.getByTestId("sites").textContent).toContain(
        "https://new.com",
      ),
    );
    const addCall = vi
      .mocked(global.fetch)
      .mock.calls.find(([url]) =>
        String(url).startsWith("/api/tools/add_site"),
      );
    expect(addCall).toBeDefined();
    expect(String(addCall![0])).toContain("url=https%3A%2F%2Fnew.com");
  });

  it("deleteSite POSTs to delete_site and splices the row from local state", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            count: 1,
            sites: [
              {
                id: 1,
                url: "https://a.com",
                label: null,
                createdAt: "2026-01-01T00:00:00.000Z",
                credential: HEALTHY_CREDENTIAL,
              },
            ],
          },
          cacheStatus: "bypass",
          resultAge: 0,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: { siteId: 1, deleted: true },
          cacheStatus: "bypass",
          resultAge: 0,
        }),
      );
    const user = userEvent.setup();

    render(
      <SiteProvider>
        <TestConsumer />
      </SiteProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("loading")).toHaveTextContent("false"),
    );
    expect(screen.getByTestId("sites").textContent).toContain("https://a.com");

    await user.click(screen.getByRole("button", { name: "delete-first" }));

    await waitFor(() =>
      expect(screen.getByTestId("sites").textContent).not.toContain(
        "https://a.com",
      ),
    );
    const deleteCall = vi
      .mocked(global.fetch)
      .mock.calls.find(([url]) => String(url) === "/api/tools/delete_site");
    expect(deleteCall).toBeDefined();
    expect(deleteCall![1]).toMatchObject({ method: "POST" });
  });
});

describe("useActiveSite", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
    window.localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    window.localStorage.clear();
  });

  it("returns null (never throws) when rendered outside a SiteProvider", () => {
    function Consumer() {
      const activeSite = useActiveSite();
      return <p data-testid="active">{activeSite ?? "(none)"}</p>;
    }
    render(<Consumer />);
    expect(screen.getByTestId("active")).toHaveTextContent("(none)");
  });

  it("returns the current activeSite when rendered within a SiteProvider", async () => {
    window.localStorage.setItem(STORAGE_KEY, "https://a.com");
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({
        data: {
          count: 1,
          sites: [
            {
              id: 1,
              url: "https://a.com",
              label: null,
              createdAt: "2026-01-01T00:00:00.000Z",
              credential: HEALTHY_CREDENTIAL,
            },
          ],
        },
        cacheStatus: "bypass",
        resultAge: 0,
      }),
    );
    function Consumer() {
      const activeSite = useActiveSite();
      return <p data-testid="active">{activeSite ?? "(none)"}</p>;
    }

    render(
      <SiteProvider>
        <Consumer />
      </SiteProvider>,
    );

    expect(screen.getByTestId("active")).toHaveTextContent("https://a.com");
  });
});

describe("setActiveSite health gating (task 6.4/6.5 — 'An invalid site cannot be selected')", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
    window.localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    window.localStorage.clear();
  });

  function GatedConsumer() {
    const { sites, activeSite, setActiveSite } = useSiteContext();
    return (
      <div>
        <p data-testid="active-site">{activeSite ?? "(none)"}</p>
        <button
          type="button"
          onClick={() => setActiveSite("https://unhealthy.com")}
        >
          select-unhealthy
        </button>
        <p data-testid="site-count">{sites.length}</p>
      </div>
    );
  }

  it("rejects selecting a site whose Search Console health is unhealthy — the active site does not change", async () => {
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
              credential: HEALTHY_CREDENTIAL,
            },
            {
              id: 2,
              url: "https://unhealthy.com",
              label: null,
              createdAt: "2026-01-02T00:00:00.000Z",
              credential: UNHEALTHY_CREDENTIAL,
            },
          ],
        },
        cacheStatus: "bypass",
        resultAge: 0,
      }),
    );
    const user = userEvent.setup();

    render(
      <SiteProvider>
        <GatedConsumer />
      </SiteProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("site-count")).toHaveTextContent("2"),
    );
    expect(screen.getByTestId("active-site")).toHaveTextContent(
      "https://healthy.com",
    );

    await user.click(screen.getByRole("button", { name: "select-unhealthy" }));

    expect(screen.getByTestId("active-site")).toHaveTextContent(
      "https://healthy.com",
    );
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBe(
      "https://unhealthy.com",
    );
  });
});

describe("disconnectSite / recheckSite", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
    window.localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    window.localStorage.clear();
  });

  function ActionsConsumer() {
    const { sites, disconnectSite, recheckSite } = useSiteContext();
    return (
      <div>
        <ul data-testid="sites">
          {sites.map((site) => (
            <li key={site.id}>
              {site.url}:{site.credential.health.searchConsole.state}
            </li>
          ))}
        </ul>
        {sites[0] && (
          <>
            <button
              type="button"
              onClick={(event) => disconnectSite(event, sites[0].id)}
            >
              disconnect-first
            </button>
            <button
              type="button"
              onClick={(event) => recheckSite(event, sites[0].id)}
            >
              recheck-first
            </button>
          </>
        )}
      </div>
    );
  }

  it("disconnectSite POSTs to disconnect_google_account with confirm:true and refetches the list", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            count: 1,
            sites: [
              {
                id: 1,
                url: "https://a.com",
                label: null,
                createdAt: "2026-01-01T00:00:00.000Z",
                credential: HEALTHY_CREDENTIAL,
              },
            ],
          },
          cacheStatus: "bypass",
          resultAge: 0,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: { siteId: 1, disconnected: true },
          cacheStatus: "bypass",
          resultAge: 0,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            count: 1,
            sites: [
              {
                id: 1,
                url: "https://a.com",
                label: null,
                createdAt: "2026-01-01T00:00:00.000Z",
                credential: {
                  tier: "global",
                  accountLabel: null,
                  accountKey: "global",
                  health: {
                    searchConsole: { state: "unchecked" },
                    googleAds: { state: "unchecked" },
                  },
                },
              },
            ],
          },
          cacheStatus: "bypass",
          resultAge: 0,
        }),
      );
    const user = userEvent.setup();

    render(
      <SiteProvider>
        <ActionsConsumer />
      </SiteProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("sites").textContent).toContain("healthy"),
    );

    await user.click(screen.getByRole("button", { name: "disconnect-first" }));

    await waitFor(() =>
      expect(screen.getByTestId("sites").textContent).toContain("unchecked"),
    );
    const disconnectCall = vi
      .mocked(global.fetch)
      .mock.calls.find(
        ([u]) => String(u) === "/api/tools/disconnect_google_account",
      );
    expect(disconnectCall).toBeDefined();
    expect(disconnectCall![1]).toMatchObject({ method: "POST" });
    const body = JSON.parse(String((disconnectCall![1] as RequestInit).body));
    expect(body).toMatchObject({ siteId: 1, confirm: true });
  });

  it("recheckSite POSTs to check_site_credentials with forceRecheck:true and refetches the list", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            count: 1,
            sites: [
              {
                id: 1,
                url: "https://a.com",
                label: null,
                createdAt: "2026-01-01T00:00:00.000Z",
                credential: UNHEALTHY_CREDENTIAL,
              },
            ],
          },
          cacheStatus: "bypass",
          resultAge: 0,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: { siteId: 1, ...HEALTHY_CREDENTIAL },
          cacheStatus: "bypass",
          resultAge: 0,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            count: 1,
            sites: [
              {
                id: 1,
                url: "https://a.com",
                label: null,
                createdAt: "2026-01-01T00:00:00.000Z",
                credential: HEALTHY_CREDENTIAL,
              },
            ],
          },
          cacheStatus: "bypass",
          resultAge: 0,
        }),
      );
    const user = userEvent.setup();

    render(
      <SiteProvider>
        <ActionsConsumer />
      </SiteProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("sites").textContent).toContain("unhealthy"),
    );

    await user.click(screen.getByRole("button", { name: "recheck-first" }));

    await waitFor(() =>
      expect(screen.getByTestId("sites").textContent).toContain(":healthy"),
    );
    const recheckCall = vi
      .mocked(global.fetch)
      .mock.calls.find(
        ([u]) => String(u) === "/api/tools/check_site_credentials",
      );
    expect(recheckCall).toBeDefined();
    const body = JSON.parse(String((recheckCall![1] as RequestInit).body));
    expect(body).toMatchObject({ siteId: 1, forceRecheck: true });
  });
});
