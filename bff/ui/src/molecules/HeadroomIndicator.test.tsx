import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { UsageSnapshot } from "../../../src/usage";
import { HeadroomIndicator } from "./HeadroomIndicator";

const SNAPSHOT: UsageSnapshot = {
  callCount: 12,
  windowSeconds: 3600,
  windowElapsedSeconds: 900,
  estimate: true,
  note: "This is the BFF's own observed upstream call volume, not an authoritative remaining count.",
};

describe("HeadroomIndicator", () => {
  it("is visible without opening devtools", () => {
    render(<HeadroomIndicator snapshot={SNAPSHOT} />);
    expect(screen.getByTestId("headroom-indicator")).toBeVisible();
    expect(screen.getByText(/12 calls/)).toBeVisible();
  });

  it("labels the primary figure as an estimate, never an authoritative remaining count", () => {
    render(<HeadroomIndicator snapshot={SNAPSHOT} />);
    // The headline figure (outside the expandable explanation) must call
    // itself an estimate and must not claim to be a "remaining" count.
    const headline = screen.getByText(/12 calls/).closest("p");
    expect(headline).toHaveTextContent(/estimate/i);
    expect(headline).not.toHaveTextContent(/remaining/i);
  });

  it("makes the estimate's limitation discoverable via the BFF's own note text", () => {
    render(<HeadroomIndicator snapshot={SNAPSHOT} />);
    expect(
      screen.getByText(
        /own observed upstream call volume, not an authoritative/i,
      ),
    ).toBeInTheDocument();
  });

  it("renders the exact note the backend supplied, never a UI-authored substitute", () => {
    const distinctiveSnapshot: UsageSnapshot = {
      ...SNAPSHOT,
      note: "A distinctive note value",
    };
    render(<HeadroomIndicator snapshot={distinctiveSnapshot} />);
    expect(screen.getByText("A distinctive note value")).toBeInTheDocument();
  });
});
