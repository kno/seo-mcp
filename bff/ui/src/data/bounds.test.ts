import { describe, expect, it } from "vitest";
import type { Bound, Cardinality } from "./bounds";
import {
  describeCappedList,
  describeCategory,
  describeOutputBytes,
  describeProbeSet,
  isBounded,
} from "./bounds";

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

describe("describeProbeSet", () => {
  it("returns 'none' when zero links were checked", () => {
    expect(describeProbeSet(0, 50)).toEqual({ state: "none" });
  });

  it("returns 'bounded' naming the limit when checked equals the server's cap", () => {
    const result = describeProbeSet(50, 50);
    expect(result.state).toBe("bounded");
    if (result.state === "bounded") {
      expect(result.bound).toEqual({
        kind: "probe_cap",
        scope: "checked",
        limitName: "maxLinkChecks",
        limitValue: 50,
        shown: 50,
      });
    }
  });

  it("returns 'complete' (never bounded) when checked is below the cap", () => {
    expect(describeProbeSet(12, 50)).toEqual({ state: "complete", total: 12 });
  });
});

describe("describeCategory", () => {
  it("returns 'none' when the category's count is 0", () => {
    expect(
      describeCategory(
        { count: 0, sample: [] },
        "DomainCategory.sample",
        25,
        "summary.missingH1",
      ),
    ).toEqual({ state: "none" });
  });

  it("returns 'bounded' naming the sample cap when the sample was truncated relative to count", () => {
    const sample = Array.from(
      { length: 10 },
      (_, i) => `https://example.com/${i}`,
    );
    const result = describeCategory(
      { count: 15, sample },
      "DuplicateGroup.sample",
      10,
      "summary.duplicateTitles[0].sample",
    );
    expect(result).toEqual({
      state: "bounded",
      bound: {
        kind: "sample_cap",
        scope: "summary.duplicateTitles[0].sample",
        limitName: "DuplicateGroup.sample",
        limitValue: 10,
        shown: 10,
        total: 15,
      },
    });
  });

  it("returns 'complete' when count equals the sample length (not mislabeled as a sample)", () => {
    const sample = ["https://example.com/a", "https://example.com/b"];
    const result = describeCategory(
      { count: 2, sample },
      "DomainCategory.sample",
      25,
      "summary.nonIndexable",
    );
    expect(result).toEqual({ state: "complete", total: 2 });
  });
});

describe("describeCappedList", () => {
  it("returns 'none' for an empty list", () => {
    expect(
      describeCappedList(
        [],
        "sitemapsDeclared",
        20,
        "crawlPolicy.sitemapsDeclared",
      ),
    ).toEqual({ state: "none" });
  });

  it("returns 'bounded' without a total when the list length equals the cap", () => {
    const items = Array.from({ length: 20 }, (_, i) => `sitemap-${i}.xml`);
    const result = describeCappedList(
      items,
      "sitemapsDeclared",
      20,
      "crawlPolicy.sitemapsDeclared",
    );
    expect(result).toEqual({
      state: "bounded",
      bound: {
        kind: "group_cap",
        scope: "crawlPolicy.sitemapsDeclared",
        limitName: "sitemapsDeclared",
        limitValue: 20,
        shown: 20,
      },
    });
  });

  it("returns 'complete' when the list length is below the cap", () => {
    const items = ["sitemap-0.xml", "sitemap-1.xml"];
    const result = describeCappedList(
      items,
      "sitemapsDeclared",
      20,
      "crawlPolicy.sitemapsDeclared",
    );
    expect(result).toEqual({ state: "complete", total: 2 });
  });
});

describe("describeOutputBytes", () => {
  const MAX_SITE_OUTPUT_BYTES = 256_000;

  it("returns null when outputBytes is far below the cap", () => {
    const result = describeOutputBytes(
      { outputBytes: 1000, requested: 10, crawled: 10, failed: 0 },
      MAX_SITE_OUTPUT_BYTES,
    );
    expect(result).toBeNull();
  });

  it("returns null when outputBytes is near the cap but nothing was actually truncated", () => {
    const result = describeOutputBytes(
      { outputBytes: 255_000, requested: 10, crawled: 10, failed: 0 },
      MAX_SITE_OUTPUT_BYTES,
    );
    expect(result).toBeNull();
  });

  it("returns an output_bytes bound when near the cap AND crawled+failed < requested", () => {
    const result = describeOutputBytes(
      { outputBytes: 255_500, requested: 20, crawled: 12, failed: 1 },
      MAX_SITE_OUTPUT_BYTES,
    );
    expect(result).toEqual({
      kind: "output_bytes",
      scope: "outputBytes",
      limitName: "maxSiteOutputBytes",
      limitValue: MAX_SITE_OUTPUT_BYTES,
      shown: 13,
      total: 20,
    });
  });
});
