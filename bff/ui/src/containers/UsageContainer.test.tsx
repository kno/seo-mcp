import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UsageContainer } from "./UsageContainer";

const SNAPSHOT_BODY = {
  callCount: 7,
  windowSeconds: 3600,
  windowElapsedSeconds: 200,
  estimate: true,
  note: "This is the BFF's own observed upstream call volume, not an authoritative remaining count.",
};

function jsonResponse(body: unknown): Response {
  return { json: () => Promise.resolve(body) } as Response;
}

describe("UsageContainer", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(SNAPSHOT_BODY));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("calls the existing GET /api/usage route on mount", async () => {
    render(<UsageContainer />);
    expect(await screen.findByTestId("headroom-indicator")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/usage",
      expect.objectContaining({
        method: "GET",
      }),
    );
    // Never the tool route.
    const calledUrls = vi
      .mocked(global.fetch)
      .mock.calls.map((call) => String(call[0]));
    expect(calledUrls.every((url) => !url.startsWith("/api/tools/"))).toBe(
      true,
    );
  });

  it("renders the estimate/note fields, never an authoritative remaining count", async () => {
    render(<UsageContainer />);
    expect(await screen.findByText(/7 calls/)).toBeInTheDocument();
    expect(
      screen.getByText(
        /own observed upstream call volume, not an authoritative/i,
      ),
    ).toBeInTheDocument();
    // The headline figure itself never claims to be a remaining count.
    const headline = screen.getByText(/7 calls/).closest("p");
    expect(headline).not.toHaveTextContent(/remaining/i);
  });

  it("fetches again only on an explicit user action (the Refresh button), not on a timer", async () => {
    const user = userEvent.setup();
    render(<UsageContainer />);
    await screen.findByTestId("headroom-indicator");
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /refresh usage/i }));

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
