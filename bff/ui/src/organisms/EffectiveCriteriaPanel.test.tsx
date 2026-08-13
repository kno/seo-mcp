import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EffectiveCriteriaPanel } from "./EffectiveCriteriaPanel";

describe("EffectiveCriteriaPanel", () => {
  it("renders every criteria field, marked basis: request (task 10.1)", () => {
    render(
      <EffectiveCriteriaPanel criteria={{ basis: "request", limit: 10 }} />,
    );
    expect(screen.getByTestId("criteria-basis")).toHaveTextContent("request");
    expect(screen.getByTestId("criteria-limit")).toHaveTextContent("10");
  });

  it("renders the unconditional GSC-pull caveat regardless of the criteria shape (task 10.3)", () => {
    render(
      <EffectiveCriteriaPanel criteria={{ basis: "request", limit: 50 }} />,
    );
    expect(screen.getByTestId("gsc-pull-caveat")).toHaveTextContent("250");
  });
});
