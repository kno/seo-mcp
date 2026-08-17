import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SiteProvider } from "../app/SiteContext";
import { ManageDomainsContainer } from "./ManageDomainsContainer";

function jsonResponse(body: unknown): Response {
  return { json: () => Promise.resolve(body) } as Response;
}

function renderWithProvider() {
  return render(
    <SiteProvider>
      <ManageDomainsContainer />
    </SiteProvider>,
  );
}

const HEALTHY_SITE_CREDENTIAL = {
  tier: "site" as const,
  accountLabel: "owner@example.com",
  accountKey: "abc123",
  health: {
    searchConsole: { state: "healthy" as const },
    googleAds: { state: "healthy" as const },
  },
};

const UNHEALTHY_SITE_CREDENTIAL = {
  tier: "site" as const,
  accountLabel: "owner@example.com",
  accountKey: "abc123",
  health: {
    searchConsole: {
      state: "unhealthy" as const,
      reason: "refresh token revoked",
    },
    googleAds: { state: "unhealthy" as const },
  },
};

const NOT_CONNECTED_CREDENTIAL = {
  tier: "none" as const,
  accountLabel: null,
  accountKey: null,
  health: {
    searchConsole: { state: "not_connected" as const },
    googleAds: { state: "not_connected" as const },
  },
};

