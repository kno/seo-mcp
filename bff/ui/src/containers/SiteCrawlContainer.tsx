import { useRef, useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import type { SiteCrawlResult, SitePageAnalysis } from "../../../../src/types";
import { LIMITS } from "../../../../src/config";
import { requestTool, userIntent } from "../data/client";
import { describeOutputBytes } from "../data/bounds";
import { StateRegion } from "../molecules/StateRegion";
import type { RegionState } from "../molecules/StateRegion";
import { CrawlForm } from "../organisms/CrawlForm";
import type { CrawlFormInput } from "../organisms/CrawlForm";
import { DomainSummaryPanel } from "../organisms/DomainSummaryPanel";
import { CrawlPolicyPanel } from "../organisms/CrawlPolicyPanel";
import { LinkGraphPanel } from "../organisms/LinkGraphPanel";
import { PerPageTable } from "../organisms/PerPageTable";
import { OnPageCard } from "../organisms/OnPageCard";
import { HeadingsPanel } from "../organisms/HeadingsPanel";
import { OpenGraphPanel } from "../organisms/OpenGraphPanel";
import { JsonLdPanel } from "../organisms/JsonLdPanel";
import { IssuesList } from "../organisms/IssuesList";
import { takePendingDrillDown } from "../app/navigation";

/**
 * Container for `site-crawl-view`. Follows `PageReportContainer`'s and
 * `BrokenLinksContainer`'s `{ controller, requestId }` cancellation shape,
 * with one deliberate difference the spec requires for this view alone
 * ("Resubmission is blocked while a crawl is in flight"): `inFlight` is
 * real React state passed to `CrawlForm` as `disabled`, so the submit
 * control is actually disabled for the duration of a pending request — not
 * just guarded after the fact by discarding a stale response via
 * `requestId`. A second, container-owned `if (inFlight) return` guard
 * covers the case a caller somehow invokes `handleSubmit` without going
 * through the disabled control.
 *
 * Drill-down (`PerPageTable`'s "View report" action) renders the SAME
 * presentational organisms `page-report-view` uses (`OnPageCard`,
 * `HeadingsPanel`, `OpenGraphPanel`, `JsonLdPanel`, `IssuesList`) fed
 * directly from the crawl result's own already-in-memory per-page
 * `result` — never through `PageReportContainer` (which owns its own
 * `crawl_page` fetch) and never issuing a new request.
 */
export function SiteCrawlContainer() {
  const [state, setState] = useState<RegionState | null>(null);
  const [result, setResult] = useState<SiteCrawlResult | null>(null);
  const [drillDown, setDrillDown] = useState<SitePageAnalysis | null>(null);
  const [inFlight, setInFlight] = useState(false);
  // `seo-intelligence-view`'s (PR10) drill-down (task 10.11) — consumed
  // exactly once, at mount; see `CrawlFormProps.initialUrl`'s doc comment.
  const [initialUrl] = useState(() => takePendingDrillDown("site-crawl") ?? "");
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement>,
    input: CrawlFormInput,
  ) {
    if (inFlight) return;
    const intent = userIntent(event);

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestId = ++requestIdRef.current;

    setResult(null);
    setDrillDown(null);
    setInFlight(true);
    setState({
      phase: "loading",
      detail:
        "Crawl in progress… this can take up to ~40 seconds for larger requests.",
    });

    const response = await requestTool<SiteCrawlResult>(
      "crawl_site",
      { url: input.url, limit: input.limit, concurrency: input.concurrency },
      intent,
      { signal: controller.signal },
    );

    // A newer submission superseded this one; discard the stale resolution.
    if (requestId !== requestIdRef.current) return;

    setInFlight(false);

    if ("error" in response) {
      setState({ phase: "error", error: response.error });
      return;
    }

    setResult(response.data);

    const outputBytesBound = describeOutputBytes(
      response.data,
      LIMITS.maxSiteOutputBytes,
    );

    setState({
      phase: "ready",
      cardinality:
        response.data.pages.length === 0
          ? { state: "none" }
          : outputBytesBound
            ? { state: "bounded", bound: outputBytesBound }
            : { state: "complete", total: response.data.pages.length },
    });
  }

  function handleDrillDown(pageResult: SitePageAnalysis) {
    setDrillDown(pageResult);
  }

  return (
    <div className="view-stack">
      <CrawlForm
        onSubmit={handleSubmit}
        disabled={inFlight}
        initialUrl={initialUrl}
      />

      {state && (
        <StateRegion label="Site crawl" state={state}>
          {result && (
            <div className="region-body">
              <DomainSummaryPanel summary={result.summary} />
              <CrawlPolicyPanel crawlPolicy={result.crawlPolicy} />
              <div className="span-full">
                <LinkGraphPanel linkGraph={result.linkGraph} />
              </div>
              <div className="panel panel-wide span-full">
                <h3>Per-page results</h3>
                <PerPageTable
                  pages={result.pages}
                  onDrillDown={handleDrillDown}
                />
              </div>
            </div>
          )}
        </StateRegion>
      )}

      {drillDown && (
        <section className="drawer" aria-label="Drill-down page report">
          <div className="drawer-head">
            <h2>Page detail</h2>
            <button
              className="btn-ghost"
              type="button"
              onClick={() => setDrillDown(null)}
            >
              Close
            </button>
          </div>
          <OnPageCard
            title={drillDown.title}
            description={drillDown.description}
            canonical={drillDown.canonical}
            robots={drillDown.robots}
            lang={drillDown.lang}
            indexable={drillDown.indexable}
          />
          <HeadingsPanel
            h1={drillDown.h1}
            h2={drillDown.h2}
            h3={drillDown.h3}
            internalLinks={drillDown.internalLinks}
            externalLinks={drillDown.externalLinks}
          />
          <div className="section-grid">
            <OpenGraphPanel openGraph={drillDown.openGraph} />
            <JsonLdPanel jsonLd={drillDown.jsonLd} />
          </div>
          <IssuesList issues={drillDown.issues} />
        </section>
      )}
    </div>
  );
}
