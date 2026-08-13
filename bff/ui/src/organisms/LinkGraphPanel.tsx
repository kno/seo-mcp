import type { LinkGraphSummary } from "../../../../src/types";
import { describeCappedList, describeCategory } from "../data/bounds";
import { SampleBadge } from "../molecules/SampleBadge";
import { BarChart } from "../charts/BarChart";

/**
 * `site-crawl-view`'s "Internal Link Graph Shows Orphans and Most-Linked
 * Pages" requirement. `orphanPages.count === 0` renders an explicit
 * positive "no orphan pages" message — `describeCategory` maps that to
 * `"none"`, distinct from any truncated/bounded state, so a genuinely clean
 * result can never look the same as a result that could not be determined.
 * `topLinkedPages` (a bare capped list with no reported total) renders
 * through the shared `BarChart`, which is itself a real accessible table —
 * this requirement is explicit that the visualization mechanism is
 * unspecified, only the underlying data's correctness is in scope.
 */
export interface LinkGraphPanelProps {
  readonly linkGraph: LinkGraphSummary;
}

const ORPHAN_PAGES_SAMPLE_CAP = 25;
const TOP_LINKED_PAGES_CAP = 10;

export function LinkGraphPanel({ linkGraph }: LinkGraphPanelProps) {
  return (
    <section aria-label="Internal link graph">
      <p data-testid="crawled-pages">
        Crawled pages considered: {linkGraph.crawledPages}
      </p>

      <div>
        <h3>Orphan pages</h3>
        <p data-testid="orphan-pages">
          {linkGraph.orphanPages.count === 0
            ? "No orphan pages found."
            : `${linkGraph.orphanPages.count} orphan page(s) found.`}
        </p>
        {linkGraph.orphanPages.count > 0 && (
          <ul>
            {linkGraph.orphanPages.sample.map((url) => (
              <li key={url}>{url}</li>
            ))}
          </ul>
        )}
        <SampleBadge
          cardinality={describeCategory(
            linkGraph.orphanPages,
            "DomainCategory.sample",
            ORPHAN_PAGES_SAMPLE_CAP,
            "linkGraph.orphanPages.sample",
          )}
        />
      </div>

      <div>
        <h3>Most-linked pages</h3>
        <BarChart items={linkGraph.topLinkedPages} />
        <SampleBadge
          cardinality={describeCappedList(
            linkGraph.topLinkedPages,
            "topLinkedPages",
            TOP_LINKED_PAGES_CAP,
            "linkGraph.topLinkedPages",
          )}
        />
      </div>
    </section>
  );
}
