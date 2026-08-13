import { useRef, useState } from "react";
import type { FormEvent } from "react";
import type { BffError, BffOk } from "../../../src/errors";
import type { GscQueryResult } from "../../../../src/types";
import type { SourceFreshness } from "../../../src/authenticated/freshness";
import { requestTool, userIntent } from "../data/client";
import { StateRegion } from "../molecules/StateRegion";
import type { RegionState } from "../molecules/StateRegion";
import { FreshnessBadge } from "../molecules/FreshnessBadge";
import {
  describeSourceFreshness,
  SourceFreshnessBadge,
} from "../molecules/SourceFreshnessBadge";
import { ExportMenu } from "../molecules/ExportMenu";
import { SearchConsoleForm } from "../organisms/SearchConsoleForm";
import type { SearchConsoleFormInput } from "../organisms/SearchConsoleForm";
import { SearchConsoleTable } from "../organisms/SearchConsoleTable";
import { LIMITS } from "../../../../src/config";
import { describeGscRows, collectBounds } from "../data/bounds";
import { buildJsonExport, serializeJsonExport } from "../export/json";
import { CSV_SHAPES, serializeCsv } from "../export/csv";

/**
 * Container for `search-console-view`. Follows the same
 * `{ controller, requestId }` cancellation shape every other container
 * uses (`SiteCrawlContainer`/`PageSpeedContainer`). Differs from every
 * prior container in one way: the BFF's authenticated-route envelope
 * (`bff/src/router.ts#authenticatedToolResponse`) adds `sourceFreshness`
 * (and `quota`, not rendered by this view — `search-console-view`'s spec
 * names no requirement for it) on top of the ordinary `{ data,
 * cacheStatus, resultAge }` shape `BffOk<T>` types, so the raw response is
 * cast to `AuthenticatedGscResponse` rather than `BffOk<GscQueryResult>`.
 */
interface AuthenticatedGscResponse {
  readonly data: GscQueryResult;
  readonly cacheStatus: BffOk<GscQueryResult>["cacheStatus"];
  readonly resultAge: number;
  readonly sourceFreshness: SourceFreshness;
}

export function SearchConsoleContainer() {
  const [state, setState] = useState<RegionState | null>(null);
  const [result, setResult] = useState<GscQueryResult | null>(null);
  const [envelope, setEnvelope] = useState<{
    readonly cacheStatus: AuthenticatedGscResponse["cacheStatus"];
    readonly resultAge: number;
    readonly sourceFreshness: SourceFreshness;
    readonly receivedAtMs: number;
  } | null>(null);
  const [lastErrorCode, setLastErrorCode] = useState<BffError["code"] | null>(
    null,
  );
  const [inFlight, setInFlight] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
    input: SearchConsoleFormInput,
  ) {
    if (inFlight) return;
    const intent = userIntent(event);

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestId = ++requestIdRef.current;

    setResult(null);
    setEnvelope(null);
    setLastErrorCode(null);
    setInFlight(true);
    setState({ phase: "loading" });

    const response = (await requestTool<GscQueryResult>(
      "search_console_query",
      {
        siteUrl: input.siteUrl,
        startDate: input.startDate,
        endDate: input.endDate,
        ...(input.dimensions.length > 0
          ? { dimensions: input.dimensions.join(",") }
          : {}),
        ...(input.rowLimit !== undefined ? { rowLimit: input.rowLimit } : {}),
      },
      intent,
      { signal: controller.signal },
    )) as unknown as AuthenticatedGscResponse | { readonly error: BffError };

    // A newer submission superseded this one; discard the stale resolution.
    if (requestId !== requestIdRef.current) return;

    setInFlight(false);

    if ("error" in response) {
      setLastErrorCode(response.error.code);
      setState({ phase: "error", error: response.error });
      return;
    }

    setLastErrorCode(null);
    setResult(response.data);
    setEnvelope({
      cacheStatus: response.cacheStatus,
      resultAge: response.resultAge,
      sourceFreshness: response.sourceFreshness,
      receivedAtMs: Date.now(),
    });
    setState({
      phase: "ready",
      cardinality: describeGscRows(response.data.rowCount, LIMITS.maxGscRows),
    });
  }

  // `search-console-view`'s "quota... resubmit disabled" state: unlike a
  // credential failure or a not-configured source (where the form remains
  // available so the user can adjust and try again), an exhausted Google
  // quota disables resubmission entirely — distinct, observable behavior
  // from the other two non-retryable failure classes.
  const quotaExhausted = lastErrorCode === "upstream_source_quota";

  return (
    <div className="view-stack">
      <SearchConsoleForm
        onSubmit={handleSubmit}
        disabled={inFlight || quotaExhausted}
      />

      {state && (
        <StateRegion label="Search Console query" state={state}>
          {result && envelope && (
            <div className="region-body">
              <div
                className="field-row"
                role="group"
                aria-label="Result freshness"
              >
                <FreshnessBadge
                  cacheStatus={envelope.cacheStatus}
                  resultAge={envelope.resultAge}
                  receivedAtMs={envelope.receivedAtMs}
                />
                <SourceFreshnessBadge freshness={envelope.sourceFreshness} />
              </div>
              <div className="panel panel-wide span-full">
                <h3>Query results</h3>
                <SearchConsoleTable result={result} />
              </div>
              <ExportMenu
                jsonContent={serializeJsonExport(
                  buildJsonExport({
                    tool: "search_console_query",
                    result,
                    cacheStatus: envelope.cacheStatus,
                    resultAge: envelope.resultAge,
                    bounds: collectBounds("search_console_query", result),
                    sourceFreshness: envelope.sourceFreshness,
                  }),
                )}
                csvContent={serializeCsv(
                  CSV_SHAPES.search_console_query,
                  result,
                  {
                    bounds: collectBounds("search_console_query", result),
                    notes: [describeSourceFreshness(envelope.sourceFreshness)],
                  },
                )}
                filenameBase="search-console-query"
              />
            </div>
          )}
        </StateRegion>
      )}
    </div>
  );
}
