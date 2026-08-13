import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginContainer } from "./LoginContainer";

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
});
