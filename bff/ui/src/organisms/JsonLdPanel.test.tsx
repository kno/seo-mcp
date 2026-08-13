import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { JsonLdPanel } from "./JsonLdPanel";

describe("JsonLdPanel", () => {
  it("shows an explicit 'no JSON-LD present' state when there are zero blocks", () => {
    render(<JsonLdPanel jsonLd={{ blocks: 0, types: [], invalid: 0 }} />);

    expect(screen.getByText(/no json-ld present/i)).toBeInTheDocument();
  });

  it("flags an invalid block distinctly and does not report it as a valid type", () => {
    render(
      <JsonLdPanel jsonLd={{ blocks: 2, types: ["Article"], invalid: 1 }} />,
    );

    expect(screen.getByTestId("jsonld-invalid")).toHaveTextContent("1");
    expect(screen.getByText("Article")).toBeInTheDocument();
    expect(screen.queryByText(/no json-ld present/i)).not.toBeInTheDocument();
    // Exactly one valid, typed block must be reported — never two.
    expect(screen.getAllByText("Article")).toHaveLength(1);
  });

  it("shows no invalid-block flag when every block is valid", () => {
    render(
      <JsonLdPanel jsonLd={{ blocks: 1, types: ["Product"], invalid: 0 }} />,
    );

    expect(screen.queryByTestId("jsonld-invalid")).not.toBeInTheDocument();
    expect(screen.getByText("Product")).toBeInTheDocument();
  });
});
