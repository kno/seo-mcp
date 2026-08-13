import { describe, expect, it } from "vitest";
import type { Bound, Cardinality } from "./bounds";
import { isBounded } from "./bounds";

describe("Cardinality discrimination", () => {
  it("distinguishes 'none' from 'bounded' via isBounded, not raw counts", () => {
    const none: Cardinality = { state: "none" };
    const bound: Bound = {
      kind: "probe_cap",
      scope: "linkCheck.checked",
      limitName: "maxLinkChecks",
      limitValue: 50,
      shown: 50,
    };
    const bounded: Cardinality = { state: "bounded", bound };

    expect(isBounded(none)).toBe(false);
    expect(isBounded(bounded)).toBe(true);
  });

  it("does not consider 'complete' or 'unknown' as bounded", () => {
    const complete: Cardinality = { state: "complete", total: 3 };
    const unknown: Cardinality = { state: "unknown" };

    expect(isBounded(complete)).toBe(false);
    expect(isBounded(unknown)).toBe(false);
  });

  it("narrows the type so `.bound` is accessible without a cast when isBounded is true", () => {
    const bound: Bound = {
      kind: "sample_cap",
      scope: "summary.duplicateTitles[0].sample",
      limitName: "DuplicateGroup.sample",
      limitValue: 10,
      shown: 10,
      total: 34,
    };
    const cardinality: Cardinality = { state: "bounded", bound };

    if (isBounded(cardinality)) {
      // This line only typechecks if `isBounded` is a real type guard.
      expect(cardinality.bound.limitValue).toBe(10);
      expect(cardinality.bound.total).toBe(34);
    } else {
      throw new Error("expected isBounded to narrow to the bounded branch");
    }
  });
});
