import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginContainer } from "./LoginContainer";
import { SiteProvider } from "../app/SiteContext";

describe("LoginContainer", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("posts the entered secret as a JSON body to /auth/session, not a query string", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    const user = userEvent.setup();
    render(<LoginContainer />);

    await user.type(screen.getByLabelText(/access secret/i), "top-secret");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(global.fetch).toHaveBeenCalledWith(
      "/auth/session",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ secret: "top-secret" }),
      }),
    );
  });

  it("shows a signed-in confirmation on success and never echoes the secret back", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    const user = userEvent.setup();
    render(<LoginContainer />);

    await user.type(screen.getByLabelText(/access secret/i), "top-secret");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByTestId("session-status")).toHaveTextContent(
      /signed in/i,
    );
    expect(screen.queryByText("top-secret")).not.toBeInTheDocument();
  });

  it("shows an incorrect-secret message on a 401, and the form remains usable to retry", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "gate_unauthorized" } }), {
        status: 401,
      }),
    );
    const user = userEvent.setup();
    render(<LoginContainer />);

    await user.type(screen.getByLabelText(/access secret/i), "wrong");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /incorrect secret/i,
    );
    expect(screen.getByRole("button", { name: /sign in/i })).toBeEnabled();
  });

  it("re-fetches list_sites after a successful login, so SiteContext's mount-time 401 (it always fires before the user has signed in) recovers without a page reload", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: "gate_unauthorized" } }), {
          status: 401,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              count: 1,
              sites: [
                {
                  id: 1,
                  url: "https://a.com",
                  label: null,
                  createdAt: "2026-01-01T00:00:00.000Z",
                },
              ],
            },
            cacheStatus: "bypass",
            resultAge: 0,
          }),
          { status: 200 },
        ),
      );
    const user = userEvent.setup();

    render(
      <SiteProvider>
        <LoginContainer />
      </SiteProvider>,
    );

    await user.type(screen.getByLabelText(/access secret/i), "top-secret");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByTestId("session-status")).toHaveTextContent(
      /signed in/i,
    );

    await waitFor(() => {
      const listSitesCalls = vi
        .mocked(global.fetch)
        .mock.calls.filter(([url]) => String(url) === "/api/tools/list_sites");
      expect(listSitesCalls).toHaveLength(2);
    });
  });
});
