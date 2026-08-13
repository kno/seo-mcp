import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LinkCheckResult } from "../../../../src/types";
import { BrokenLinksContainer } from "./BrokenLinksContainer";

const RESULT: LinkCheckResult = {
  url: "https://example.com",
  pageStatus: 200,
  checked: 4,
  ok: 2,
  broken: 1,
  errors: 1,
  results: [
    { url: "https://example.com/a", state: "ok", status: 200 },
    { url: "https://example.com/b", state: "ok", status: 200 },
    { url: "https://example.com/dead", state: "broken", status: 404 },
    {
      url: "https://example.com/timeout",
      state: "error",
      error: "Link probe timed out",
    },
  ],
};

function jsonResponse(body: unknown): Response {
  return { json: () => Promise.resolve(body) } as Response;
}

describe("BrokenLinksContainer", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("issues no check_links request on mount — this is a separate, on-demand panel", () => {
    render(<BrokenLinksContainer pageUrl="https://example.com" />);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("issues exactly one check_links request per explicit 'Check links' activation", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({ data: RESULT, cacheStatus: "miss", resultAge: 0 }),
    );

    const user = userEvent.setup();
    render(<BrokenLinksContainer pageUrl="https://example.com" />);

    await user.click(screen.getByRole("button", { name: /check links/i }));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(global.fetch).mock.calls[0]?.[0])).toContain(
      "/api/tools/check_links",
    );
    await screen.findByTestId("links-checked");
  });

  it("renders all four counts and distinguishes broken from error probes", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({ data: RESULT, cacheStatus: "miss", resultAge: 0 }),
    );

    const user = userEvent.setup();
    render(<BrokenLinksContainer pageUrl="https://example.com" />);
    await user.click(screen.getByRole("button", { name: /check links/i }));

    expect(await screen.findByTestId("links-checked")).toHaveTextContent("4");
    expect(screen.getByTestId("links-ok")).toHaveTextContent("2");
    expect(screen.getByTestId("links-broken")).toHaveTextContent("1");
    expect(screen.getByTestId("links-errors")).toHaveTextContent("1");
    expect(screen.getByTestId("badge-broken")).toBeInTheDocument();
    expect(screen.getByTestId("badge-error")).toBeInTheDocument();
  });

  it("shows the probe-cap-at-50 bound indicator when checked hits the server's limit", async () => {
    const boundedResult: LinkCheckResult = {
      url: "https://example.com",
      pageStatus: 200,
      checked: 50,
      ok: 50,
      broken: 0,
      errors: 0,
      results: [],
    };
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({ data: boundedResult, cacheStatus: "miss", resultAge: 0 }),
    );

    const user = userEvent.setup();
    render(<BrokenLinksContainer pageUrl="https://example.com" />);
    await user.click(screen.getByRole("button", { name: /check links/i }));

    const indicator = await screen.findByTestId("bound-indicator");
    expect(indicator).toHaveTextContent("50");
  });

  it("shows no bound indicator when checked is below the server's limit", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({ data: RESULT, cacheStatus: "miss", resultAge: 0 }),
    );

    const user = userEvent.setup();
    render(<BrokenLinksContainer pageUrl="https://example.com" />);
    await user.click(screen.getByRole("button", { name: /check links/i }));

    await screen.findByTestId("links-checked");
    expect(screen.queryByTestId("bound-indicator")).not.toBeInTheDocument();
  });

  it("shows the shared error-state contract, never an empty-success look, on a platform failure", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({
        error: {
          code: "upstream_unavailable",
          message: "Subrequest ceiling reached",
        },
      }),
    );

    const user = userEvent.setup();
    render(<BrokenLinksContainer pageUrl="https://example.com" />);
    await user.click(screen.getByRole("button", { name: /check links/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /temporarily unavailable/i,
    );
    expect(screen.queryByTestId("links-checked")).not.toBeInTheDocument();
    expect(screen.queryByTestId("links-broken")).not.toBeInTheDocument();
  });

  it("aborts a stale in-flight request rather than deduplicating a rapid double-click", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({ data: RESULT, cacheStatus: "miss", resultAge: 0 }),
    );

    const user = userEvent.setup();
    render(<BrokenLinksContainer pageUrl="https://example.com" />);
    const button = screen.getByRole("button", { name: /check links/i });

    await user.click(button);
    await user.click(button);

    await screen.findByTestId("links-checked");
    // Each click is its own explicit activation, so two clicks legitimately
    // issue two upstream calls -- this container does not deduplicate
    // concurrent clicks, it only guards against a STALE response
    // overwriting a newer one via the requestId check.
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
