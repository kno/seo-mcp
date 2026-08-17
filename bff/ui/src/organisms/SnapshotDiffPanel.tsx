import { useId, useState } from "react";
import type {
  GscDiff,
  GscDiffRow,
  StoredSnapshot,
} from "../../../../src/types";
import {
  collectDiffBounds,
  isBounded,
  type DiffBucketName,
} from "../data/bounds";

/**
 * Renders a `compare_search_console` result (`gsc-insight-views`):
 *
 * - Names BOTH endpoints explicitly (task 6.4): `baseSnapshotId` and
 *   `currentSnapshotId`, each alongside its own label, stored date range,
 *   and `capturedAt` — looked up from `list_search_console_snapshots`
 *   (`baseSnapshot`/`currentSnapshot` props), since `compareSearchConsoleResultSchema`
 *   itself carries no date field at all.
 * - Each of the four buckets gets its own heading, color, and bound label
 *   (tasks 6.5/6.6) — `decayed` uses the decline treatment (`stat-warn`),
 *   `improved` the improvement treatment (`stat-ok`), `lost` its own
 *   distinct treatment (`stat-danger`, NOT the same as `decayed`), and
 *   `gained` its own distinct treatment (`stat-info`, NOT the same as
 *   `improved`) — matching `BrokenLinksPanel`'s color-by-meaning
 *   convention.
 * - A `lost` row (`current: null`) is labelled "no longer appears in the
 *   current data", and a `gained` row (`base: null`) is labelled "new in
 *   the current data" — neither renders its missing side's metrics as `0`.
 * - `capturedAt` on each side IS the "as-of" fact for this comparison (task
 *   6.8): "the moment the underlying Search Console data was captured into
 *   D1, not the moment the comparison was computed" (`gsc-insight-views`
 *   spec). This is a distinct mechanism from the derived GSC-lag
 *   `SourceFreshness` the other four tools in this view use.
 */
export interface SnapshotDiffPanelProps {
  readonly siteUrl: string;
  readonly baseSnapshotId: number;
  readonly currentSnapshotId: number;
  readonly diff: GscDiff;
  readonly baseSnapshot?: StoredSnapshot;
  readonly currentSnapshot?: StoredSnapshot;
}

const BUCKET_META: Record<
  DiffBucketName,
  {
    readonly heading: string;
    readonly statClass: string;
    readonly nullSide: "base" | "current" | null;
  }
> = {
  decayed: {
    heading: "Decayed — clicks fell or position worsened",
    statClass: "stat-warn",
    nullSide: null,
  },
  improved: {
    heading: "Improved — clicks rose or position improved",
    statClass: "stat-ok",
    nullSide: null,
  },
  lost: {
    heading: "Lost — no longer appears in the current data",
    statClass: "stat-danger",
    nullSide: "current",
  },
  gained: {
    heading: "Gained — new in the current data",
    statClass: "stat-info",
    nullSide: "base",
  },
};

function describeSnapshotEndpoint(
  id: number,
  snapshot: StoredSnapshot | undefined,
): string {
  if (!snapshot) return `Snapshot #${id}`;
  const label = snapshot.label ?? "(no label)";
  return `Snapshot #${id} — ${label} — ${snapshot.startDate} to ${snapshot.endDate}, captured ${snapshot.capturedAt}`;
}

function DiffRowItem({
  row,
  nullSide,
}: {
  readonly row: GscDiffRow;
  readonly nullSide: "base" | "current" | null;
}) {
  return (
    <li className="item-row">
      <div>
        <p className="cell-url">
          {row.query} — {row.page}
        </p>
        {nullSide === "current" && (
          <p className="field-hint" data-testid="diff-row-lost-note">
            No current-period data — not the same as zero metrics.
          </p>
        )}
        {nullSide === "base" && (
          <p className="field-hint" data-testid="diff-row-gained-note">
            No base-period data — new to the current data, not "0 to N".
          </p>
        )}
        {nullSide === null && (
          <p className="field-hint">
            clicks {row.clicksDelta >= 0 ? "+" : ""}
            {row.clicksDelta}, impressions{" "}
            {row.impressionsDelta >= 0 ? "+" : ""}
            {row.impressionsDelta}, position {row.positionDelta >= 0 ? "+" : ""}
            {row.positionDelta.toFixed(1)}
          </p>
        )}
      </div>
    </li>
  );
}

