import { useRef, useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import type { BffError, BffOk } from "../../../src/errors";
import type {
  CompareSearchConsoleResult,
  DeleteSearchConsoleSnapshotResult,
  ListSearchConsoleSnapshotsResult,
  OpportunityResult,
  SnapshotSearchConsoleResult,
  StoredSnapshot,
} from "../../../../src/types";
import type { SourceFreshness } from "../../../src/authenticated/freshness";
import { requestTool, userIntent } from "../data/client";
import { StateRegion } from "../molecules/StateRegion";
import type { RegionState } from "../molecules/StateRegion";
import { SourceFreshnessBadge } from "../molecules/SourceFreshnessBadge";
import { GscSharedSelector } from "../organisms/GscSharedSelector";
import {
  OpportunityCriteriaForm,
  type OpportunityCriteriaInput,
  type OpportunityToolName,
} from "../organisms/OpportunityCriteriaForm";
import { OpportunityResultPanel } from "../organisms/OpportunityResultPanel";
import { SnapshotListPanel } from "../organisms/SnapshotListPanel";
import { SnapshotDiffPanel } from "../organisms/SnapshotDiffPanel";
import { describeOpportunityBound } from "../data/bounds";
import { useActiveSite } from "../app/SiteContext";

/**
 * Container for `gsc-insight-views` — five tools across three sub-tools
 * (striking-distance, low-CTR, snapshot management + comparison), sharing
 * one property/date-range selector per task 6.1. Every authenticated
 * response here carries the same `sourceFreshness`/`quota` envelope shape
 * `SearchConsoleContainer` already established
 * (`bff/src/router.ts#authenticatedToolResponse`); `quota` is not rendered
 * here either, matching that view's precedent.
 */
interface AuthenticatedResponse<T> {
  readonly data: T;
  readonly cacheStatus: BffOk<T>["cacheStatus"];
  readonly resultAge: number;
  readonly sourceFreshness: SourceFreshness;
}

type AuthenticatedResult<T> =
  AuthenticatedResponse<T> | { readonly error: BffError };

const DEFAULT_RANGE_DAYS = 28;

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function subtractDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() - days);
  return copy;
}

type Tab = "striking-distance" | "low-ctr" | "snapshots";

const TABS: ReadonlyArray<{ readonly id: Tab; readonly label: string }> = [
  { id: "striking-distance", label: "Striking-distance keywords" },
  { id: "low-ctr", label: "Low-CTR opportunities" },
  { id: "snapshots", label: "Snapshots & comparison" },
];

/** Shared by both opportunity sub-tools — each owns its own request/result
 * state so switching tabs never loses (or mixes up) the other tool's last
 * result, while the siteUrl/date-range values passed in stay shared. */
