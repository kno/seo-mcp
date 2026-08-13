import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { OpportunitiesTable } from "./OpportunitiesTable";

describe("OpportunitiesTable", () => {
  it("lists an opportunity with both savings fields", () => {
    render(
      <OpportunitiesTable
        opportunities={[
          {
            id: "unused-css",
            title: "Remove unused CSS",
            savingsMs: 300,
            savingsBytes: 5000,
          },
        ]}
      />,
    );
    expect(screen.getByText("Remove unused CSS")).toBeInTheDocument();
    expect(screen.getByTestId("savings-ms-unused-css")).toHaveTextContent(
      "300 ms",
    );
    expect(screen.getByTestId("savings-bytes-unused-css")).toHaveTextContent(
      "5000 bytes",
    );
  });

  it("still lists an opportunity with no savings fields, showing unavailable rather than 0", () => {
    render(
      <OpportunitiesTable
        opportunities={[
          { id: "font-display", title: "Ensure text remains visible" },
        ]}
      />,
    );
    expect(screen.getByText("Ensure text remains visible")).toBeInTheDocument();
    const msCell = screen.getByTestId("savings-ms-font-display");
    const bytesCell = screen.getByTestId("savings-bytes-font-display");
    expect(msCell.textContent).toMatch(/not present/i);
    expect(bytesCell.textContent).toMatch(/not present/i);
    expect(msCell.textContent).not.toContain("0 ms");
    expect(bytesCell.textContent).not.toContain("0 bytes");
  });

  it("renders no rows when there are no opportunities", () => {
    render(<OpportunitiesTable opportunities={[]} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
