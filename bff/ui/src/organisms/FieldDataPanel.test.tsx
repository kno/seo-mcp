import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FieldDataPanel } from "./FieldDataPanel";

describe("FieldDataPanel", () => {
  it("displays the overall category and INP value when field data is present", () => {
    render(
      <FieldDataPanel
        fieldMetrics={{
          overallCategory: "FAST",
          interactionToNextPaintMs: 150,
        }}
      />,
    );
    expect(screen.getByText("FAST")).toBeInTheDocument();
    expect(screen.getByText(/150 ms/)).toBeInTheDocument();
  });

  it("displays an explicit no-field-data state when fieldMetrics is entirely absent", () => {
    render(<FieldDataPanel fieldMetrics={undefined} />);
    expect(screen.getByTestId("field-data-unavailable")).toHaveTextContent(
      /no field data/i,
    );
  });

  it("distinguishes a present-but-partial field data object from the entirely-absent case", () => {
    render(<FieldDataPanel fieldMetrics={{ overallCategory: "AVERAGE" }} />);
    expect(
      screen.queryByTestId("field-data-unavailable"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("AVERAGE")).toBeInTheDocument();
  });
});
