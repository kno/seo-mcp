import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { Bound } from "../data/bounds";
import { StateRegion } from "./StateRegion";

const SAMPLE_BOUND: Bound = {
  kind: "sample_cap",
  scope: "summary.duplicateTitles[0].sample",
  limitName: "DuplicateGroup.sample",
  limitValue: 10,
  shown: 10,
  total: 34,
};

describe("StateRegion accessibility", () => {
  it("has zero axe violations while loading", async () => {
    const { container } = render(
      <StateRegion label="Site crawl" state={{ phase: "loading" }} />,
    );
    expect((await axe(container)).violations).toEqual([]);
  });

  it("has zero axe violations in the empty state", async () => {
    const { container } = render(
      <StateRegion
        label="Site crawl"
        state={{ phase: "ready", cardinality: { state: "none" } }}
      />,
    );
    expect((await axe(container)).violations).toEqual([]);
  });

  it("has zero axe violations in the bound-reached state", async () => {
    const { container } = render(
      <StateRegion
        label="Site crawl"
        state={{
          phase: "ready",
          cardinality: { state: "bounded", bound: SAMPLE_BOUND },
        }}
      />,
    );
    expect((await axe(container)).violations).toEqual([]);
  });

  it("has zero axe violations in the error state, including the retryAfter countdown", async () => {
    const { container } = render(
      <StateRegion
        label="Site crawl"
        state={{
          phase: "error",
          error: {
            code: "upstream_rate_limited",
            message: "rate limited",
            retryAfter: 30,
          },
        }}
      />,
    );
    expect((await axe(container)).violations).toEqual([]);
  });

  it("has zero axe violations in a populated (complete) state", async () => {
    const { container } = render(
      <StateRegion
        label="Site crawl"
        state={{ phase: "ready", cardinality: { state: "complete", total: 3 } }}
      >
        <ul>
          <li>example.com/one</li>
          <li>example.com/two</li>
          <li>example.com/three</li>
        </ul>
      </StateRegion>,
    );
    expect((await axe(container)).violations).toEqual([]);
  });
});
