import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScoreGauge } from "./ScoreGauge";

describe("ScoreGauge", () => {
  it("renders the numeric score, legible from text alone", () => {
    render(<ScoreGauge label="Performance" score={87} />);
    expect(screen.getByText("87")).toBeInTheDocument();
  });

  it("renders an explicit unavailable state, never a fabricated 0, when the score is absent", () => {
    render(<ScoreGauge label="Accessibility" score={undefined} />);
    expect(screen.getByTestId("absent")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("distinguishes a genuine score of 0 from an absent score", () => {
    render(<ScoreGauge label="SEO" score={0} />);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.queryByTestId("absent")).not.toBeInTheDocument();
  });
});
