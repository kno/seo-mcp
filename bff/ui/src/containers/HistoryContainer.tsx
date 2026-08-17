import { useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import type { BffError } from "../../../src/errors";
import type {
  CompareCrawlsResult,
  CompareSearchConsoleResult,
  DeleteCrawlSnapshotResult,
  DeleteSearchConsoleSnapshotResult,
  ListCrawlSnapshotsResult,
  ListSearchConsoleSnapshotsResult,
  StoredCrawlSnapshot,
  StoredSnapshot,
} from "../../../../src/types";
import type { SourceFreshness } from "../../../src/authenticated/freshness";
import { requestTool, userIntent } from "../data/client";
import { StateRegion } from "../molecules/StateRegion";
import type { RegionState } from "../molecules/StateRegion";
import { SourceFreshnessBadge } from "../molecules/SourceFreshnessBadge";
import { SnapshotListPanel } from "../organisms/SnapshotListPanel";
import { SnapshotDiffPanel } from "../organisms/SnapshotDiffPanel";
import { CrawlSnapshotListPanel } from "../organisms/CrawlSnapshotListPanel";
import { CrawlDiffPanel } from "../organisms/CrawlDiffPanel";

/**
 * `history-comparison-view` (PR11) — the two sub-families (GSC-snapshot
 * history and crawl-snapshot history) ship and degrade INDEPENDENTLY (task
 * 11.7): each owns its own URL/property field and fetch state, so a user
 * with one family's history and zero of the other's sees a normal section
 * for the one they have and an honest EMPTY (not error) section for the
 * one they do not, in either direction.
 *
 * Two honesty requirements this container's copy enforces throughout
 * (design.md's confirmed findings — no server-side retention exists, no
 * scheduled crawl-snapshot path exists):
 *
 * - Retention is presented as UNBOUNDED AND ACCUMULATING (task 11.3): the
 *   `limit` parameter on the list tools is labelled a LISTING cap ("how
 *   many recent snapshots to show"), never a retention window. There is no
 *   rolling-90-day (or any) claim anywhere in this view.
 * - Crawl-snapshot capture is MANUAL ONLY (task 11.4): a user must
 *   explicitly trigger a capture. GSC snapshots MAY additionally
 *   accumulate via a scheduled job, but ONLY when the operator has
 *   configured `GSC_SNAPSHOT_PROPERTIES` — still not guaranteed. Crawl
 *   snapshots NEVER accumulate on their own; this view says so explicitly
 *   rather than leaving it ambiguous.
 *
 * `list_search_console_snapshots`/`compare_search_console` ARE
 * authenticated (the `AuthenticatedResponse` envelope, `sourceFreshness`
 * present); `snapshot_crawl`/`list_crawl_snapshots`/`compare_crawls` are
 * NOT (an ordinary `BffOk`, no `sourceFreshness` at all) — see
 * `authenticated/registry.ts`'s doc comment for why. This container reuses
 * `SnapshotListPanel`/`SnapshotDiffPanel` (PR6) for the GSC half rather
 * than rebuilding it, and ships sibling `CrawlSnapshotListPanel`/
 * `CrawlDiffPanel` organisms for the crawl half, since `CrawlDiff`'s bucket
 * shape is genuinely different from `GscDiff`'s (see `CrawlDiffPanel`'s own
 * doc comment) rather than a genericization of the same component.
 */
interface AuthenticatedResponse<T> {
  readonly data: T;
  readonly cacheStatus: string;
  readonly resultAge: number;
  readonly sourceFreshness: SourceFreshness;
}

type AuthenticatedResult<T> =
  AuthenticatedResponse<T> | { readonly error: BffError };

interface OrdinaryResponse<T> {
  readonly data: T;
  readonly cacheStatus: string;
  readonly resultAge: number;
}

type OrdinaryResult<T> = OrdinaryResponse<T> | { readonly error: BffError };

/** GSC-snapshot history section — reuses `list_search_console_snapshots`/
 * `compare_search_console` (authenticated) and PR6's own panels. */
function GscHistorySection() {
  const [siteUrl, setSiteUrl] = useState("");
  const [label, setLabel] = useState("");
  const [captureState, setCaptureState] = useState<RegionState | null>(null);
  const [captureInFlight, setCaptureInFlight] = useState(false);

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
  const [compareFreshness, setCompareFreshness] =
    useState<SourceFreshness | null>(null);
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

    const today = new Date().toISOString().slice(0, 10);
    const monthAgo = new Date(Date.now() - 28 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const args: Record<string, string> = {
      siteUrl,
      startDate: monthAgo,
      endDate: today,
    };
    if (label.trim() !== "") args.label = label.trim();

    const response = (await requestTool(
      "snapshot_search_console",
      args,
      intent,
      {
        signal: new AbortController().signal,
      },
    )) as unknown as AuthenticatedResult<unknown>;
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
    setCompareFreshness(response.sourceFreshness);
    setCompareState({
      phase: "ready",
      cardinality:
        totalRows === 0
          ? { state: "none" }
          : { state: "complete", total: totalRows },
    });
  }

  /**
   * Manual-snapshot-deletion follow-up. Called on the panel's SECOND
   * (confirmed) click. On success, removes the row from `snapshots` by
   * LOCAL splice (never an automatic re-fetch — see
   * `SnapshotListPanel`'s own doc comment for why the panel itself never
   * triggers a request); if the deleted id was one of the two selected for
   * an in-progress or just-shown comparison, that selection/comparison is
   * cleared too, rather than silently keeping a diff that references a
   * snapshot which no longer exists.
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
    )) as unknown as OrdinaryResult<DeleteSearchConsoleSnapshotResult>;

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
    <section className="view-stack" aria-label="Search Console history">
      <h3>Search Console history</h3>
      <p className="field-hint">
        GSC snapshots MAY accumulate automatically via a scheduled job, but ONLY
        when the operator has configured <code>GSC_SNAPSHOT_PROPERTIES</code>—
        this is not guaranteed for every property. Capturing one below is always
        available regardless.
      </p>
      <div className="field-row">
        <div className="field">
          <label htmlFor="gsc-history-site-url">
            Search Console site URL / property
          </label>
          <input
            id="gsc-history-site-url"
            type="text"
            value={siteUrl}
            onChange={(event) => setSiteUrl(event.currentTarget.value)}
          />
        </div>
      </div>

      <form
        className="toolbar"
        onSubmit={handleCapture}
        aria-label="Capture a Search Console snapshot"
      >
        <div className="field-row">
          <div className="field">
            <label htmlFor="gsc-history-label">Label (optional)</label>
            <input
              id="gsc-history-label"
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
        <div
          className="alert"
          role="alert"
          data-testid="gsc-history-list-error"
        >
          {listError.code}
        </div>
      )}

      {snapshots && (
        <div className="panel panel-wide span-full">
          <h4>
            Stored snapshots{" "}
            <span className="field-hint">
              (unbounded and accumulating — the listing cap below shows only how
              many recent snapshots are displayed, never how long they are kept)
            </span>
          </h4>
          <SnapshotListPanel
            snapshots={snapshots}
            baseSnapshotId={baseSnapshotId}
            currentSnapshotId={currentSnapshotId}
            onSelectBase={setBaseSnapshotId}
            onSelectCurrent={setCurrentSnapshotId}
            onDelete={handleDelete}
          />

          {needsOnboarding ? (
            <p className="empty-state" data-testid="gsc-history-onboarding">
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
        <StateRegion label="Search Console comparison" state={compareState}>
          {compareResult && (
            <div className="view-stack">
              {compareFreshness && (
                <SourceFreshnessBadge freshness={compareFreshness} />
              )}
              <SnapshotDiffPanel
                siteUrl={compareResult.siteUrl}
                baseSnapshotId={compareResult.baseSnapshotId}
                currentSnapshotId={compareResult.currentSnapshotId}
                diff={compareResult.diff}
                baseSnapshot={baseSnapshot}
                currentSnapshot={currentSnapshot}
              />
            </div>
          )}
        </StateRegion>
      )}
    </section>
  );
}

/** Crawl-snapshot history section — reuses `snapshot_crawl`/
 * `list_crawl_snapshots`/`compare_crawls` (NOT authenticated, see this
 * file's doc comment) and the sibling crawl organisms above. */
function CrawlHistorySection() {
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [captureState, setCaptureState] = useState<RegionState | null>(null);
  const [captureInFlight, setCaptureInFlight] = useState(false);

  const [snapshots, setSnapshots] = useState<
    readonly StoredCrawlSnapshot[] | null
  >(null);
  const [listError, setListError] = useState<BffError | null>(null);
  const [listInFlight, setListInFlight] = useState(false);

  const [baseSnapshotId, setBaseSnapshotId] = useState<number | null>(null);
  const [currentSnapshotId, setCurrentSnapshotId] = useState<number | null>(
    null,
  );

  const [compareState, setCompareState] = useState<RegionState | null>(null);
  const [compareResult, setCompareResult] =
    useState<CompareCrawlsResult | null>(null);
  const [compareInFlight, setCompareInFlight] = useState(false);

  async function refreshList(event: { readonly type: string }) {
    if (url.trim() === "" || listInFlight) return;
    setListInFlight(true);
    setListError(null);
    const intent = userIntent(event);
    const response = (await requestTool<ListCrawlSnapshotsResult>(
      "list_crawl_snapshots",
      { url },
      intent,
      { signal: new AbortController().signal },
    )) as unknown as OrdinaryResult<ListCrawlSnapshotsResult>;
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
    if (url.trim() === "" || captureInFlight) return;
    const intent = userIntent(event);
    setCaptureInFlight(true);
    setCaptureState({
      phase: "loading",
      detail: "Crawling — this can take a while…",
    });

    const args: Record<string, string> = { url };
    if (label.trim() !== "") args.label = label.trim();

    const response = (await requestTool("snapshot_crawl", args, intent, {
      signal: new AbortController().signal,
    })) as unknown as OrdinaryResult<unknown>;
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
    if (url.trim() === "" || compareInFlight) return;
    const intent = userIntent(event);
    setCompareInFlight(true);
    setCompareResult(null);
    setCompareState({ phase: "loading" });

    const args: Record<string, string | number> = { url };
    if (baseSnapshotId !== null && currentSnapshotId !== null) {
      args.baseSnapshotId = baseSnapshotId;
      args.currentSnapshotId = currentSnapshotId;
    }

    const response = (await requestTool<CompareCrawlsResult>(
      "compare_crawls",
      args,
      intent,
      { signal: new AbortController().signal },
    )) as unknown as OrdinaryResult<CompareCrawlsResult>;
    setCompareInFlight(false);

    if ("error" in response) {
      setCompareState({ phase: "error", error: response.error });
      return;
    }

    const { diff } = response.data;
    const totalRows =
      diff.newPages.length +
      diff.removedPages.length +
      diff.newIssues.length +
      diff.resolvedIssues.length;
    setCompareResult(response.data);
    setCompareState({
      phase: "ready",
      cardinality:
        totalRows === 0
          ? { state: "none" }
          : { state: "complete", total: totalRows },
    });
  }

  /** Mirrors `GscHistorySection#handleDelete` exactly — see that function's
   * own doc comment for the full reasoning (local splice, no auto-refetch,
   * and clearing a stale comparison/selection). */
  async function handleDelete(
    event: MouseEvent<HTMLButtonElement>,
    id: number,
  ) {
    const intent = userIntent(event);
    const response = (await requestTool<DeleteCrawlSnapshotResult>(
      "delete_crawl_snapshot",
      { snapshotId: id, confirm: true },
      intent,
      { signal: new AbortController().signal, postJson: true },
    )) as unknown as OrdinaryResult<DeleteCrawlSnapshotResult>;

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
    <section className="view-stack" aria-label="Crawl history">
      <h3>Crawl history</h3>
      <p className="field-hint">
        Crawl snapshots are captured MANUALLY ONLY — there is no scheduled
        crawl-snapshot job. Nothing here accumulates on its own; a person must
        explicitly capture a snapshot below.
      </p>
      <div className="field-row">
        <div className="field">
          <label htmlFor="crawl-history-url">Crawl site URL</label>
          <input
            id="crawl-history-url"
            type="text"
            value={url}
            onChange={(event) => setUrl(event.currentTarget.value)}
          />
        </div>
      </div>

      <form
        className="toolbar"
        onSubmit={handleCapture}
        aria-label="Capture a crawl snapshot"
      >
        <div className="field-row">
          <div className="field">
            <label htmlFor="crawl-history-label">Label (optional)</label>
            <input
              id="crawl-history-label"
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
            disabled={captureInFlight || url.trim() === ""}
          >
            Capture crawl snapshot
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={listInFlight || url.trim() === ""}
            onClick={(event) => refreshList(event)}
          >
            Refresh snapshot list
          </button>
        </div>
      </form>

      {captureState && (
        <StateRegion label="Crawl snapshot capture" state={captureState}>
          <p className="empty-state empty-state-ok" role="status">
            Crawl snapshot captured.
          </p>
        </StateRegion>
      )}

      {listError && (
        <div
          className="alert"
          role="alert"
          data-testid="crawl-history-list-error"
        >
          {listError.code}
        </div>
      )}

      {snapshots && (
        <div className="panel panel-wide span-full">
          <h4>
            Stored crawl snapshots{" "}
            <span className="field-hint">
              (unbounded and accumulating — the listing cap below shows only how
              many recent snapshots are displayed, never how long they are kept)
            </span>
          </h4>
          <CrawlSnapshotListPanel
            snapshots={snapshots}
            baseSnapshotId={baseSnapshotId}
            currentSnapshotId={currentSnapshotId}
            onSelectBase={setBaseSnapshotId}
            onSelectCurrent={setCurrentSnapshotId}
            onDelete={handleDelete}
          />

          {needsOnboarding ? (
            <p className="empty-state" data-testid="crawl-history-onboarding">
              {knownSnapshotCount === 0
                ? "No crawl snapshots stored yet. Capture one above before comparing."
                : "One more crawl snapshot is needed before a comparison is possible. Capture another above."}
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
        <StateRegion label="Crawl comparison" state={compareState}>
          {compareResult && (
            <CrawlDiffPanel
              url={compareResult.url}
              baseSnapshotId={compareResult.baseSnapshotId}
              currentSnapshotId={compareResult.currentSnapshotId}
              diff={compareResult.diff}
              baseSnapshot={baseSnapshot}
              currentSnapshot={currentSnapshot}
            />
          )}
        </StateRegion>
      )}
    </section>
  );
}

export function HistoryContainer() {
  return (
    <div className="view-stack">
      <p className="field-hint">
        Both histories below are independent: having snapshots for one source
        implies nothing about the other, and each renders its own empty/error
        state without affecting the other.
      </p>
      <GscHistorySection />
      <CrawlHistorySection />
    </div>
  );
}
