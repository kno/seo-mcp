import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Absent } from "./Absent";

describe("Absent", () => {
  it("renders an explicit not-present indicator, not an empty string", () => {
    render(<Absent />);
    expect(screen.getByText(/not present/i)).toBeInTheDocument();
  });

  it("never renders a fabricated value — its text content is fixed regardless of props", () => {
    const { container: withoutLabel } = render(<Absent />);
    const { container: withLabel } = render(<Absent label="canonical" />);

    expect(withoutLabel.textContent).not.toBe("");
    expect(withLabel.textContent).toMatch(/not present/i);
  });
});
