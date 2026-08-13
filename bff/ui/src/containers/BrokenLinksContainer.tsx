import { useRef, useState } from "react";
import type { MouseEvent } from "react";
import type { LinkCheckResult } from "../../../../src/types";
import { requestTool, userIntent } from "../data/client";
import { StateRegion } from "../molecules/StateRegion";
import type { RegionState } from "../molecules/StateRegion";
import { BrokenLinksPanel } from "../organisms/BrokenLinksPanel";

/**
 * Container for `broken-links-view`. Per `design.md`: "`BrokenLinksContainer`
 * holds no auto-trigger at all: its only entry point is the 'Check links'
 * button handler." There is no `useEffect` here and no dependency on
 * `pageUrl` changing — mounting this component, or the page report loading
 * above it, never issues a `check_links` request. Fetching is gated on the
 * button's `click` event minting a `UserIntent`, following the same
 * submit/`AbortController`/`requestId` staleness-guard shape as
 * `PageReportContainer` so a stale in-flight resolution can never overwrite
 * a newer one.
 */
export interface BrokenLinksContainerProps {
  readonly pageUrl: string;
}

export function BrokenLinksContainer({ pageUrl }: BrokenLinksContainerProps) {
  const [state, setState] = useState<RegionState | null>(null);
  const [result, setResult] = useState<LinkCheckResult | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  async function handleCheckLinks(event: MouseEvent<HTMLButtonElement>) {
    const intent = userIntent(event);

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestId = ++requestIdRef.current;

    setResult(null);
    setState({ phase: "loading" });

    const response = await requestTool<LinkCheckResult>(
      "check_links",
      { url: pageUrl },
      intent,
      { signal: controller.signal },
    );

    // A newer activation superseded this one; discard the stale resolution.
    if (requestId !== requestIdRef.current) return;

    if ("error" in response) {
      setState({ phase: "error", error: response.error });
      return;
    }

    setResult(response.data);
    setState({
      phase: "ready",
      cardinality:
        response.data.checked === 0
          ? { state: "none" }
          : { state: "complete", total: response.data.checked },
    });
  }

  return (
    <div className="view-stack">
      <div className="toolbar toolbar-inline">
        <p className="panel-subtitle">
          Probe every outbound link on this page for 4xx/5xx and unreachable
          targets.
        </p>
        <div className="form-actions">
          <button type="button" onClick={handleCheckLinks}>
            Check links
          </button>
        </div>
      </div>

      {state && (
        <StateRegion label="Broken links" state={state}>
          {result && <BrokenLinksPanel result={result} />}
        </StateRegion>
      )}
    </div>
  );
}
