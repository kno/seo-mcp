import { describe, expect, it } from "vitest";
import { LIMITS, FREE_PLAN_SUBREQUEST_CEILING } from "../src/config";

describe("link-check subrequest budget invariants", () => {
  it("guarantees every configured link is attempted even with a redirecting page fetch", () => {
    expect(LIMITS.maxRedirects + 1 + LIMITS.maxLinkChecks).toBeLessThanOrEqual(
      LIMITS.linkCheckSubrequestBudget,
    );
  });

  it("keeps the link-check budget strictly below the Free-plan ceiling", () => {
    expect(LIMITS.linkCheckSubrequestBudget).toBeLessThan(
      FREE_PLAN_SUBREQUEST_CEILING,
    );
  });
});
