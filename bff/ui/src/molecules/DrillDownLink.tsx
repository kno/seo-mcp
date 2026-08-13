import { setPendingDrillDown } from "../app/navigation";
import type { DrillDownView } from "../app/navigation";

/**
 * `seo-intelligence-view`'s (PR10) page-referencing drill-down affordance,
 * task 10.11. A plain `<a>` to the destination view's own hash route — an
 * ordinary navigation, not a fetch — whose `onClick` first stashes `url`
 * via `setPendingDrillDown` so the destination container's mount-time
 * `useState` initializer can pre-fill its own form with it (see
 * `app/navigation.ts`'s doc comment). Never rendered for a `null` page
 * (e.g. a `cannibalization`-type `Opportunity`, whose `page` is always
 * `null`) — the CALLER omits this component entirely rather than this
 * component rendering a disabled/dead link, so "no page drill-down for
 * this one type" reads as an absent affordance, not a broken one.
 */
export interface DrillDownLinkProps {
  readonly view: DrillDownView;
  readonly url: string;
  readonly label: string;
}

const VIEW_HASH: Record<DrillDownView, string> = {
  "page-report": "#page-report",
  "site-crawl": "#site-crawl",
};

export function DrillDownLink({ view, url, label }: DrillDownLinkProps) {
  return (
    <a
      className="drill-down-link"
      href={VIEW_HASH[view]}
      onClick={() => setPendingDrillDown(view, url)}
    >
      {label}
    </a>
  );
}
