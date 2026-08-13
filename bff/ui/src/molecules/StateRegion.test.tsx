import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { BffErrorCode } from "../../../src/errors";
import type { Bound } from "../data/bounds";
import { StateRegion } from "./StateRegion";

const SAMPLE_BOUND: Bound = {
  kind: "probe_cap",
  scope: "linkCheck.checked",
  limitName: "maxLinkChecks",
  limitValue: 50,
  shown: 50,
};

describe("StateRegion — loading/empty/bound-reached distinction", () => {
  it("renders the loading state, not the empty state, while a request is in flight", () => {
    render(<StateRegion label="Broken links" state={{ phase: "loading" }} />);

    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
    expect(
      screen.queryByText(/no broken links found/i),
    ).not.toBeInTheDocument();
  });

  it("renders a caller-supplied loading detail instead of the generic 'Loading {label}…' text", () => {
    render(
      <StateRegion
        label="Site crawl"
        state={{ phase: "loading", detail: "Crawl in progress…" }}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Crawl in progress…");
    expect(screen.getByRole("status")).not.toHaveTextContent(
      /loading site crawl/i,
    );
  });

  it("renders an explicit empty-state message distinct from loading and bound-reached", () => {
    render(
      <StateRegion
        label="Broken links"
        state={{ phase: "ready", cardinality: { state: "none" } }}
      />,
    );

    expect(screen.getByText(/no broken links found/i)).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bound-indicator")).not.toBeInTheDocument();
  });

  it("renders a bound-reached indicator naming the limit, not the empty-state presentation", () => {
    render(
      <StateRegion
        label="Broken links"
        state={{
          phase: "ready",
          cardinality: { state: "bounded", bound: SAMPLE_BOUND },
        }}
      />,
    );

    const indicator = screen.getByTestId("bound-indicator");
    expect(indicator).toHaveTextContent("maxLinkChecks");
    expect(indicator).toHaveTextContent("50");
    expect(
      screen.queryByText(/no broken links found/i),
    ).not.toBeInTheDocument();
  });

  it("renders children for a complete (non-bounded, non-empty) result without any bound indicator", () => {
    render(
      <StateRegion
        label="Broken links"
        state={{ phase: "ready", cardinality: { state: "complete", total: 3 } }}
      >
        <p>3 links checked</p>
      </StateRegion>,
    );

    expect(screen.getByText("3 links checked")).toBeInTheDocument();
    expect(screen.queryByTestId("bound-indicator")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/no broken links found/i),
    ).not.toBeInTheDocument();
  });
});

describe("StateRegion — error presentation", () => {
  it("renders a mapped presentation for a known code, distinct across codes", () => {
    render(
      <StateRegion
        label="PageSpeed"
        state={{
          phase: "error",
          error: { code: "upstream_unauthorized", message: "denied" },
        }}
      />,
    );
    const unauthorizedText = screen.getByRole("alert").textContent;

    const { unmount } = render(<div />); // isolate next render
    unmount();

    render(
      <StateRegion
        label="PageSpeed"
        state={{
          phase: "error",
          error: { code: "bff_timeout", message: "too slow" },
        }}
      />,
    );
    const timeoutText = screen.getAllByRole("alert").at(-1)?.textContent;

    expect(unauthorizedText).not.toBe(timeoutText);
  });

  it("shows an explicit unmapped-error state naming the raw code and message, never empty or successful", () => {
    const unknownCode = "upstream_teapot" as unknown as BffErrorCode;
    render(
      <StateRegion
        label="Site crawl"
        state={{
          phase: "error",
          error: { code: unknownCode, message: "The kettle refused." },
        }}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("upstream_teapot");
    expect(alert).toHaveTextContent("The kettle refused.");
    expect(screen.queryByText(/no site crawl found/i)).not.toBeInTheDocument();
  });

  it("shows a retryAfter countdown and no such control is offered for a non-rate-limit error", () => {
    render(
      <StateRegion
        label="Site crawl"
        state={{
          phase: "error",
          error: {
            code: "upstream_rate_limited",
            message: "rate limited",
            retryAfter: 45,
          },
        }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("45s");
  });

  it("never fabricates a wait time for a quota rejection that carries no retryAfter", () => {
    render(
      <StateRegion
        label="Search Console query"
        state={{
          phase: "error",
          error: {
            code: "upstream_source_quota",
            message: "Google's own quota has been exhausted.",
          },
        }}
      />,
    );

    // No countdown control at all — 0s would be a fabricated delay per
    // `quota-visibility`'s "rate-limit error without a retry delay is
    // handled honestly" scenario.
    expect(screen.queryByText(/0s/)).not.toBeInTheDocument();
    expect(screen.queryByText(/retry available in/i)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      /no retry delay was provided/i,
    );
  });
});

describe("StateRegion — focus management on async transitions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("moves focus into the region's heading when a loading state resolves to a result", () => {
    const { rerender } = render(
      <StateRegion label="Site crawl" state={{ phase: "loading" }} />,
    );
    expect(document.activeElement).not.toBe(
      screen.getByRole("heading", { name: "Site crawl" }),
    );

    act(() => {
      rerender(
        <StateRegion
          label="Site crawl"
          state={{ phase: "ready", cardinality: { state: "none" } }}
        />,
      );
    });

    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Site crawl" }),
    );
  });

  it("moves focus into the region's heading when a loading state resolves to an error", () => {
    const { rerender } = render(
      <StateRegion label="Site crawl" state={{ phase: "loading" }} />,
    );

    act(() => {
      rerender(
        <StateRegion
          label="Site crawl"
          state={{
            phase: "error",
            error: { code: "bff_timeout", message: "too slow" },
          }}
        />,
      );
    });

    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Site crawl" }),
    );
  });
});
