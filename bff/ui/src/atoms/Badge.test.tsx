import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./Badge";

describe("Badge", () => {
  it("renders its children with a variant-specific accessible marker", () => {
    render(<Badge variant="warning">Missing title</Badge>);
    expect(screen.getByText("Missing title")).toBeInTheDocument();
    expect(screen.getByTestId("badge-warning")).toBeInTheDocument();
  });

  it("renders visually distinct markers for warning, info, and unmapped variants", () => {
    render(
      <>
        <Badge variant="warning">Warning issue</Badge>
        <Badge variant="info">Info issue</Badge>
        <Badge variant="unmapped">Unmapped issue</Badge>
      </>,
    );

    const warning = screen.getByTestId("badge-warning");
    const info = screen.getByTestId("badge-info");
    const unmapped = screen.getByTestId("badge-unmapped");

    expect(warning.dataset.variant).toBe("warning");
    expect(info.dataset.variant).toBe("info");
    expect(unmapped.dataset.variant).toBe("unmapped");
  });
});