describe("ManageDomainsContainer", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
    window.localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    window.localStorage.clear();
  });

  it("shows an empty state when there are no domains yet", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({
        data: { count: 0, sites: [] },
        cacheStatus: "bypass",
        resultAge: 0,
      }),
    );

    renderWithProvider();

    await waitFor(() =>
      expect(screen.getByTestId("manage-domains-empty")).toBeInTheDocument(),
    );
  });

  it("lists domains from the site context", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({
        data: {
          count: 1,
          sites: [
            {
              id: 1,
              url: "https://example.com",
              label: "Main",
              createdAt: "2026-01-01T00:00:00.000Z",
              credential: NOT_CONNECTED_CREDENTIAL,
            },
          ],
        },
        cacheStatus: "bypass",
        resultAge: 0,
      }),
    );

    renderWithProvider();

    await waitFor(() =>
      expect(screen.getByText("https://example.com")).toBeInTheDocument(),
    );
    expect(screen.getByText("Main")).toBeInTheDocument();
  });

  it("adds a domain via the form and clears the fields on success", async () => {
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
              label: null,
              createdAt: "2026-01-01T00:00:00.000Z",
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
                label: null,
                createdAt: "2026-01-01T00:00:00.000Z",
                credential: NOT_CONNECTED_CREDENTIAL,
              },
            ],
          },
          cacheStatus: "bypass",
          resultAge: 0,
        }),
      );
    const user = userEvent.setup();

    renderWithProvider();
    await waitFor(() =>
      expect(screen.getByTestId("manage-domains-empty")).toBeInTheDocument(),
    );

    await user.type(screen.getByLabelText("Domain URL"), "https://new.com");
    await user.click(screen.getByRole("button", { name: "Add domain" }));

    await waitFor(() =>
      expect(screen.getByText("https://new.com")).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Domain URL")).toHaveValue("");
  });

  it("requires a second click on the SAME row to actually delete a domain (two-click confirm)", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            count: 1,
            sites: [
              {
                id: 1,
                url: "https://example.com",
                label: null,
                createdAt: "2026-01-01T00:00:00.000Z",
                credential: NOT_CONNECTED_CREDENTIAL,
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

    renderWithProvider();
    await waitFor(() =>
      expect(screen.getByText("https://example.com")).toBeInTheDocument(),
    );

    const deleteButton = screen.getByRole("button", {
      name: "Delete https://example.com",
    });
    await user.click(deleteButton);
    expect(deleteButton).toHaveTextContent("Confirm delete?");

    const deleteCallsBefore = vi
      .mocked(global.fetch)
      .mock.calls.filter(
        ([u]) => String(u) === "/api/tools/delete_site",
      ).length;
    expect(deleteCallsBefore).toBe(0);

    await user.click(deleteButton);

    await waitFor(() =>
      expect(screen.getByTestId("manage-domains-empty")).toBeInTheDocument(),
    );
    const deleteCallsAfter = vi
      .mocked(global.fetch)
      .mock.calls.filter(
        ([u]) => String(u) === "/api/tools/delete_site",
      ).length;
    expect(deleteCallsAfter).toBe(1);
  });

  describe("status column (task 6.1 — tier and health are two distinct elements)", () => {
    it("renders connection tier and health as two separate elements with distinct accessible names for a healthy connected site", async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        jsonResponse({
          data: {
            count: 1,
            sites: [
              {
                id: 1,
                url: "https://healthy.com",
                label: null,
                createdAt: "2026-01-01T00:00:00.000Z",
                credential: HEALTHY_SITE_CREDENTIAL,
              },
            ],
          },
          cacheStatus: "bypass",
          resultAge: 0,
        }),
      );

      renderWithProvider();
      await waitFor(() =>
        expect(screen.getByText("https://healthy.com")).toBeInTheDocument(),
      );

      const tier = screen.getByTestId("tier-1");
      const health = screen.getByTestId("health-1");
      expect(tier).not.toBe(health);
      expect(tier.getAttribute("aria-label")).not.toEqual(
        health.getAttribute("aria-label"),
      );
      expect(tier.textContent).toBe("Connected");
      expect(health.textContent).toBe("Healthy");
    });

    it("renders a connected-but-unhealthy site distinctly from both healthy-connected and never-connected", async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        jsonResponse({
          data: {
            count: 2,
            sites: [
              {
                id: 1,
                url: "https://unhealthy.com",
                label: null,
                createdAt: "2026-01-01T00:00:00.000Z",
                credential: UNHEALTHY_SITE_CREDENTIAL,
              },
              {
                id: 2,
                url: "https://never-connected.com",
                label: null,
                createdAt: "2026-01-01T00:00:00.000Z",
                credential: NOT_CONNECTED_CREDENTIAL,
              },
            ],
          },
          cacheStatus: "bypass",
          resultAge: 0,
        }),
      );

      renderWithProvider();
      await waitFor(() =>
        expect(screen.getByText("https://unhealthy.com")).toBeInTheDocument(),
      );

      const unhealthyHealth = screen.getByTestId("health-1");
      const neverConnectedHealth = screen.getByTestId("health-2");
      const neverConnectedTier = screen.getByTestId("tier-2");

      expect(unhealthyHealth.textContent).toContain("Unhealthy");
      expect(unhealthyHealth.textContent).not.toBe(
        neverConnectedHealth.textContent,
      );
      // "unhealthy" tier is still "Connected" — distinct from "not connected".
      expect(screen.getByTestId("tier-1").textContent).toBe("Connected");
      expect(neverConnectedTier.textContent).toBe("Not connected");
    });
  });

  describe("Connect/Disconnect/Recheck actions (task 6.2/6.3)", () => {
    it("renders a plain navigation link to the OAuth authorize route for a not-yet-connected site", async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        jsonResponse({
          data: {
            count: 1,
            sites: [
              {
                id: 7,
                url: "https://connect-me.com",
                label: null,
                createdAt: "2026-01-01T00:00:00.000Z",
                credential: NOT_CONNECTED_CREDENTIAL,
              },
            ],
          },
          cacheStatus: "bypass",
          resultAge: 0,
        }),
      );

      renderWithProvider();
      await waitFor(() =>
        expect(screen.getByText("https://connect-me.com")).toBeInTheDocument(),
      );

      const connectLink = screen.getByRole("link", {
        name: "Connect Google account for https://connect-me.com",
      });
      expect(connectLink).toHaveAttribute(
        "href",
        "/auth/google/authorize?siteId=7",
      );
    });

    it("requires a second click on the SAME row to disconnect (two-click confirm, independent of delete)", async () => {
      vi.mocked(global.fetch)
        .mockResolvedValueOnce(
          jsonResponse({
            data: {
              count: 1,
              sites: [
                {
                  id: 1,
                  url: "https://connected.com",
                  label: null,
                  createdAt: "2026-01-01T00:00:00.000Z",
                  credential: HEALTHY_SITE_CREDENTIAL,
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
                  url: "https://connected.com",
                  label: null,
                  createdAt: "2026-01-01T00:00:00.000Z",
                  credential: NOT_CONNECTED_CREDENTIAL,
                },
              ],
            },
            cacheStatus: "bypass",
            resultAge: 0,
          }),
        );
      const user = userEvent.setup();

      renderWithProvider();
      await waitFor(() =>
        expect(screen.getByText("https://connected.com")).toBeInTheDocument(),
      );

      const disconnectButton = screen.getByRole("button", {
        name: "Disconnect Google account for https://connected.com",
      });
      await user.click(disconnectButton);
      expect(disconnectButton).toHaveTextContent("Confirm disconnect?");

      const disconnectCallsBefore = vi
        .mocked(global.fetch)
        .mock.calls.filter(
          ([u]) => String(u) === "/api/tools/disconnect_google_account",
        ).length;
      expect(disconnectCallsBefore).toBe(0);

      await user.click(disconnectButton);

      await waitFor(() => {
        const disconnectCallsAfter = vi
          .mocked(global.fetch)
          .mock.calls.filter(
            ([u]) => String(u) === "/api/tools/disconnect_google_account",
          ).length;
        expect(disconnectCallsAfter).toBe(1);
      });

      // The disconnect route call must be a POST with the confirm gate,
      // mirroring delete_site's own contract.
      const disconnectCall = vi
        .mocked(global.fetch)
        .mock.calls.find(
          ([u]) => String(u) === "/api/tools/disconnect_google_account",
        );
      expect(disconnectCall![1]).toMatchObject({ method: "POST" });
    });

    it("arming Disconnect on one row does not arm Delete on the same row, and disconnecting a different row clears the first row's pending disconnect", async () => {
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
                credential: HEALTHY_SITE_CREDENTIAL,
              },
              {
                id: 2,
                url: "https://b.com",
                label: null,
                createdAt: "2026-01-01T00:00:00.000Z",
                credential: HEALTHY_SITE_CREDENTIAL,
              },
            ],
          },
          cacheStatus: "bypass",
          resultAge: 0,
        }),
      );
      const user = userEvent.setup();

      renderWithProvider();
      await waitFor(() =>
        expect(screen.getByText("https://a.com")).toBeInTheDocument(),
      );

      const disconnectA = screen.getByRole("button", {
        name: "Disconnect Google account for https://a.com",
      });
      const deleteA = screen.getByRole("button", {
        name: "Delete https://a.com",
      });
      await user.click(disconnectA);
      expect(disconnectA).toHaveTextContent("Confirm disconnect?");
      // Arming Disconnect on row A must not also arm Delete on row A — the
      // two actions track independent pending state.
      expect(deleteA).toHaveTextContent("Delete");

      const disconnectB = screen.getByRole("button", {
        name: "Disconnect Google account for https://b.com",
      });
      await user.click(disconnectB);
      expect(disconnectB).toHaveTextContent("Confirm disconnect?");
      // Arming row B's disconnect must clear row A's pending disconnect —
      // the same reset-on-different-row behavior Delete already has.
      expect(disconnectA).toHaveTextContent("Disconnect");
    });

    it("Recheck forces a fresh probe and never shows any 'cached' wording", async () => {
      vi.mocked(global.fetch)
        .mockResolvedValueOnce(
          jsonResponse({
            data: {
              count: 1,
              sites: [
                {
                  id: 1,
                  url: "https://unhealthy.com",
                  label: null,
                  createdAt: "2026-01-01T00:00:00.000Z",
                  credential: UNHEALTHY_SITE_CREDENTIAL,
                },
              ],
            },
            cacheStatus: "bypass",
            resultAge: 0,
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            data: { siteId: 1, ...HEALTHY_SITE_CREDENTIAL },
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
                  url: "https://unhealthy.com",
                  label: null,
                  createdAt: "2026-01-01T00:00:00.000Z",
                  credential: HEALTHY_SITE_CREDENTIAL,
                },
              ],
            },
            cacheStatus: "bypass",
            resultAge: 0,
          }),
        );
      const user = userEvent.setup();

      renderWithProvider();
      await waitFor(() =>
        expect(screen.getByText("https://unhealthy.com")).toBeInTheDocument(),
      );

      const recheckButton = screen.getByRole("button", {
        name: "Recheck connection for https://unhealthy.com",
      });
      expect(recheckButton.textContent).not.toMatch(/cached/i);
      await user.click(recheckButton);

      await waitFor(() =>
        expect(screen.getByTestId("health-1").textContent).toBe("Healthy"),
      );

      const recheckCall = vi
        .mocked(global.fetch)
        .mock.calls.find(
          ([u]) => String(u) === "/api/tools/check_site_credentials",
        );
      expect(recheckCall).toBeDefined();
      expect(recheckCall![1]).toMatchObject({ method: "POST" });
      const body = JSON.parse(String((recheckCall![1] as RequestInit).body));
      expect(body.forceRecheck).toBe(true);
    });
  });
});
