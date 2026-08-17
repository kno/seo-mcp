import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import type { StoredCrawlSnapshot } from "../../../../src/types";

/**
 * Renders `list_crawl_snapshots`' `StoredCrawlSnapshot[]`, most-recent
 * first. Sibling to `SnapshotListPanel` (the GSC-snapshot family's own
 * version) rather than a genericization of it — the two stored-snapshot
 * shapes diverge on more than field names (`url` vs `siteUrl`, no
 * `startDate`/`endDate`, extra `crawled`/`failed`/`issueCounts`), so a
 * shared component would need per-family column renderers with no real
 * logic left to share; the radio-pair selection pattern below IS shared
 * (copied verbatim, not re-derived).
 *
 * Each row's `crawled`/`failed` counts get a small hand-rolled SVG bar
 * (the same gradient-fill technique `charts/BarChart.tsx` uses for
 * `topLinkedPages` — no charting library, per design.md's "Charting
 * Primitives" decision) layered `aria-hidden` alongside the numeric
 * cells, which remain the accessible source of truth.
 *
 * Deletion (manual-snapshot-deletion follow-up): a two-click confirm
 * pattern (copied verbatim from `SnapshotListPanel` — see that component's
 * own doc comment for the full reasoning). First click on a row's "Delete"
 * button arms it ("Confirm delete?"); a second click on the SAME armed row
 * calls `onDelete(event, snapshot.id)` and disarms; clicking a DIFFERENT
 * row's button re-arms that row instead, disarming the previous one; the
 * armed state resets to `null` whenever the `snapshots` array reference
 * changes.
 */
export interface CrawlSnapshotListPanelProps {
  readonly snapshots: readonly StoredCrawlSnapshot[];
  readonly baseSnapshotId: number | null;
  readonly currentSnapshotId: number | null;
  readonly onSelectBase: (id: number) => void;
  readonly onSelectCurrent: (id: number) => void;
  readonly onDelete: (event: MouseEvent<HTMLButtonElement>, id: number) => void;
}

function CrawledFailedBar({
  crawled,
  failed,
}: {
  readonly crawled: number;
  readonly failed: number;
}) {
  const total = crawled + failed;
  const crawledPercent = total > 0 ? (crawled / total) * 100 : 0;
  return (
    <svg
      className="bar-svg"
      aria-hidden="true"
      viewBox="0 0 100 6"
      preserveAspectRatio="none"
      width="100%"
      height="0.375rem"
    >
      <rect x={0} y={0} width={100} height={6} fill="var(--color-line-soft)" />
      <rect
        x={0}
        y={0}
        width={crawledPercent}
        height={6}
        fill="var(--color-brand-500)"
      />
    </svg>
  );
}

export function CrawlSnapshotListPanel({
  snapshots,
  baseSnapshotId,
  currentSnapshotId,
  onSelectBase,
  onSelectCurrent,
  onDelete,
}: CrawlSnapshotListPanelProps) {
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

  useEffect(() => {
    setPendingDeleteId(null);
  }, [snapshots]);

  function handleDeleteClick(event: MouseEvent<HTMLButtonElement>, id: number) {
    if (pendingDeleteId === id) {
      setPendingDeleteId(null);
      onDelete(event, id);
    } else {
      setPendingDeleteId(id);
    }
  }

  if (snapshots.length === 0) {
    return (
      <p className="empty-state" data-testid="crawl-snapshot-list-empty">
        No stored crawl snapshots for this URL yet.
      </p>
    );
  }

  return (
    <div className="table-scroll">
      <table aria-label="Stored crawl snapshots">
        <thead>
          <tr>
            <th scope="col">Snapshot</th>
            <th scope="col">Label</th>
            <th scope="col">Captured</th>
            <th scope="col">Crawled / failed</th>
            <th scope="col">Base</th>
            <th scope="col">Current</th>
            <th scope="col">Delete</th>
          </tr>
        </thead>
        <tbody>
          {snapshots.map((snapshot) => (
            <tr key={snapshot.id}>
              <td>#{snapshot.id}</td>
              <td>{snapshot.label ?? "(no label)"}</td>
              <td>{snapshot.capturedAt}</td>
              <td>
                <span className="bar-cell">
                  <span className="cell-figure">
                    {snapshot.crawled} crawled, {snapshot.failed} failed
                  </span>
                  <CrawledFailedBar
                    crawled={snapshot.crawled}
                    failed={snapshot.failed}
                  />
                </span>
              </td>
              <td>
                <input
                  type="radio"
                  name="baseCrawlSnapshotId"
                  aria-label={`Use crawl snapshot #${snapshot.id} as base`}
                  checked={baseSnapshotId === snapshot.id}
                  onChange={() => onSelectBase(snapshot.id)}
                />
              </td>
              <td>
                <input
                  type="radio"
                  name="currentCrawlSnapshotId"
                  aria-label={`Use crawl snapshot #${snapshot.id} as current`}
                  checked={currentSnapshotId === snapshot.id}
                  onChange={() => onSelectCurrent(snapshot.id)}
                />
              </td>
              <td>
                <button
                  type="button"
                  className={
                    pendingDeleteId === snapshot.id
                      ? "btn-primary"
                      : "btn-ghost"
                  }
                  aria-label={`Delete crawl snapshot #${snapshot.id}`}
                  onClick={(event) => handleDeleteClick(event, snapshot.id)}
                >
                  {pendingDeleteId === snapshot.id
                    ? "Confirm delete?"
                    : "Delete"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
