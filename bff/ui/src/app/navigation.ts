/**
 * `seo-intelligence-view`'s (PR10) cross-view drill-down mechanism, task
 * 10.11. No prior view in this app navigates to ANOTHER view carrying data
 * with it (`site-crawl-view`'s own drill-down, `PerPageTable`'s "View
 * report" action, stays entirely in-memory within `SiteCrawlContainer` —
 * see its doc comment — it never crosses a hash-route boundary). This is
 * the first one that does, so it is a small, explicit, deliberately minimal
 * addition rather than a routing library: a single pending value, set by
 * the origin view immediately before it navigates (an anchor's `onClick`,
 * a real user gesture), and consumed exactly once by the destination
 * view's mount-time `useState` initializer — never by an effect, so
 * arriving at `page-report-view`/`site-crawl-view` this way still performs
 * NO fetch on mount (`data/client.ts`'s trigger-discipline invariant):
 * only the URL FIELD is pre-filled, the user still submits the form
 * themselves.
 */

export type DrillDownView = "page-report" | "site-crawl";

interface PendingDrillDown {
  readonly view: DrillDownView;
  readonly url: string;
}

let pending: PendingDrillDown | null = null;

/** Called by the origin view's own click handler — a real user gesture,
 * immediately before it sets `window.location.hash` to navigate. */
export function setPendingDrillDown(view: DrillDownView, url: string): void {
  pending = { view, url };
}

/**
 * Called exactly once, at mount, by the destination container's own
 * `useState(() => takePendingDrillDown("..."))` initializer. Consumes (and
 * clears) the pending value only when it matches `view` — a drill-down
 * navigation aimed at a DIFFERENT view (or none at all, e.g. the nav-rail
 * link) leaves it untouched, so a stale value can never leak into an
 * unrelated later visit to the same view.
 */
export function takePendingDrillDown(view: DrillDownView): string | null {
  if (pending && pending.view === view) {
    const url = pending.url;
    pending = null;
    return url;
  }
  return null;
}
