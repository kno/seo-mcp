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

  it("registers exactly six search-console-backed tools (search_console_query + the five gsc-insight-views tools)", () => {
    const searchConsoleTools = Object.values(AUTHENTICATED_REGISTRY).filter(
      (route) => route.source === "search-console",
    );
    expect(searchConsoleTools).toHaveLength(6);
  });
});

/**
 * `keyword-research-view` (PR8) — task 8.5/8.6/8.7. `get_keyword_metrics`
 * and `discover_keywords` are registered under a NEW source, `google-ads`,
 * distinct from `search-console` — this is what the view's second, separate
 * quota indicator and the `AUTH_SOURCE_BUDGET`/`AUTH_SOURCE_TTL_SECONDS`
 * lookups both key off. `cluster_keywords` is deliberately absent: it has
 * no Google Ads call, no credential, and no quota, so it is verified NOT to
 * be in this allowlist at all — by construction, not merely by omission.
 */
describe("authenticated tool registry — keyword-research-view (PR8)", () => {
  it.each(["get_keyword_metrics", "discover_keywords"] as const)(
    "registers %s under a new, separate google-ads source",
    (name) => {
      expect(isAuthenticatedTool(name)).toBe(true);
      const route = getAuthenticatedRoute(name);
      expect(route).toBeDefined();
      expect(route?.source).toBe("google-ads");
      expect(route?.source).not.toBe("search-console");
      expect(route?.callsGoogleUpstream).toBe(true);
    },
  );

  it("gives both google-ads routes a lagDays override of 0 — a rolling-window metric has no reporting-lag figure", () => {
    for (const name of ["get_keyword_metrics", "discover_keywords"]) {
      expect(getAuthenticatedRoute(name)?.lagDays).toBe(0);
    }
  });

  it("does NOT register cluster_keywords — it has no Google Ads call, credential, or quota", () => {
    expect(isAuthenticatedTool("cluster_keywords")).toBe(false);
    expect(getAuthenticatedRoute("cluster_keywords")).toBeUndefined();
  });

  it("registers exactly eight tools total after PR8 (six GSC-backed + two google-ads-backed)", () => {
    expect(Object.keys(AUTHENTICATED_REGISTRY)).toHaveLength(8);
  });
});
