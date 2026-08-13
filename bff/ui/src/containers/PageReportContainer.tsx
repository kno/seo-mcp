import { useRef, useState } from "react";
import type { FormEvent } from "react";
import type { PageAnalysis } from "../../../../src/types";
import { requestTool, userIntent } from "../data/client";
import { StateRegion } from "../molecules/StateRegion";
import type { RegionState } from "../molecules/StateRegion";
import { OnPageCard } from "../organisms/OnPageCard";
import { HeadingsPanel } from "../organisms/HeadingsPanel";
import { OpenGraphPanel } from "../organisms/OpenGraphPanel";
import { JsonLdPanel } from "../organisms/JsonLdPanel";
import { IssuesList } from "../organisms/IssuesList";
import { BrokenLinksContainer } from "./BrokenLinksContainer";

/**
 * Container for `page-report-view`. Owns the `crawl_page` request lifecycle
 * per `design.md`'s container/organism boundary: submit/AbortController/
 * requestId state lives here, and every organism below is a pure function
 * of the resolved `PageAnalysis`. Fetching is gated on the form's `submit`
 * event minting a `UserIntent` — there is no effect on mount, so the
 * "trigger discipline" requirement (no auto-fetch) holds by construction,
 * not by convention.
 *
 * `state` starts `null` (no request has ever been made) rather than a
 * synthetic "idle" `RegionState` phase, because `StateRegion` only models
 * loading/error/ready — the pre-submission form itself IS the idle state.
 *
 * `broken-links-view`'s spec requires the check-links control to exist "for
 * a URL that has never been link-checked" as soon as a page report is being
 * viewed for it — independent of whether `crawl_page` itself succeeds — so
 * `BrokenLinksContainer` renders once a URL has been submitted, keyed on
 * that URL so a new submission starts it fresh rather than reusing stale
 * state from a previous target.
 */
export function PageReportContainer() {
  const [state, setState] = useState<RegionState | null>(null);
  const [analysis, setAnalysis] = useState<PageAnalysis | null>(null);
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const intent = userIntent(event);
    const url = String(new FormData(event.currentTarget).get("url") ?? "");
    setPageUrl(url);

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestId = ++requestIdRef.current;

    setAnalysis(null);
    setState({ phase: "loading" });

    const result = await requestTool<PageAnalysis>(
      "crawl_page",
      { url },
      intent,
      { signal: controller.signal },
    );

    // A newer submission superseded this one; discard the stale resolution.
    if (requestId !== requestIdRef.current) return;

    if ("error" in result) {
      setState({ phase: "error", error: result.error });
      return;
    }

    setAnalysis(result.data);
    setState({
      phase: "ready",
      cardinality: { state: "complete", total: 1 },
    });
  }

  return (
    <div className="view-stack">
      <form
        className="toolbar"
        onSubmit={handleSubmit}
        aria-label="Page report request"
      >
        <div className="field-row">
          <div className="field field-url">
            <label htmlFor="page-report-url">Page URL</label>
            <input
              id="page-report-url"
              name="url"
              type="url"
              placeholder="https://example.com/page"
              required
            />
          </div>
          <div className="form-actions">
            <button className="btn-primary" type="submit">
              Get report
            </button>
          </div>
        </div>
      </form>

      {state && (
        <StateRegion label="Page report" state={state}>
          {analysis && (
            <div className="region-body">
              <OnPageCard
                title={analysis.title}
                description={analysis.description}
                canonical={analysis.canonical}
                robots={analysis.robots}
                lang={analysis.lang}
                indexable={analysis.indexable}
              />
              <HeadingsPanel
                h1={analysis.h1}
                h2={analysis.h2}
                h3={analysis.h3}
                internalLinks={analysis.internalLinks}
                externalLinks={analysis.externalLinks}
              />
              <OpenGraphPanel openGraph={analysis.openGraph} />
              <JsonLdPanel jsonLd={analysis.jsonLd} />
              <div className="panel">
                <h3>Content</h3>
                <dl className="stat-grid">
                  <div className="stat">
                    <dt>Word count</dt>
                    <dd data-testid="page-report-word-count">
                      {analysis.wordCount}
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="span-full">
                <IssuesList issues={analysis.issues} />
              </div>
            </div>
          )}
        </StateRegion>
      )}

      {pageUrl && <BrokenLinksContainer key={pageUrl} pageUrl={pageUrl} />}
    </div>
  );
}
