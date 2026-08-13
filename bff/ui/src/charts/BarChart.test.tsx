import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BarChart } from "./BarChart";

describe("BarChart", () => {
  it("renders every item as a real, accessible table row in the result's own order", () => {
    render(
      <BarChart
        items={[
          { url: "https://example.com/a", inbound: 9 },
          { url: "https://example.com/b", inbound: 3 },
        ]}
      />,
    );

    const table = screen.getByRole("table");
    const rows = screen.getAllByRole("row");
    // header row + 2 data rows
    expect(rows).toHaveLength(3);
    expect(table).toHaveTextContent("https://example.com/a");
    expect(table).toHaveTextContent("9");
    expect(table).toHaveTextContent("https://example.com/b");
    expect(table).toHaveTextContent("3");

    const cells = screen.getAllByRole("cell");
    // First data row's URL must come before the second's (result order,
    // never re-sorted by inbound count).
    const firstUrlCellIndex = cells.findIndex((cell) =>
      cell.textContent?.includes("https://example.com/a"),
    );
    const secondUrlCellIndex = cells.findIndex((cell) =>
      cell.textContent?.includes("https://example.com/b"),
    );
    expect(firstUrlCellIndex).toBeLessThan(secondUrlCellIndex);
  });

  it("marks the decorative SVG bars aria-hidden so the table is the only accessible channel", () => {
    const { container } = render(
      <BarChart items={[{ url: "https://example.com/a", inbound: 9 }]} />,
    );
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("renders an explicit empty state for zero items", () => {
    render(<BarChart items={[]} />);
    expect(screen.getByText(/no linked pages/i)).toBeInTheDocument();
  });
});
