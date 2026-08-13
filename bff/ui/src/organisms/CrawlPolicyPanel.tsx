import type { CrawlPolicy } from "../../../../src/types";
import { describeCappedList, describeCategory } from "../data/bounds";
import { SampleBadge } from "../molecules/SampleBadge";

/**
 * `site-crawl-view`'s "Crawl Policy Panel Reflects the Real Result Shape"
 * requirement. `robotsFound` renders one of two mutually exclusive, visibly
 * distinct messages — never the same "everything permitted" state for both
 * found-and-permits-everything and not-found. `sitemapsDeclared` (a bare
 * capped list, no reported total — `describeCappedList`) and
 * `disallowedSkipped` (a `{ count, sample }` category — `describeCategory`)
 * each label their own sample independently via the shared `SampleBadge`.
 */
export interface CrawlPolicyPanelProps {
  readonly crawlPolicy: CrawlPolicy;
}

const SITEMAPS_DECLARED_CAP = 20;
const DISALLOWED_SKIPPED_SAMPLE_CAP = 25;

export function CrawlPolicyPanel({ crawlPolicy }: CrawlPolicyPanelProps) {
  return (
    <section className="panel" aria-label="Crawl policy">
      <h3>Crawl policy</h3>
      <p
        className={
          crawlPolicy.robotsFound ? "empty-state empty-state-ok" : "empty-state"
        }
        data-testid="robots-status"
      >
        {crawlPolicy.robotsFound
          ? "robots.txt found"
          : "No robots.txt was found for this site"}
      </p>

      <div className="subpanel">
        <h4>Declared sitemaps</h4>
        {crawlPolicy.sitemapsDeclared.length === 0 ? (
          <p className="empty-state">No sitemaps declared.</p>
        ) : (
          <ul className="url-list">
            {crawlPolicy.sitemapsDeclared.map((url) => (
              <li key={url}>{url}</li>
            ))}
          </ul>
        )}
        <SampleBadge
          cardinality={describeCappedList(
            crawlPolicy.sitemapsDeclared,
            "sitemapsDeclared",
            SITEMAPS_DECLARED_CAP,
            "crawlPolicy.sitemapsDeclared",
          )}
        />
      </div>

      <div className="subpanel">
        <h4>Disallowed by robots rules</h4>
        <p className="figure" data-testid="disallowed-skipped-count">
          {crawlPolicy.disallowedSkipped.count}
        </p>
        {crawlPolicy.disallowedSkipped.count > 0 && (
          <ul className="url-list">
            {crawlPolicy.disallowedSkipped.sample.map((url) => (
              <li key={url}>{url}</li>
            ))}
          </ul>
        )}
        <SampleBadge
          cardinality={describeCategory(
            crawlPolicy.disallowedSkipped,
            "DomainCategory.sample",
            DISALLOWED_SKIPPED_SAMPLE_CAP,
            "crawlPolicy.disallowedSkipped.sample",
          )}
        />
      </div>
    </section>
  );
}
