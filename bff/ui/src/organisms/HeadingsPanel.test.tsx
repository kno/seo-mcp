import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { HeadingsPanel } from "./HeadingsPanel";

describe("HeadingsPanel", () => {
  it("lists multiple H1 headings, all visible and distinguishable from H2/H3", () => {
    render(
      <HeadingsPanel
        h1={["First H1", "Second H1"]}
        h2={["Only H2"]}
        h3={[]}
        internalLinks={0}
        externalLinks={0}
      />,
    );

    const h1Group = within(screen.getByTestId("headings-h1"));
    expect(h1Group.getByText("First H1")).toBeInTheDocument();
    expect(h1Group.getByText("Second H1")).toBeInTheDocument();

    const h2Group = within(screen.getByTestId("headings-h2"));
    expect(h2Group.getByText("Only H2")).toBeInTheDocument();
    expect(h2Group.queryByText("First H1")).not.toBeInTheDocument();
  });

  it("shows internal and external link counts as two separate figures, never a combined total", () => {
    render(
      <HeadingsPanel
        h1={[]}
        h2={[]}
        h3={[]}
        internalLinks={12}
        externalLinks={3}
      />,
    );

    expect(screen.getByTestId("headings-internal-links")).toHaveTextContent(
      "12",
    );
    expect(screen.getByTestId("headings-external-links")).toHaveTextContent(
      "3",
    );
    expect(screen.queryByText("15")).not.toBeInTheDocument();
  });
});
