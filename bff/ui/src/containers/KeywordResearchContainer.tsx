import { useRef, useState } from "react";
import type { FormEvent } from "react";
import type { BffError, BffOk } from "../../../src/errors";
import type {
  KeywordMetricsResult,
  ClusterResult,
} from "../../../../src/types";
import type { SourceFreshness } from "../../../src/authenticated/freshness";
import { requestTool, userIntent } from "../data/client";
import { StateRegion } from "../molecules/StateRegion";
import type { RegionState } from "../molecules/StateRegion";
import { SourceFreshnessBadge } from "../molecules/SourceFreshnessBadge";
import { AdsQuotaBadge } from "../molecules/AdsQuotaBadge";
import type {
  AccountCredentialView,
  QuotaEstimateView,
} from "../molecules/AdsQuotaBadge";
import {
  KeywordMetricsForm,
  type KeywordMetricsFormInput,
} from "../organisms/KeywordMetricsForm";
import { KeywordMetricsTable } from "../organisms/KeywordMetricsTable";
import {
  KeywordDiscoveryForm,
  type KeywordDiscoveryFormInput,
} from "../organisms/KeywordDiscoveryForm";
import {
  KeywordClusterForm,
  type KeywordClusterFormInput,
} from "../organisms/KeywordClusterForm";
import { KeywordClusterPanel } from "../organisms/KeywordClusterPanel";

/**
 * Container for `keyword-research-view` — `get_keyword_metrics`,
 * `discover_keywords`, `cluster_keywords`. Three tabs, "Keyword metrics"
 * first and default, per task 8.1: the view is fully usable with
 * `get_keyword_metrics` alone, and the other two tabs are additive
 * enhancements a user can optionally reach from the same view, never
 * prerequisites to seeing keyword metrics.
 *
 * `get_keyword_metrics`/`discover_keywords` share the SAME authenticated
 * envelope shape (`sourceFreshness`, `quota`, optional `currencyLabel`,
 * `keyword-research-view` under a new, separate `google-ads` source — task
 * 8.5). `cluster_keywords` is genuinely NOT authenticated: its response
 * carries none of those three fields at all, by construction
 * (`bff/src/router.ts` dispatches it through the ordinary `dispatch()` path,
 * never `dispatchAuthenticated()`) — so its tab renders no quota/freshness
 * badge, not merely an omitted one.
 */
interface AuthenticatedKeywordResponse<T> {
  readonly data: T;
  readonly cacheStatus: BffOk<T>["cacheStatus"];
  readonly resultAge: number;
  readonly sourceFreshness: SourceFreshness;
  readonly quota: QuotaEstimateView;
  readonly credential: AccountCredentialView;
  readonly currencyLabel?: string;
}

type AuthenticatedKeywordResult<T> =
  AuthenticatedKeywordResponse<T> | { readonly error: BffError };

type Tab = "metrics" | "discover" | "cluster";

const TABS: ReadonlyArray<{ readonly id: Tab; readonly label: string }> = [
  { id: "metrics", label: "Keyword metrics" },
  { id: "discover", label: "Discover keywords" },
  { id: "cluster", label: "Cluster keywords" },
];

function joinIfPresent(
  values: readonly string[] | undefined,
): string | undefined {
  return values && values.length > 0 ? values.join(",") : undefined;
}

function MetricsTab() {
  const [state, setState] = useState<RegionState | null>(null);
  const [result, setResult] = useState<KeywordMetricsResult | null>(null);
  const [freshness, setFreshness] = useState<SourceFreshness | null>(null);
  const [quota, setQuota] = useState<QuotaEstimateView | null>(null);
  const [credential, setCredential] = useState<AccountCredentialView | null>(
    null,
  );
  const [currencyLabel, setCurrencyLabel] = useState<string | undefined>(
    undefined,
  );
  const [inFlight, setInFlight] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
    input: KeywordMetricsFormInput,
  ) {
    if (inFlight) return;
    const intent = userIntent(event);

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestId = ++requestIdRef.current;

    setResult(null);
    setFreshness(null);
    setQuota(null);
    setCredential(null);
    setInFlight(true);
    setState({ phase: "loading" });

    const args: Record<string, string> = {
      keywords: input.keywords.join(","),
    };
    const geoTargetIds = joinIfPresent(input.geoTargetIds);
    if (geoTargetIds !== undefined) args.geoTargetIds = geoTargetIds;
    if (input.languageId !== undefined) args.languageId = input.languageId;
    if (input.customerId !== undefined) args.customerId = input.customerId;

    const response = (await requestTool<KeywordMetricsResult>(
      "get_keyword_metrics",
      args,
      intent,
      { signal: controller.signal },
    )) as unknown as AuthenticatedKeywordResult<KeywordMetricsResult>;

    if (requestId !== requestIdRef.current) return;
    setInFlight(false);

    if ("error" in response) {
      setState({ phase: "error", error: response.error });
      return;
    }

    setResult(response.data);
    setFreshness(response.sourceFreshness);
    setQuota(response.quota);
    setCredential(response.credential);
    setCurrencyLabel(response.currencyLabel);
    setState({
      phase: "ready",
      cardinality:
        response.data.count === 0
          ? { state: "none" }
          : { state: "complete", total: response.data.count },
    });
  }

  return (
    <div className="view-stack">
      <KeywordMetricsForm onSubmit={handleSubmit} disabled={inFlight} />
      {state && (
        <StateRegion label="Keyword metrics" state={state}>
          {result && freshness && quota && credential && (
            <div className="region-body">
              <div
                className="field-row"
                role="group"
                aria-label="Result freshness and quota"
              >
                <SourceFreshnessBadge freshness={freshness} />
                <AdsQuotaBadge quota={quota} credential={credential} />
              </div>
              <KeywordMetricsTable
                result={result}
                currencyLabel={currencyLabel}
              />
            </div>
          )}
        </StateRegion>
      )}
    </div>
  );
}