function OpportunityTab({
  tool,
  siteUrl,
  startDate,
  endDate,
}: {
  readonly tool: OpportunityToolName;
  readonly siteUrl: string;
  readonly startDate: string;
  readonly endDate: string;
}) {
  const [state, setState] = useState<RegionState | null>(null);
  const [result, setResult] = useState<OpportunityResult | null>(null);
  const [freshness, setFreshness] = useState<SourceFreshness | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
    input: OpportunityCriteriaInput,
  ) {
    if (inFlight || siteUrl.trim() === "") return;
    const intent = userIntent(event);

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestId = ++requestIdRef.current;

    setResult(null);
    setFreshness(null);
    setInFlight(true);
    setState({ phase: "loading" });

    const args: Record<string, string | number> = {
      siteUrl,
      startDate,
      endDate,
    };
    if (input.minPosition !== undefined) args.minPosition = input.minPosition;
    if (input.maxPosition !== undefined) args.maxPosition = input.maxPosition;
    if (input.minImpressions !== undefined)
      args.minImpressions = input.minImpressions;
    if (input.maxCtr !== undefined) args.maxCtr = input.maxCtr;
    if (input.limit !== undefined) args.limit = input.limit;

    const response = (await requestTool<OpportunityResult>(tool, args, intent, {
      signal: controller.signal,
    })) as unknown as AuthenticatedResult<OpportunityResult>;

    if (requestId !== requestIdRef.current) return;
    setInFlight(false);

    if ("error" in response) {
      setState({ phase: "error", error: response.error });
      return;
    }

    setResult(response.data);
    setFreshness(response.sourceFreshness);
    setState({
      phase: "ready",
      cardinality: describeOpportunityBound(response.data),
    });
  }

  return (
    <div className="view-stack">
      <OpportunityCriteriaForm
        tool={tool}
        siteUrl={siteUrl}
        onSubmit={handleSubmit}
        disabled={inFlight}
      />
      {state && (
        <StateRegion
          label={
            tool === "find_striking_distance_keywords"
              ? "Striking-distance keywords"
              : "Low-CTR opportunities"
          }
          state={state}
        >
          {result && freshness && (
            <div className="region-body">
              <div
                className="field-row"
                role="group"
                aria-label="Result freshness"
              >
                <SourceFreshnessBadge freshness={freshness} />
              </div>
              <OpportunityResultPanel result={result} />
            </div>
          )}
        </StateRegion>
      )}
    </div>
  );
}

/** Snapshot capture + list + comparison. Owns its own fetch state for each
 * of the three D1-backed tools; the list is re-used both for display and
 * as the lookup that enriches a comparison's raw snapshot ids into
 * human-meaningful labels/date ranges (task 6.4) and per-period as-of
 * markers (task 6.8). */
