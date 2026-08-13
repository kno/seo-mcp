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

/**
 * `gsc-insight-views` (PR6) — the five-tool registry slice. Each of the
 * three live-Google tools gets `callsGoogleUpstream: true` and a timeout at
 * or above `search_console_query`'s own 27s Google-call margin; each of the
 * two D1-only tools gets `callsGoogleUpstream: false` and a smaller timeout
 * since neither makes a Google call at all.
 */
describe("authenticated tool registry — gsc-insight-views (PR6)", () => {
  it.each([
    ["find_striking_distance_keywords", 27_000],
    ["find_low_ctr_opportunities", 27_000],
    ["snapshot_search_console", 28_000],
  ] as const)(
    "registers %s as a live-Google GSC tool with timeout %i",
    (name, timeoutMs) => {
      expect(isAuthenticatedTool(name)).toBe(true);
      const route = getAuthenticatedRoute(name);
      expect(route).toBeDefined();
      expect(route?.source).toBe("search-console");
      expect(route?.timeoutMs).toBe(timeoutMs);
      expect(route?.callsGoogleUpstream).toBe(true);
    },
  );

  it.each([
    ["list_search_console_snapshots", 10_000],
    ["compare_search_console", 10_000],
  ] as const)(
    "registers %s as a D1-only tool with timeout %i and no Google upstream call",
    (name, timeoutMs) => {
      expect(isAuthenticatedTool(name)).toBe(true);
      const route = getAuthenticatedRoute(name);
      expect(route).toBeDefined();
      expect(route?.source).toBe("search-console");
      expect(route?.timeoutMs).toBe(timeoutMs);
      expect(route?.callsGoogleUpstream).toBe(false);
    },
  );

  it("gives every D1-only tool a smaller timeout than every live-Google tool", () => {
    const googleTimeouts = [
      "find_striking_distance_keywords",
      "find_low_ctr_opportunities",
      "snapshot_search_console",
    ].map((name) => getAuthenticatedRoute(name)?.timeoutMs ?? 0);
    const d1Timeouts = [
      "list_search_console_snapshots",
      "compare_search_console",
    ].map((name) => getAuthenticatedRoute(name)?.timeoutMs ?? Infinity);
    for (const d1Timeout of d1Timeouts) {
      for (const googleTimeout of googleTimeouts) {
        expect(d1Timeout).toBeLessThan(googleTimeout);
      }
    }
  });

  it("registers exactly six tools total (search_console_query + the five gsc-insight-views tools)", () => {
    expect(Object.keys(AUTHENTICATED_REGISTRY)).toHaveLength(6);
  });
});
