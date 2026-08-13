import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Spinner } from "./Spinner";

describe("Spinner", () => {
  it("is decorative and does not duplicate the accessible loading text of its container", () => {
    render(
      <p role="status">
        <Spinner />
        Loading results…
      </p>,
    );

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading results…");
    // The spinner itself carries no independent accessible name — the
    // surrounding text region is the single source of the loading
    // announcement, so a screen reader is not told "loading" twice.
    expect(status.querySelector("[aria-hidden='true']")).not.toBeNull();
  });
});
