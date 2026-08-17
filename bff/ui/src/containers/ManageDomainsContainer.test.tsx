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
});
