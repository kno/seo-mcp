import { describe, expect, it } from "vitest";
import {
  resolveEffectiveCriteria,
  GSC_PULL_CAVEAT,
} from "../../src/authenticated/criteria";

/**
 * `seo-intelligence-view` task 10.1/10.2: none of the five tools echoes a
 * `criteria` field, so the BFF resolves the EFFECTIVE (post-default-
 * resolution) criteria itself, marked `basis: "request"` — textually
 * distinct from `OpportunityResult.criteria`, which the tool itself echoes
 * without a `basis` field at all.
 */
describe("resolveEffectiveCriteria", () => {
  it("resolves find_seo_opportunities' default limit (10) when omitted", () => {
    const criteria = resolveEffectiveCriteria("find_seo_opportunities", {});
    expect(criteria).toEqual({ basis: "request", limit: 10 });
  });

  it("echoes an explicitly-supplied limit unchanged", () => {
    const criteria = resolveEffectiveCriteria("find_seo_opportunities", {
      limit: 5,
    });
    expect(criteria).toEqual({ basis: "request", limit: 5 });
  });

  it("resolves find_keyword_cannibalization's defaults (minImpressions 10, limit 50)", () => {
    const criteria = resolveEffectiveCriteria(
      "find_keyword_cannibalization",
      {},
    );
    expect(criteria).toEqual({
      basis: "request",
      minImpressions: 10,
      limit: 50,
    });
  });

  it("resolves map_keywords_to_pages' defaults (limit 100, topQueriesPerPage 10)", () => {
    const criteria = resolveEffectiveCriteria("map_keywords_to_pages", {});
    expect(criteria).toEqual({
      basis: "request",
      limit: 100,
      topQueriesPerPage: 10,
    });
  });

  it("resolves find_content_gaps' defaults (minPosition 21, minImpressions 10, limit 100)", () => {
    const criteria = resolveEffectiveCriteria("find_content_gaps", {});
    expect(criteria).toEqual({
      basis: "request",
      minPosition: 21,
      minImpressions: 10,
      limit: 100,
    });
  });

  it("resolves analyze_domain's default opportunityLimit (10)", () => {
    const criteria = resolveEffectiveCriteria("analyze_domain", {});
    expect(criteria).toEqual({ basis: "request", opportunityLimit: 10 });
  });

  it("always marks basis as 'request', never 'reported'", () => {
    const criteria = resolveEffectiveCriteria("find_content_gaps", {
      minPosition: 30,
    });
    expect(criteria.basis).toBe("request");
  });

  it("GSC_PULL_CAVEAT is a non-empty, stable string", () => {
    expect(typeof GSC_PULL_CAVEAT).toBe("string");
    expect(GSC_PULL_CAVEAT.length).toBeGreaterThan(0);
    expect(GSC_PULL_CAVEAT).toContain("250");
  });
});