function SnapshotsTab({
  siteUrl,
  startDate,
  endDate,
}: {
  readonly siteUrl: string;
  readonly startDate: string;
  readonly endDate: string;
}) {
  const [captureState, setCaptureState] = useState<RegionState | null>(null);
  const [captureInFlight, setCaptureInFlight] = useState(false);
  const [label, setLabel] = useState("");

  const [snapshots, setSnapshots] = useState<readonly StoredSnapshot[] | null>(
    null,
  );
  const [listError, setListError] = useState<BffError | null>(null);
  const [listInFlight, setListInFlight] = useState(false);

  const [baseSnapshotId, setBaseSnapshotId] = useState<number | null>(null);
  const [currentSnapshotId, setCurrentSnapshotId] = useState<number | null>(
    null,
  );

  const [compareState, setCompareState] = useState<RegionState | null>(null);
  const [compareResult, setCompareResult] =
    useState<CompareSearchConsoleResult | null>(null);
  const [compareInFlight, setCompareInFlight] = useState(false);

  async function refreshList(event: { readonly type: string }) {
    if (siteUrl.trim() === "" || listInFlight) return;
    setListInFlight(true);
    setListError(null);
    const intent = userIntent(event);
    const response = (await requestTool<ListSearchConsoleSnapshotsResult>(
      "list_search_console_snapshots",
      { siteUrl },
      intent,
      { signal: new AbortController().signal },
    )) as unknown as AuthenticatedResult<ListSearchConsoleSnapshotsResult>;
    setListInFlight(false);
    if ("error" in response) {
      setListError(response.error);
      setSnapshots(null);
      return;
    }
    setSnapshots(response.data.snapshots);
  }

  async function handleCapture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (siteUrl.trim() === "" || captureInFlight) return;
    const intent = userIntent(event);
    setCaptureInFlight(true);
    setCaptureState({ phase: "loading" });

    const args: Record<string, string> = { siteUrl, startDate, endDate };
    if (label.trim() !== "") args.label = label.trim();

    const response = (await requestTool<SnapshotSearchConsoleResult>(
      "snapshot_search_console",
      args,
      intent,
      { signal: new AbortController().signal },
    )) as unknown as AuthenticatedResult<SnapshotSearchConsoleResult>;
    setCaptureInFlight(false);

    if ("error" in response) {
      setCaptureState({ phase: "error", error: response.error });
      return;
    }
    setCaptureState({
      phase: "ready",
      cardinality: { state: "complete", total: 1 },
    });
    await refreshList(event);
  }

  async function handleCompare(event: { readonly type: string }) {
    if (siteUrl.trim() === "" || compareInFlight) return;
    const intent = userIntent(event);
    setCompareInFlight(true);
    setCompareResult(null);
    setCompareState({ phase: "loading" });

    const args: Record<string, string | number> = { siteUrl };
    if (baseSnapshotId !== null && currentSnapshotId !== null) {
      args.baseSnapshotId = baseSnapshotId;
      args.currentSnapshotId = currentSnapshotId;
    }

    const response = (await requestTool<CompareSearchConsoleResult>(
      "compare_search_console",
      args,
      intent,
      { signal: new AbortController().signal },
    )) as unknown as AuthenticatedResult<CompareSearchConsoleResult>;
    setCompareInFlight(false);

    if ("error" in response) {
      setCompareState({ phase: "error", error: response.error });
      return;
    }

    const { diff } = response.data;
    const totalRows =
      diff.decayed.length +
      diff.improved.length +
      diff.lost.length +
      diff.gained.length;
    setCompareResult(response.data);
    setCompareState({
      phase: "ready",
      cardinality:
        totalRows === 0
          ? { state: "none" }
          : { state: "complete", total: totalRows },
    });
  }

  /**
   * Manual-snapshot-deletion follow-up. `delete_search_console_snapshot` is
   * NOT authenticated (pure D1 mutation, `bff/src/timeout.ts`'s doc
   * comment), so its response carries no `sourceFreshness` — a plain
   * `BffOk<T>` rather than `AuthenticatedResult<T>`. On success, removes
   * the row from `snapshots` by LOCAL splice (the panel itself never
   * triggers a request — see `SnapshotListPanel`'s own doc comment) and
   * clears the base/current selection and any in-progress/shown comparison
   * that referenced the deleted id, rather than silently keeping a diff
   * that references a snapshot which no longer exists.
   */
  async function handleDelete(
    event: MouseEvent<HTMLButtonElement>,
    id: number,
  ) {
    const intent = userIntent(event);
    const response = (await requestTool<DeleteSearchConsoleSnapshotResult>(
      "delete_search_console_snapshot",
      { snapshotId: id, confirm: true },
      intent,
      { signal: new AbortController().signal, postJson: true },
    )) as unknown as
      BffOk<DeleteSearchConsoleSnapshotResult> | { readonly error: BffError };

    if ("error" in response || !response.data.deleted) return;

    setSnapshots((prev) => prev?.filter((s) => s.id !== id) ?? prev);
    if (baseSnapshotId === id) setBaseSnapshotId(null);
    if (currentSnapshotId === id) setCurrentSnapshotId(null);
    if (
      compareResult &&
      (compareResult.baseSnapshotId === id ||
        compareResult.currentSnapshotId === id)
    ) {
      setCompareResult(null);
      setCompareState(null);
    }
  }

  const knownSnapshotCount = snapshots?.length ?? null;
  const needsOnboarding = knownSnapshotCount !== null && knownSnapshotCount < 2;

  const baseSnapshot = snapshots?.find(
    (snapshot) => snapshot.id === compareResult?.baseSnapshotId,
  );
  const currentSnapshot = snapshots?.find(
    (snapshot) => snapshot.id === compareResult?.currentSnapshotId,
  );

  return (
    <div className="view-stack">
      <form
        className="toolbar"
        onSubmit={handleCapture}
        aria-label="Capture a Search Console snapshot"
      >
        <div className="field-row">
          <div className="field">
            <label htmlFor="gsc-snapshot-label">Label (optional)</label>
            <input
              id="gsc-snapshot-label"
              type="text"
              value={label}
              onChange={(event) => setLabel(event.currentTarget.value)}
            />
          </div>
        </div>
        <div className="form-actions">
          <button
            className="btn-primary"
            type="submit"
            disabled={captureInFlight || siteUrl.trim() === ""}
          >
            Capture snapshot
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={listInFlight || siteUrl.trim() === ""}
            onClick={(event) => refreshList(event)}
          >
            Refresh snapshot list
          </button>
        </div>
      </form>

      {captureState && (
        <StateRegion label="Snapshot capture" state={captureState}>
          <p className="empty-state empty-state-ok" role="status">
            Snapshot captured.
          </p>
        </StateRegion>
      )}

      {listError && (
        <div className="alert" role="alert" data-testid="snapshot-list-error">
          {listError.code}
        </div>
      )}

      {snapshots && (
        <div className="panel panel-wide span-full">
          <h3>Stored snapshots</h3>
          <SnapshotListPanel
            snapshots={snapshots}
            baseSnapshotId={baseSnapshotId}
            currentSnapshotId={currentSnapshotId}
            onSelectBase={setBaseSnapshotId}
            onSelectCurrent={setCurrentSnapshotId}
            onDelete={handleDelete}
          />

          {needsOnboarding ? (
            <p className="empty-state" data-testid="snapshot-onboarding">
              {knownSnapshotCount === 0
                ? "No snapshots stored yet. Capture a snapshot above before comparing."
                : "One more snapshot is needed before a comparison is possible. Capture another snapshot above."}
            </p>
          ) : (
            <div className="form-actions">
              <button
                type="button"
                className="btn-primary"
                disabled={compareInFlight}
                onClick={(event) => handleCompare(event)}
              >
                Compare
                {baseSnapshotId !== null && currentSnapshotId !== null
                  ? ` snapshot #${baseSnapshotId} vs #${currentSnapshotId}`
                  : " two most recent snapshots"}
              </button>
            </div>
          )}
        </div>
      )}

      {compareState && (
        <StateRegion label="Snapshot comparison" state={compareState}>
          {compareResult && (
            <SnapshotDiffPanel
              siteUrl={compareResult.siteUrl}
              baseSnapshotId={compareResult.baseSnapshotId}
              currentSnapshotId={compareResult.currentSnapshotId}
              diff={compareResult.diff}
              baseSnapshot={baseSnapshot}
              currentSnapshot={currentSnapshot}
            />
          )}
        </StateRegion>
      )}
    </div>
  );
}

