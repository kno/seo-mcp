import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProbeRow } from "./ProbeRow";

describe("ProbeRow", () => {
  it("shows the broken indicator together with the HTTP status code", () => {
    render(
      <ProbeRow
        probe={{
          url: "https://example.com/dead",
          state: "broken",
          status: 404,
        }}
      />,
    );

    expect(screen.getByText("https://example.com/dead")).toBeInTheDocument();
    expect(screen.getByTestId("badge-broken")).toBeInTheDocument();
    expect(screen.getByText("404")).toBeInTheDocument();
    // A broken probe must never render the error-reason presentation.
    expect(screen.queryByTestId("badge-error")).not.toBeInTheDocument();
  });

  it("shows the distinct error indicator together with the error reason, never a status code", () => {
    render(
      <ProbeRow
        probe={{
          url: "https://example.com/unreachable",
          state: "error",
          error: "Link probe timed out",
        }}
      />,
    );

    expect(
      screen.getByText("https://example.com/unreachable"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("badge-error")).toBeInTheDocument();
    expect(screen.getByText("Link probe timed out")).toBeInTheDocument();
    // An error probe must never be presented as a `broken` (HTTP status) result.
    expect(screen.queryByTestId("badge-broken")).not.toBeInTheDocument();
  });

  it("shows the ok indicator for a successful probe, distinct from broken and error", () => {
    render(
      <ProbeRow
        probe={{ url: "https://example.com/fine", state: "ok", status: 200 }}
      />,
    );

    expect(screen.getByTestId("badge-info")).toBeInTheDocument();
    expect(screen.queryByTestId("badge-broken")).not.toBeInTheDocument();
    expect(screen.queryByTestId("badge-error")).not.toBeInTheDocument();
  });
});
