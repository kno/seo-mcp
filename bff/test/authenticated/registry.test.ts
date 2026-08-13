/**
 * Threat matrix row (f): the authenticated registry is an explicit
 * allowlist derived from the published schema map
 * (`src/types/schemas.ts`), so a `business_*` write tool is unreachable by
 * construction, not merely un-navigated. `isAuthenticatedTool` and
 * `getAuthenticatedRoute` are pure, synchronous lookups — no fetch is
 * reachable from either, so "rejected before any upstream call" is a
 * structural property of the module, not merely an observed one.
 */
import { describe, expect, it } from "vitest";
import {
  AUTHENTICATED_REGISTRY,
  getAuthenticatedRoute,
  isAuthenticatedTool,
} from "../../src/authenticated/registry";

const BUSINESS_TOOL_NAMES = [
  "business_list_locations",
  "business_get_reviews",
  "business_get_performance",
  "business_reply_review",
  "business_update_info",
  "business_create_post",
];

describe("authenticated tool registry — allowlist (threat row f)", () => {
  it("contains no business_* tool name", () => {
    const names = Object.keys(AUTHENTICATED_REGISTRY);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name.startsWith("business_")).toBe(false);
    }
  });

  it("rejects every business_* tool name before any upstream call", () => {
    for (const name of BUSINESS_TOOL_NAMES) {
      expect(isAuthenticatedTool(name)).toBe(false);
      expect(getAuthenticatedRoute(name)).toBeUndefined();
    }
  });

  it("includes the verified search_console_query route", () => {
    expect(isAuthenticatedTool("search_console_query")).toBe(true);
    const route = getAuthenticatedRoute("search_console_query");
    expect(route).toBeDefined();
    expect(route?.source).toBe("search-console");
    expect(route?.timeoutMs).toBe(27_000);
  });

  it("rejects an unknown/unregistered tool name", () => {
    expect(isAuthenticatedTool("not_a_real_tool")).toBe(false);
    expect(getAuthenticatedRoute("not_a_real_tool")).toBeUndefined();
  });
});
