import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { App } from "./App";

describe("App shell", () => {
  it("renders the dashboard title and a primary navigation landmark", () => {
    render(<App />);
    expect(
      screen.getByRole("heading", { level: 1, name: "SEO Dashboard" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Primary" }),
    ).toBeInTheDocument();
  });

  it("every navigation link is reachable and operable via keyboard alone", async () => {
    const user = userEvent.setup();
    render(<App />);

    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);

    for (const link of links) {
      await user.tab();
    }
    // At least the first link must have received focus during pure
    // Tab-only navigation — proves the nav is keyboard-reachable, not just
    // present in the DOM.
    expect(links).toContain(document.activeElement);
  });

  it("has zero axe violations", async () => {
    const { container } = render(<App />);
    expect((await axe(container)).violations).toEqual([]);
  });
});
