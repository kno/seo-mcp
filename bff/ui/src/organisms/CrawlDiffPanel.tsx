import type {
  CrawlDiff,
  CrawlPageIssueChange,
  StoredCrawlSnapshot,
} from "../../../../src/types";
import {
  collectCrawlDiffBounds,
  isBounded,
  type CrawlDiffBucketName,
} from "../data/bounds";

/**
 * Renders a `compare_crawls` result (`history-comparison-view`, task 11.5).
 * A DIFFERENT bucket shape than `SnapshotDiffPanel`'s `GscDiff` (four
 * direction buckets over one row type): `CrawlDiff` splits into two
 * genuinely different kinds of change, rendered as two visually distinct
 * section groups so neither is ever conflated with the other:
 *
 * - "Pages" (`newPages`/`removedPages`, `string[]`): a WHOLE PAGE appeared
 *   or disappeared between the two snapshots. Presence is by URL alone —
 *   the page's own issues never factor into this bucket.
 * - "On-page issues" (`newIssues`/`resolvedIssues`, `CrawlPageIssueChange[]`):
 *   for a page present in BOTH snapshots, an issue CODE was added or
 *   removed on it. A page that disappeared entirely contributes to
 *   `removedPages` once, never to `resolvedIssues` for its old issues.
 *
 * `issueCountDeltas` (`Record<string, number>`, a site-wide aggregate net
 * change per issue code, not scoped to any one page) gets its own third
 * section — it is neither a page list nor a per-page issue change, so
 * folding it into either bucket family would misrepresent what it counts.
 *
 * Each of the four array buckets is bounded independently at
 * `LIMITS.maxCrawlDiffRows` (`collectCrawlDiffBounds`) — mirrors
 * `SnapshotDiffPanel`'s per-bucket-independent bound labelling for `GscDiff`.
 */
export interface CrawlDiffPanelProps {
  readonly url: string;
  readonly baseSnapshotId: number;
  readonly currentSnapshotId: number;
  readonly diff: CrawlDiff;
  readonly baseSnapshot?: StoredCrawlSnapshot;
  readonly currentSnapshot?: StoredCrawlSnapshot;
}

function describeSnapshotEndpoint(
  id: number,
  snapshot: StoredCrawlSnapshot | undefined,
): string {
  if (!snapshot) return `Snapshot #${id}`;
  const label = snapshot.label ?? "(no label)";
  return `Snapshot #${id} — ${label} — captured ${snapshot.capturedAt}`;
}

function BoundNote({
  name,
  bounds,
}: {
  readonly name: CrawlDiffBucketName;
  readonly bounds: Readonly<
    Record<
      CrawlDiffBucketName,
      ReturnType<typeof collectCrawlDiffBounds>[CrawlDiffBucketName]
    >
  >;
}) {
  const cardinality = bounds[name];
  if (!isBounded(cardinality)) return null;
  return (
    <p className="bound-indicator" data-testid={`crawl-diff-bound-${name}`}>
      Showing {cardinality.bound.shown} of a maximum{" "}
      {cardinality.bound.limitValue} ({cardinality.bound.limitName}) for this
      list only — other lists are not implied to be at their own cap.
    </p>
  );
}

function PageListSection({
  name,
  heading,
  statClass,
  pages,
  bounds,
}: {
  readonly name: CrawlDiffBucketName;
  readonly heading: string;
  readonly statClass: string;
  readonly pages: readonly string[];
  readonly bounds: ReturnType<typeof collectCrawlDiffBounds>;
}) {
  return (
    <section
      className={`panel ${statClass}`}
      aria-label={heading}
      data-testid={`crawl-diff-bucket-${name}`}
    >
      <h4>{heading}</h4>
      <BoundNote name={name} bounds={bounds} />
      {pages.length === 0 ? (
        <p className="empty-state">None.</p>
      ) : (
        <ul className="item-list" aria-label={`${heading} list`}>
          {pages.map((page) => (
            <li key={page} className="item-row">
              <p className="cell-url">{page}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function IssueChangeSection({
  name,
  heading,
  statClass,
  changes,
  bounds,
}: {
  readonly name: CrawlDiffBucketName;
  readonly heading: string;
  readonly statClass: string;
  readonly changes: readonly CrawlPageIssueChange[];
  readonly bounds: ReturnType<typeof collectCrawlDiffBounds>;
}) {
  return (
    <section
      className={`panel ${statClass}`}
      aria-label={heading}
      data-testid={`crawl-diff-bucket-${name}`}
    >
      <h4>{heading}</h4>
      <BoundNote name={name} bounds={bounds} />
      {changes.length === 0 ? (
        <p className="empty-state">None.</p>
      ) : (
        <ul className="item-list" aria-label={`${heading} list`}>
          {changes.map((change) => (
            <li key={change.page} className="item-row">
              <p className="cell-url">{change.page}</p>
              <p className="field-hint">{change.codes.join(", ")}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function CrawlDiffPanel({
  baseSnapshotId,
  currentSnapshotId,
  diff,
  baseSnapshot,
  currentSnapshot,
}: CrawlDiffPanelProps) {
  const bounds = collectCrawlDiffBounds(diff);
  const deltaEntries = Object.entries(diff.issueCountDeltas);

  return (
    <div className="panel panel-wide span-full">
      <h3>Comparison</h3>
      <p data-testid="crawl-diff-endpoints">
        Base: {describeSnapshotEndpoint(baseSnapshotId, baseSnapshot)}
        {" → "}
        Current: {describeSnapshotEndpoint(currentSnapshotId, currentSnapshot)}
      </p>

      <h4 className="section-subhead">Pages</h4>
      <p className="field-hint">
        A whole page appeared or disappeared between the two snapshots —
        independent of any issue it carries.
      </p>
      <div className="view-stack">
        <PageListSection
          name="newPages"
          heading="New pages"
          statClass="stat-info"
          pages={diff.newPages}
          bounds={bounds}
        />
        <PageListSection
          name="removedPages"
          heading="Removed pages"
          statClass="stat-danger"
          pages={diff.removedPages}
          bounds={bounds}
        />
      </div>

      <h4 className="section-subhead">On-page issues</h4>
      <p className="field-hint">
        For a page present in BOTH snapshots, an issue code was added or removed
        on it — distinct from a page appearing or disappearing entirely.
      </p>
      <div className="view-stack">
        <IssueChangeSection
          name="newIssues"
          heading="New issues"
          statClass="stat-warn"
          changes={diff.newIssues}
          bounds={bounds}
        />
        <IssueChangeSection
          name="resolvedIssues"
          heading="Resolved issues"
          statClass="stat-ok"
          changes={diff.resolvedIssues}
          bounds={bounds}
        />
      </div>

      <h4 className="section-subhead">Site-wide issue count deltas</h4>
      <p className="field-hint">
        The net change in how many pages carry each issue code, across the whole
        site — not scoped to any one page, and never truncated by
        `maxCrawlDiffRows`.
      </p>
      {deltaEntries.length === 0 ? (
        <p className="empty-state">No change in any issue code's count.</p>
      ) : (
        <ul className="item-list" aria-label="Issue count deltas">
          {deltaEntries.map(([code, delta]) => (
            <li key={code} className="item-row">
              <p className="cell-url">{code}</p>
              <p className="field-hint">
                {delta >= 0 ? "+" : ""}
                {delta} page{Math.abs(delta) === 1 ? "" : "s"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
