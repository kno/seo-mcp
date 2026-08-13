import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { OnPageCard } from "./OnPageCard";

describe("OnPageCard", () => {
  it("renders every field's actual value when all fields are present", () => {
    render(
      <OnPageCard
        title="Example page"
        description="An example description"
        canonical="https://example.com/canonical"
        robots="index,follow"
        lang="en"
        indexable
      />,
    );

    expect(screen.getByText("Example page")).toBeInTheDocument();
    expect(screen.getByText("An example description")).toBeInTheDocument();
    expect(
      screen.getByText("https://example.com/canonical"),
    ).toBeInTheDocument();
    expect(screen.getByText("index,follow")).toBeInTheDocument();
    expect(screen.getByText("en")).toBeInTheDocument();
  });

  it("shows an explicit not-present indicator for an absent canonical, not a blank cell or a fabricated URL", () => {
    render(
      <OnPageCard
        title="Example page"
        description="An example description"
        canonical={undefined}
        robots="index,follow"
        lang="en"
        indexable
      />,
    );

    expect(screen.getByTestId("onpage-canonical")).toHaveTextContent(
      /not present/i,
    );
    expect(screen.getByTestId("onpage-canonical")).not.toHaveTextContent(
      /^https?:\/\//,
    );
  });

  it("distinguishes an absent field from an analysis-wide failure — the card itself renders normally", () => {
    render(
      <OnPageCard
        title="Example page"
        description="An example description"
        robots={undefined}
        lang={undefined}
        indexable={false}
      />,
    );

    expect(screen.getByTestId("onpage-robots")).toHaveTextContent(
      /not present/i,
    );
    expect(screen.getByTestId("onpage-lang")).toHaveTextContent(/not present/i);
    expect(screen.getByTestId("onpage-indexable")).toHaveTextContent(
      /not indexable/i,
    );
  });
});
