import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { OpenGraphPanel } from "./OpenGraphPanel";

describe("OpenGraphPanel", () => {
  it("shows an explicit 'no Open Graph metadata' state for an empty map, not a blank panel", () => {
    render(<OpenGraphPanel openGraph={{}} />);

    expect(screen.getByText(/no open graph metadata/i)).toBeInTheDocument();
  });

  it("lists every Open Graph key/value pair present", () => {
    render(
      <OpenGraphPanel
        openGraph={{ "og:title": "Example", "og:type": "article" }}
      />,
    );

    expect(screen.getByText("og:title")).toBeInTheDocument();
    expect(screen.getByText("Example")).toBeInTheDocument();
    expect(screen.getByText("og:type")).toBeInTheDocument();
    expect(screen.getByText("article")).toBeInTheDocument();
    expect(
      screen.queryByText(/no open graph metadata/i),
    ).not.toBeInTheDocument();
  });
});
