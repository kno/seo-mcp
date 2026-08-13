/**
 * Two staleness axes, separated by type (design.md, "Decision: two
 * staleness axes are separated by type, not by discipline"):
 *
 * - `resultAge` (`bff/src/errors.ts#BffOk`) is seconds-since-cache-write —
 *   how long ago the BFF last called upstream.
 * - `SourceFreshness` is a calendar fact about the upstream data itself:
 *   how far behind Google's own reporting is, independent of when the BFF
 *   happened to fetch it.
 *
 * `search_console_query` returns no freshness field at all (verified
 * against `src/google/search-console.ts`), so `asOf` is DERIVED, not read:
 * `asOf = min(endDate, today − GSC_REPORTING_LAG_DAYS)`, and `basis` stays
 * `"assumed"` — never presented as a fact Google asserted — until a future
 * `dimensions: ["date"]` probe (an explicit, currently-unbuilt refinement)
 * upgrades it to `"reported"`.
 *
 * `GSC_REPORTING_LAG_DAYS`'s concrete value is an open decision per
 * design.md ("deferred to apply time as a config constant"); resolved here
 * as `2`, Google's commonly observed Search Console reporting delay. Phase
 * 3 moves this into `bff/wrangler.jsonc` as a tunable var — this constant
 * is the single place that migration touches.
 *
 * `keyword-research-view` (PR8) extends `AuthenticatedSource` with
 * `"google-ads"` for `get_keyword_metrics`/`discover_keywords`. Those two
 * tools take NO date-range input at all (verified against
 * `src/google/ads.ts`) — Keyword Planner metrics are a rolling market-volume
 * figure, not a calendar-ranged report the way Search Console's is. There is
 * therefore no "Google is N days behind on this date range" fact to state
 * for this source, so `authenticated/registry.ts`'s `google-ads` routes pass
 * `lagDays: 0` and today's own date as the "endDate" this function derives
 * from (`adsRollingWindowFreshnessDate`, mirroring the same-shaped
 * `todayAsFreshnessFallback` this module's sibling already uses for
 * `compare_search_console`, which has no date field for a different reason).
 * The resulting `{ asOf: today, lagDays: 0, basis: "assumed" }` is an honest
 * statement — "this is the response for a rolling-window query issued
 * today", not a claim that Google's own data is exactly current — never a
 * fabricated reporting lag borrowed from the GSC constant above.
 */

export type AuthenticatedSource = "search-console" | "google-ads";

export interface SourceFreshness {
  /** Upstream identity this freshness value describes. Extended per source
   * as later authenticated tools (e.g. `google-ads`) are wired. */
  source: AuthenticatedSource;
  /** YYYY-MM-DD — the latest date the upstream data actually covers. */
  asOf: string;
  /** Whole days between `asOf` and the request date. */
  lagDays: number;
  /** GSC reports no freshness field today, so this is always "assumed"
   * until a probe-based refinement lands. */
  basis: "reported" | "assumed";
}

export const GSC_REPORTING_LAG_DAYS = 2;

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDateOnly(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00.000Z`);
}

function subtractDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() - days);
  return copy;
}

function wholeDaysBetween(earlier: Date, later: Date): number {
  const MS_PER_DAY = 86_400_000;
  return Math.round((later.getTime() - earlier.getTime()) / MS_PER_DAY);
}

/**
 * Derives a `SourceFreshness` for `source` given the query's `endDate` and
 * the current request time. `asOf` is capped at `today - lagDays`: Google's
 * own reporting lag means data for dates inside that window is not
 * considered settled, regardless of what `endDate` the caller requested.
 */
export function deriveSourceFreshness(
  source: AuthenticatedSource,
  endDate: string,
  today: Date = new Date(),
  lagDays: number = GSC_REPORTING_LAG_DAYS,
): SourceFreshness {
  const lagBoundary = toDateOnly(subtractDays(today, lagDays));
  const asOf = endDate < lagBoundary ? endDate : lagBoundary;
  const actualLagDays = wholeDaysBetween(parseDateOnly(asOf), today);
  return { source, asOf, lagDays: actualLagDays, basis: "assumed" };
}
