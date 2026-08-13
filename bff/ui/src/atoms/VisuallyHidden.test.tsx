import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { VisuallyHidden } from "./VisuallyHidden";

describe("VisuallyHidden", () => {
  it("renders its children so assistive technology can read them", () => {
    render(<VisuallyHidden>Announced to screen readers only</VisuallyHidden>);
    expect(
      screen.getByText("Announced to screen readers only"),
    ).toBeInTheDocument();
  });
});