function DiffBucketSection({
  name,
  rows,
  pageFilter,
}: {
  readonly name: DiffBucketName;
  /** The bucket's FULL, unfiltered rows — the bound label is always
   * derived from this, never from `pageFilter`'s narrowed view, so typing
   * a filter can never fabricate a bound that was never real (task 6.6's
   * per-bucket-only guarantee extends to the filtered display). */
  readonly rows: readonly GscDiffRow[];
  readonly pageFilter: string;
}) {
  const meta = BUCKET_META[name];
  const bounds = collectDiffBounds({
    decayed: name === "decayed" ? rows : [],
    improved: name === "improved" ? rows : [],
    lost: name === "lost" ? rows : [],
    gained: name === "gained" ? rows : [],
  });
  const cardinality = bounds[name];
  const normalizedFilter = pageFilter.trim().toLowerCase();
  const displayRows = normalizedFilter
    ? rows.filter((row) => row.page.toLowerCase().includes(normalizedFilter))
    : rows;

  return (
    <section
      className={`panel ${meta.statClass}`}
      aria-label={`${name} queries`}
      data-testid={`diff-bucket-${name}`}
    >
      <h4>{meta.heading}</h4>
      {isBounded(cardinality) && (
        <p
          className="bound-indicator"
          data-testid={`diff-bucket-bound-${name}`}
        >
          Showing {cardinality.bound.shown} of a maximum{" "}
          {cardinality.bound.limitValue} ({cardinality.bound.limitName}) for
          this bucket only — other buckets are not implied to be at their own
          cap.
        </p>
      )}
      {displayRows.length === 0 ? (
        <p className="empty-state">
          No {name} queries.{normalizedFilter ? " (filtered by page)" : ""}
        </p>
      ) : (
        <ul className="item-list" aria-label={`${name} rows`}>
          {displayRows.map((row, index) => (
            <DiffRowItem
              key={`${row.query}|${row.page}|${index}`}
              row={row}
              nullSide={meta.nullSide}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export function SnapshotDiffPanel({
  baseSnapshotId,
  currentSnapshotId,
  diff,
  baseSnapshot,
  currentSnapshot,
}: SnapshotDiffPanelProps) {
  const [pageFilter, setPageFilter] = useState("");
  const filterId = useId();

  return (
    <div className="panel panel-wide span-full">
      <h3>Comparison</h3>
      <p data-testid="diff-endpoints">
        Base: {describeSnapshotEndpoint(baseSnapshotId, baseSnapshot)}
        {" → "}
        Current: {describeSnapshotEndpoint(currentSnapshotId, currentSnapshot)}
      </p>
      <div className="field-row" role="group" aria-label="Comparison periods">
        <span className="source-freshness-badge" data-testid="diff-base-as-of">
          Base as of {baseSnapshot?.capturedAt ?? "unknown"}
        </span>
        <span
          className="source-freshness-badge"
          data-testid="diff-current-as-of"
        >
          Current as of {currentSnapshot?.capturedAt ?? "unknown"}
        </span>
      </div>

      <div className="field">
        <label htmlFor={filterId}>Filter by page</label>
        <input
          id={filterId}
          type="text"
          value={pageFilter}
          onChange={(event) => setPageFilter(event.target.value)}
          placeholder="e.g. https://as-jardineria.com/"
        />
        <p className="field-hint">
          Narrows all four buckets below to rows whose page contains this text —
          a client-side view of the same comparison, not a new request. Bound
          labels still reflect each bucket's real, unfiltered size.
        </p>
      </div>

      <div className="view-stack">
        <DiffBucketSection
          name="decayed"
          rows={diff.decayed}
          pageFilter={pageFilter}
        />
        <DiffBucketSection
          name="improved"
          rows={diff.improved}
          pageFilter={pageFilter}
        />
        <DiffBucketSection
          name="lost"
          rows={diff.lost}
          pageFilter={pageFilter}
        />
        <DiffBucketSection
          name="gained"
          rows={diff.gained}
          pageFilter={pageFilter}
        />
      </div>
    </div>
  );
}
