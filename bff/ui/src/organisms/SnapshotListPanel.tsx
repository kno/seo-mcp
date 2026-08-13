import type { StoredSnapshot } from "../../../../src/types";

/**
 * Renders `list_search_console_snapshots`' `StoredSnapshot[]`, most-recent
 * first (per the tool's own contract). Two roles this component plays for
 * `gsc-insight-views`:
 *
 * - It is the lookup `GscInsightsContainer` uses to enrich a comparison's
 *   raw `baseSnapshotId`/`currentSnapshotId` into a human-meaningful label
 *   and date range (task 6.4) — this list is the ONLY source of that
 *   metadata, since `compareSearchConsoleResultSchema` carries no date
 *   field at all.
 * - It lets a user explicitly pick a base/current pair
 *   (`gsc-insight-views` spec, "An explicit snapshot pair overrides the
 *   two-most-recent default") — two independent radio groups, so a
 *   half-picked pair (only one side chosen) is visibly incomplete rather
 *   than silently substituting the default for the other side.
 */
export interface SnapshotListPanelProps {
  readonly snapshots: readonly StoredSnapshot[];
  readonly baseSnapshotId: number | null;
  readonly currentSnapshotId: number | null;
  readonly onSelectBase: (id: number) => void;
  readonly onSelectCurrent: (id: number) => void;
}

export function SnapshotListPanel({
  snapshots,
  baseSnapshotId,
  currentSnapshotId,
  onSelectBase,
  onSelectCurrent,
}: SnapshotListPanelProps) {
  if (snapshots.length === 0) {
    return (
      <p className="empty-state" data-testid="snapshot-list-empty">
        No stored snapshots for this property yet.
      </p>
    );
  }

  return (
    <div className="table-scroll">
      <table aria-label="Stored Search Console snapshots">
        <thead>
          <tr>
            <th scope="col">Snapshot</th>
            <th scope="col">Label</th>
            <th scope="col">Date range</th>
            <th scope="col">Captured</th>
            <th scope="col">Base</th>
            <th scope="col">Current</th>
          </tr>
        </thead>
        <tbody>
          {snapshots.map((snapshot) => (
            <tr key={snapshot.id}>
              <td>#{snapshot.id}</td>
              <td>{snapshot.label ?? "(no label)"}</td>
              <td>
                {snapshot.startDate} to {snapshot.endDate}
              </td>
              <td>{snapshot.capturedAt}</td>
              <td>
                <input
                  type="radio"
                  name="baseSnapshotId"
                  aria-label={`Use snapshot #${snapshot.id} as base`}
                  checked={baseSnapshotId === snapshot.id}
                  onChange={() => onSelectBase(snapshot.id)}
                />
              </td>
              <td>
                <input
                  type="radio"
                  name="currentSnapshotId"
                  aria-label={`Use snapshot #${snapshot.id} as current`}
                  checked={currentSnapshotId === snapshot.id}
                  onChange={() => onSelectCurrent(snapshot.id)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
