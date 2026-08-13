import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Cardinality } from "../data/bounds";
import { SampleBadge } from "./SampleBadge";

describe("SampleBadge", () => {
  it("renders nothing for a 'complete' cardinality — never labels a complete field as a sample", () => {
    const cardinality: Cardinality = { state: "complete", total: 3 };
    render(<SampleBadge cardinality={cardinality} />);
    expect(screen.queryByTestId("sample-badge")).not.toBeInTheDocument();
  });

  it("renders nothing for a 'none' cardinality", () => {
    render(<SampleBadge cardinality={{ state: "none" }} />);
    expect(screen.queryByTestId("sample-badge")).not.toBeInTheDocument();
  });

  it("labels a bounded field as a sample, naming shown/total and the limit", () => {
    const cardinality: Cardinality = {
      state: "bounded",
      bound: {
        kind: "sample_cap",
        scope: "summary.duplicateTitles[0].sample",
        limitName: "DuplicateGroup.sample",
        limitValue: 10,
        shown: 10,
        total: 15,
      },
    };
    render(<SampleBadge cardinality={cardinality} />);
    const badge = screen.getByTestId("sample-badge");
    expect(badge).toHaveTextContent("10");
    expect(badge).toHaveTextContent("15");
    expect(badge).toHaveTextContent("DuplicateGroup.sample");
  });

  it("labels a bounded field with no known total without implying a total exists", () => {
    const cardinality: Cardinality = {
      state: "bounded",
      bound: {
        kind: "group_cap",
        scope: "linkGraph.topLinkedPages",
        limitName: "topLinkedPages",
        limitValue: 10,
        shown: 10,
      },
    };
    render(<SampleBadge cardinality={cardinality} />);
    const badge = screen.getByTestId("sample-badge");
    expect(badge).toHaveTextContent("10");
    expect(badge).toHaveTextContent("topLinkedPages");
  });
});