export function GscInsightsContainer() {
  const activeSite = useActiveSite();
  const [siteUrl, setSiteUrl] = useState(() => activeSite ?? "");
  const [startDate, setStartDate] = useState(() =>
    toDateOnly(subtractDays(new Date(), DEFAULT_RANGE_DAYS)),
  );
  const [endDate, setEndDate] = useState(() => toDateOnly(new Date()));
  const [activeTab, setActiveTab] = useState<Tab>("striking-distance");

  return (
    <div className="view-stack">
      <GscSharedSelector
        siteUrl={siteUrl}
        startDate={startDate}
        endDate={endDate}
        onSiteUrlChange={setSiteUrl}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        disabled={false}
      />

      <div
        role="tablist"
        aria-label="Search Console insight tool"
        className="toolbar field-row"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? "btn-primary" : "btn-ghost"}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "striking-distance" && (
        <OpportunityTab
          tool="find_striking_distance_keywords"
          siteUrl={siteUrl}
          startDate={startDate}
          endDate={endDate}
        />
      )}
      {activeTab === "low-ctr" && (
        <OpportunityTab
          tool="find_low_ctr_opportunities"
          siteUrl={siteUrl}
          startDate={startDate}
          endDate={endDate}
        />
      )}
      {activeTab === "snapshots" && (
        <SnapshotsTab
          siteUrl={siteUrl}
          startDate={startDate}
          endDate={endDate}
        />
      )}
    </div>
  );
}
