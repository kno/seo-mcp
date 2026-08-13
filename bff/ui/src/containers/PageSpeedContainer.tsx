import { useRef, useState } from "react";
import type { FormEvent } from "react";
import type { PageSpeedResult } from "../../../../src/pagespeed/types";
import { requestTool, userIntent } from "../data/client";
import { StateRegion } from "../molecules/StateRegion";
import type { RegionState } from "../molecules/StateRegion";
import { PageSpeedForm } from "../organisms/PageSpeedForm";
import type { PageSpeedFormInput } from "../organisms/PageSpeedForm";
import { ScorePanel } from "../organisms/ScorePanel";
import { LabMetricsPanel } from "../organisms/LabMetricsPanel";
import { FieldDataPanel } from "../organisms/FieldDataPanel";
import { OpportunitiesTable } from "../organisms/OpportunitiesTable";

/**
 * Container for `pagespeed-view`. Follows the same `{ controller, requestId
 * }` cancellation shape as `PageReportContainer`/`BrokenLinksContainer`/
 * `SiteCrawlContainer`. This is the ONLY container in the dashboard that
 * handles a secret: `input.apiKey` (a `SecretCell`, never a raw string —
 * see `organisms/PageSpeedForm.tsx`) is forwarded straight into
 * `requestTool`'s `secrets` option and this component never reads its
 * value itself. `result` — the only piece of async state this container
 * holds — is the `PageSpeedResult` envelope, which has no `apiKey` field
 * per `src/schemas/pagespeed.ts`, so there is structurally nothing here
 * that a re-render, a future export, or a client-side cache could leak the
 * key through. No `Map`/`useMemo` result cache exists here at all — every
 * submit is a real request, so a second submission with a different key
 * for the same URL is never served from a cache keyed by the first key.
 */
export function PageSpeedContainer() {
  const [state, setState] = useState<RegionState | null>(null);
  const [result, setResult] = useState<PageSpeedResult | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
    input: PageSpeedFormInput,
  ) {
    if (inFlight) return;
    const intent = userIntent(event);

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestId = ++requestIdRef.current;

    setResult(null);
    setInFlight(true);
    setState({ phase: "loading" });

    const response = await requestTool<PageSpeedResult>(
      "analyze_pagespeed",
      { url: input.url, strategy: input.strategy },
      intent,
      {
        signal: controller.signal,
        secrets: input.apiKey ? { apiKey: input.apiKey } : undefined,
      },
    );

    // A newer submission superseded this one; discard the stale resolution.
    if (requestId !== requestIdRef.current) return;

    setInFlight(false);

    if ("error" in response) {
      setState({ phase: "error", error: response.error });
      return;
    }

    setResult(response.data);
    setState({ phase: "ready", cardinality: { state: "complete", total: 1 } });
  }

  return (
    <div className="view-stack">
      <PageSpeedForm onSubmit={handleSubmit} disabled={inFlight} />

      {state && (
        <StateRegion label="PageSpeed analysis" state={state}>
          {result && (
            <div className="region-body">
              <div className="span-full">
                <ScorePanel
                  performanceScore={result.performanceScore}
                  accessibilityScore={result.accessibilityScore}
                  bestPracticesScore={result.bestPracticesScore}
                  seoScore={result.seoScore}
                />
              </div>
              <LabMetricsPanel labMetrics={result.labMetrics} />
              <FieldDataPanel fieldMetrics={result.fieldMetrics} />
              <div className="panel span-full">
                <h3>Opportunities</h3>
                <OpportunitiesTable opportunities={result.opportunities} />
              </div>
            </div>
          )}
        </StateRegion>
      )}
    </div>
  );
}
