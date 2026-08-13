import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SourceFreshness } from "../../../src/authenticated/freshness";
import {
  describeSourceFreshness,
  SourceFreshnessBadge,
} from "./SourceFreshnessBadge";

const ASSUMED: SourceFreshness = {
  source: "search-console",
  asOf: "2026-08-11",
  lagDays: 2,
  basis: "assumed",
};

describe("SourceFreshnessBadge", () => {
  it("renders the as-of date and lag days", () => {
    render(<SourceFreshnessBadge freshness={ASSUMED} />);
    const badge = screen.getByTestId("source-freshness-badge");
    expect(badge).toHaveTextContent("2026-08-11");
    expect(badge).toHaveTextContent("2 day");
  });

  it("renders 'estimated' wording when basis is 'assumed'", () => {
    render(<SourceFreshnessBadge freshness={ASSUMED} />);
    expect(screen.getByTestId("source-freshness-badge")).toHaveTextContent(
      /estimated/i,
    );
  });

  it("renders 'reported' wording when basis is 'reported'", () => {
    render(
      <SourceFreshnessBadge freshness={{ ...ASSUMED, basis: "reported" }} />,
    );
    expect(screen.getByTestId("source-freshness-badge")).toHaveTextContent(
      /reported/i,
    );
  });

  it("never contains resultAge-style wording ('old'/'cached'), keeping the two staleness axes distinct", () => {
    render(<SourceFreshnessBadge freshness={ASSUMED} />);
    const text = screen.getByTestId("source-freshness-badge").textContent ?? "";
    expect(text).not.toMatch(/\bold\b/i);
    expect(text).not.toMatch(/cached/i);
  });
});

describe("describeSourceFreshness", () => {
  it("is the single source of the wording, reused by CSV export", () => {
    expect(describeSourceFreshness(ASSUMED)).toContain("2026-08-11");
    expect(describeSourceFreshness(ASSUMED)).toContain("estimated");
  });
});