function DiscoverTab({
  onDiscovered,
}: {
  readonly onDiscovered: (keywords: readonly string[]) => void;
}) {
  const [state, setState] = useState<RegionState | null>(null);
  const [result, setResult] = useState<KeywordMetricsResult | null>(null);
  const [freshness, setFreshness] = useState<SourceFreshness | null>(null);
  const [quota, setQuota] = useState<QuotaEstimateView | null>(null);
  const [credential, setCredential] = useState<AccountCredentialView | null>(
    null,
  );
  const [currencyLabel, setCurrencyLabel] = useState<string | undefined>(
    undefined,
  );
  const [inFlight, setInFlight] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
    input: KeywordDiscoveryFormInput,
  ) {
    if (inFlight) return;
    const intent = userIntent(event);

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestId = ++requestIdRef.current;

    setResult(null);
    setFreshness(null);
    setQuota(null);
    setCredential(null);
    setInFlight(true);
    setState({ phase: "loading" });

    const args: Record<string, string | number> = {};
    const seedKeywords = joinIfPresent(input.seedKeywords);
    if (seedKeywords !== undefined) args.seedKeywords = seedKeywords;
    if (input.seedUrl !== undefined) args.seedUrl = input.seedUrl;
    const geoTargetIds = joinIfPresent(input.geoTargetIds);
    if (geoTargetIds !== undefined) args.geoTargetIds = geoTargetIds;
    if (input.languageId !== undefined) args.languageId = input.languageId;
    if (input.limit !== undefined) args.limit = input.limit;
    if (input.customerId !== undefined) args.customerId = input.customerId;

    const response = (await requestTool<KeywordMetricsResult>(
      "discover_keywords",
      args,
      intent,
      { signal: controller.signal },
    )) as unknown as AuthenticatedKeywordResult<KeywordMetricsResult>;

    if (requestId !== requestIdRef.current) return;
    setInFlight(false);

    if ("error" in response) {
      setState({ phase: "error", error: response.error });
      return;
    }

    setResult(response.data);
    setFreshness(response.sourceFreshness);
    setQuota(response.quota);
    setCredential(response.credential);
    setCurrencyLabel(response.currencyLabel);
    onDiscovered(response.data.keywords.map((metric) => metric.keyword));
    setState({
      phase: "ready",
      cardinality:
        response.data.count === 0
          ? { state: "none" }
          : { state: "complete", total: response.data.count },
    });
  }

  return (
    <div className="view-stack">
      <KeywordDiscoveryForm onSubmit={handleSubmit} disabled={inFlight} />
      {state && (
        <StateRegion label="Discover keywords" state={state}>
          {result && freshness && quota && credential && (
            <div className="region-body">
              <div
                className="field-row"
                role="group"
                aria-label="Result freshness and quota"
              >
                <SourceFreshnessBadge freshness={freshness} />
                <AdsQuotaBadge quota={quota} credential={credential} />
              </div>
              <KeywordMetricsTable
                result={result}
                currencyLabel={currencyLabel}
              />
            </div>
          )}
        </StateRegion>
      )}
    </div>
  );
}

function ClusterTab({
  initialKeywords,
}: {
  readonly initialKeywords: readonly string[];
}) {
  const [state, setState] = useState<RegionState | null>(null);
  const [result, setResult] = useState<ClusterResult | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
    input: KeywordClusterFormInput,
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

    // `cluster_keywords` is NOT authenticated (no credential, no Google
    // call, no quota) — its response is an ordinary `BffOk<ClusterResult>`,
    // never the authenticated envelope shape the other two tabs use.
    const response = await requestTool<ClusterResult>(
      "cluster_keywords",
      { keywords: input.keywords.join(",") },
      intent,
      { signal: controller.signal },
    );

    if (requestId !== requestIdRef.current) return;
    setInFlight(false);

    if ("error" in response) {
      setState({ phase: "error", error: response.error });
      return;
    }

    setResult(response.data);
    setState({
      phase: "ready",
      cardinality:
        response.data.count === 0
          ? { state: "none" }
          : { state: "complete", total: response.data.count },
    });
  }

  return (
    <div className="view-stack">
      <KeywordClusterForm
        onSubmit={handleSubmit}
        disabled={inFlight}
        initialKeywords={initialKeywords}
      />
      {state && (
        <StateRegion label="Cluster keywords" state={state}>
          {result && <KeywordClusterPanel result={result} />}
        </StateRegion>
      )}
    </div>
  );
}

export function KeywordResearchContainer() {
  const [activeTab, setActiveTab] = useState<Tab>("metrics");
  const [discoveredKeywords, setDiscoveredKeywords] = useState<
    readonly string[]
  >([]);

  return (
    <div className="view-stack">
      <div
        role="tablist"
        aria-label="Keyword research tool"
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

      {activeTab === "metrics" && <MetricsTab />}
      {activeTab === "discover" && (
        <DiscoverTab onDiscovered={setDiscoveredKeywords} />
      )}
      {activeTab === "cluster" && (
        <ClusterTab initialKeywords={discoveredKeywords} />
      )}
    </div>
  );
}
