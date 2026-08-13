import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { BffError, BffErrorCode, BffOk } from "../../../src/errors";
import type {
  FindSeoOpportunitiesResult,
  FindKeywordCannibalizationResult,
  MapKeywordsToPagesResult,
  FindContentGapsResult,
} from "../../../../src/schemas/intelligence";
import type {
  DomainReportCrawl,
  DomainSearch,
} from "../../../../src/schemas/domain-report";
import type { SourceFreshness } from "../../../src/authenticated/freshness";
import type { EffectiveCriteria } from "../../../src/authenticated/criteria";
import { requestTool, userIntent } from "../data/client";
import { describeSeoIntelligenceBound } from "../data/bounds";
import { StateRegion } from "../molecules/StateRegion";
import type { RegionState } from "../molecules/StateRegion";
import { SourceFreshnessBadge } from "../molecules/SourceFreshnessBadge";
import { GscSharedSelector } from "../organisms/GscSharedSelector";
import { EffectiveCriteriaPanel } from "../organisms/EffectiveCriteriaPanel";
import { SeoOpportunitiesPanel } from "../organisms/SeoOpportunitiesPanel";
import { CannibalizationPanel } from "../organisms/CannibalizationPanel";
import { PageKeywordsPanel } from "../organisms/PageKeywordsPanel";
import { ContentGapsPanel } from "../organisms/ContentGapsPanel";
import { DomainReportPanel } from "../organisms/DomainReportPanel";

/**
 * Container for `seo-intelligence-view` (PR10) — five tools
 * (`find_seo_opportunities`, `find_keyword_cannibalization`,
 * `map_keywords_to_pages`, `find_content_gaps`, `analyze_domain`), sharing
 * `GscInsightsContainer`'s tab layout precedent. All five carry the same
 * `sourceFreshness`/`criteria` envelope shape `dispatchAuthenticated()`
 * (`bff/src/router.ts`) produces for a route with an `effectiveCriteria`
 * resolver — `criteria` is ALWAYS present on a successful response for
 * these five, so a request that omitted a limit still renders a correct
 * bound label (task 10.2, threat row h).
 */
interface AuthenticatedResponse<T> {
  readonly data: T;
  readonly cacheStatus: BffOk<T>["cacheStatus"];
  readonly resultAge: number;
  readonly sourceFreshness: SourceFreshness;
  readonly criteria?: EffectiveCriteria;
}

type AuthenticatedResult<T> =
  AuthenticatedResponse<T> | { readonly error: BffError };

/** `analyze_domain`'s BFF-envelope shape — NOT `DomainReport` verbatim. See
 * `DomainReportPanel`'s doc comment: `gscError` never reaches the browser
 * at all, replaced by `enrichmentError` before the response leaves the BFF. */
interface DomainReportEnvelope {
  readonly url: string;
  readonly crawl: DomainReportCrawl;
  readonly search?: DomainSearch;
  readonly enrichmentError?: { readonly code: BffErrorCode };
}

const DEFAULT_RANGE_DAYS = 28;

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function subtractDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() - days);
  return copy;
}

type Tab =
  | "opportunities"
  | "cannibalization"
  | "page-keywords"
  | "content-gaps"
  | "domain-report";

const TABS: ReadonlyArray<{ readonly id: Tab; readonly label: string }> = [
  { id: "opportunities", label: "SEO opportunities" },
  { id: "cannibalization", label: "Keyword cannibalization" },
  { id: "page-keywords", label: "Page keywords" },
  { id: "content-gaps", label: "Content gaps" },
  { id: "domain-report", label: "Domain report" },
];

function OptionalNumberField({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </div>
  );
}

function parseOptionalNumber(raw: string): number | undefined {
  return raw.trim() === "" ? undefined : Number(raw);
}

/** Shared by every count-shaped tab (opportunities/cannibalization/page-
 * keywords/content-gaps): renders `EffectiveCriteriaPanel` + the given
 * count-based `StateRegion`/`cardinality`, so the unconditional GSC-pull
 * caveat (task 10.3) and the "applied criteria" block (task 10.1) never
 * drift between tabs. */
function CountResultRegion({
  label,
  state,
  freshness,
  criteria,
  children,
}: {
  readonly label: string;
  readonly state: RegionState;
  readonly freshness: SourceFreshness | null;
  readonly criteria: EffectiveCriteria | null;
  readonly children?: ReactNode;
}) {
  return (
    <StateRegion label={label} state={state}>
      <div className="region-body">
        {freshness && (
          <div className="field-row" role="group" aria-label="Result freshness">
            <SourceFreshnessBadge freshness={freshness} />
          </div>
        )}
        {criteria && <EffectiveCriteriaPanel criteria={criteria} />}
        {children}
      </div>
    </StateRegion>
  );
}

function OpportunitiesTab({
  siteUrl,
  startDate,
  endDate,
}: {
  readonly siteUrl: string;
  readonly startDate: string;
  readonly endDate: string;
}) {
  const [limit, setLimit] = useState("");
  const [state, setState] = useState<RegionState | null>(null);
  const [result, setResult] = useState<FindSeoOpportunitiesResult | null>(null);
  const [freshness, setFreshness] = useState<SourceFreshness | null>(null);
  const [criteria, setCriteria] = useState<EffectiveCriteria | null>(null);
  const [inFlight, setInFlight] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight || siteUrl.trim() === "") return;
    const intent = userIntent(event);
    setInFlight(true);
    setState({ phase: "loading" });

    const args: Record<string, string | number> = {
      siteUrl,
      startDate,
      endDate,
    };
    const parsedLimit = parseOptionalNumber(limit);
    if (parsedLimit !== undefined) args.limit = parsedLimit;

    const response = (await requestTool<FindSeoOpportunitiesResult>(
      "find_seo_opportunities",
      args,
      intent,
      { signal: new AbortController().signal },
    )) as unknown as AuthenticatedResult<FindSeoOpportunitiesResult>;
    setInFlight(false);

    if ("error" in response) {
      setState({ phase: "error", error: response.error });
      return;
    }
    setResult(response.data);
    setFreshness(response.sourceFreshness);
    setCriteria(response.criteria ?? null);
    setState({
      phase: "ready",
      cardinality: describeSeoIntelligenceBound(
        response.data.count,
        typeof response.criteria?.limit === "number"
          ? response.criteria.limit
          : 10,
        "limit",
      ),
    });
  }

  return (
    <div className="view-stack">
      <form
        className="toolbar"
        onSubmit={handleSubmit}
        aria-label="Find SEO opportunities"
      >
        <div className="field-row">
          <OptionalNumberField
            id="seo-opportunities-limit"
            label="Limit"
            value={limit}
            onChange={setLimit}
            placeholder="server default: 10"
          />
        </div>
        <div className="form-actions">
          <button
            className="btn-primary"
            type="submit"
            disabled={inFlight || siteUrl.trim() === ""}
          >
            Find opportunities
          </button>
        </div>
      </form>
      {state && (
        <CountResultRegion
          label="SEO opportunities"
          state={state}
          freshness={freshness}
          criteria={criteria}
        >
          {result && (
            <SeoOpportunitiesPanel opportunities={result.opportunities} />
          )}
        </CountResultRegion>
      )}
    </div>
  );
}

function CannibalizationTab({
  siteUrl,
  startDate,
  endDate,
}: {
  readonly siteUrl: string;
  readonly startDate: string;
  readonly endDate: string;
}) {
  const [minImpressions, setMinImpressions] = useState("");
  const [limit, setLimit] = useState("");
  const [state, setState] = useState<RegionState | null>(null);
  const [result, setResult] = useState<FindKeywordCannibalizationResult | null>(
    null,
  );
  const [freshness, setFreshness] = useState<SourceFreshness | null>(null);
  const [criteria, setCriteria] = useState<EffectiveCriteria | null>(null);
  const [inFlight, setInFlight] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight || siteUrl.trim() === "") return;
    const intent = userIntent(event);
    setInFlight(true);
    setState({ phase: "loading" });

    const args: Record<string, string | number> = {
      siteUrl,
      startDate,
      endDate,
    };
    const parsedMinImpressions = parseOptionalNumber(minImpressions);
    if (parsedMinImpressions !== undefined)
      args.minImpressions = parsedMinImpressions;
    const parsedLimit = parseOptionalNumber(limit);
    if (parsedLimit !== undefined) args.limit = parsedLimit;

    const response = (await requestTool<FindKeywordCannibalizationResult>(
      "find_keyword_cannibalization",
      args,
      intent,
      { signal: new AbortController().signal },
    )) as unknown as AuthenticatedResult<FindKeywordCannibalizationResult>;
    setInFlight(false);

    if ("error" in response) {
      setState({ phase: "error", error: response.error });
      return;
    }
    setResult(response.data);
    setFreshness(response.sourceFreshness);
    setCriteria(response.criteria ?? null);
    setState({
      phase: "ready",
      cardinality: describeSeoIntelligenceBound(
        response.data.count,
        typeof response.criteria?.limit === "number"
          ? response.criteria.limit
          : 50,
        "limit",
      ),
    });
  }

  return (
    <div className="view-stack">
      <form
        className="toolbar"
        onSubmit={handleSubmit}
        aria-label="Find keyword cannibalization"
      >
        <div className="field-row">
          <OptionalNumberField
            id="cannibalization-min-impressions"
            label="Min impressions"
            value={minImpressions}
            onChange={setMinImpressions}
            placeholder="server default: 10"
          />
          <OptionalNumberField
            id="cannibalization-limit"
            label="Limit"
            value={limit}
            onChange={setLimit}
            placeholder="server default: 50"
          />
        </div>
        <div className="form-actions">
          <button
            className="btn-primary"
            type="submit"
            disabled={inFlight || siteUrl.trim() === ""}
          >
            Find cannibalization
          </button>
        </div>
      </form>
      {state && (
        <CountResultRegion
          label="Keyword cannibalization"
          state={state}
          freshness={freshness}
          criteria={criteria}
        >
          {result && <CannibalizationPanel groups={result.groups} />}
        </CountResultRegion>
      )}
    </div>
  );
}

function PageKeywordsTab({
  siteUrl,
  startDate,
  endDate,
}: {
  readonly siteUrl: string;
  readonly startDate: string;
  readonly endDate: string;
}) {
  const [limit, setLimit] = useState("");
  const [topQueriesPerPage, setTopQueriesPerPage] = useState("");
  const [state, setState] = useState<RegionState | null>(null);
  const [result, setResult] = useState<MapKeywordsToPagesResult | null>(null);
  const [freshness, setFreshness] = useState<SourceFreshness | null>(null);
  const [criteria, setCriteria] = useState<EffectiveCriteria | null>(null);
  const [inFlight, setInFlight] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight || siteUrl.trim() === "") return;
    const intent = userIntent(event);
    setInFlight(true);
    setState({ phase: "loading" });

    const args: Record<string, string | number> = {
      siteUrl,
      startDate,
      endDate,
    };
    const parsedLimit = parseOptionalNumber(limit);
    if (parsedLimit !== undefined) args.limit = parsedLimit;
    const parsedTopQueries = parseOptionalNumber(topQueriesPerPage);
    if (parsedTopQueries !== undefined)
      args.topQueriesPerPage = parsedTopQueries;

    const response = (await requestTool<MapKeywordsToPagesResult>(
      "map_keywords_to_pages",
      args,
      intent,
      { signal: new AbortController().signal },
    )) as unknown as AuthenticatedResult<MapKeywordsToPagesResult>;
    setInFlight(false);

    if ("error" in response) {
      setState({ phase: "error", error: response.error });
      return;
    }
    setResult(response.data);
    setFreshness(response.sourceFreshness);
    setCriteria(response.criteria ?? null);
    setState({
      phase: "ready",
      cardinality: describeSeoIntelligenceBound(
        response.data.count,
        typeof response.criteria?.limit === "number"
          ? response.criteria.limit
          : 100,
        "limit",
      ),
    });
  }

  return (
    <div className="view-stack">
      <form
        className="toolbar"
        onSubmit={handleSubmit}
        aria-label="Map keywords to pages"
      >
        <div className="field-row">
          <OptionalNumberField
            id="page-keywords-limit"
            label="Limit"
            value={limit}
            onChange={setLimit}
            placeholder="server default: 100"
          />
          <OptionalNumberField
            id="page-keywords-top-queries"
            label="Top queries per page"
            value={topQueriesPerPage}
            onChange={setTopQueriesPerPage}
            placeholder="server default: 10"
          />
        </div>
        <div className="form-actions">
          <button
            className="btn-primary"
            type="submit"
            disabled={inFlight || siteUrl.trim() === ""}
          >
            Map keywords to pages
          </button>
        </div>
      </form>
      {state && (
        <CountResultRegion
          label="Page keywords"
          state={state}
          freshness={freshness}
          criteria={criteria}
        >
          {result && <PageKeywordsPanel pages={result.pages} />}
        </CountResultRegion>
      )}
    </div>
  );
}

function ContentGapsTab({
  siteUrl,
  startDate,
  endDate,
}: {
  readonly siteUrl: string;
  readonly startDate: string;
  readonly endDate: string;
}) {
  const [minPosition, setMinPosition] = useState("");
  const [minImpressions, setMinImpressions] = useState("");
  const [limit, setLimit] = useState("");
  const [state, setState] = useState<RegionState | null>(null);
  const [result, setResult] = useState<FindContentGapsResult | null>(null);
  const [freshness, setFreshness] = useState<SourceFreshness | null>(null);
  const [criteria, setCriteria] = useState<EffectiveCriteria | null>(null);
  const [inFlight, setInFlight] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight || siteUrl.trim() === "") return;
    const intent = userIntent(event);
    setInFlight(true);
    setState({ phase: "loading" });

    const args: Record<string, string | number> = {
      siteUrl,
      startDate,
      endDate,
    };
    const parsedMinPosition = parseOptionalNumber(minPosition);
    if (parsedMinPosition !== undefined) args.minPosition = parsedMinPosition;
    const parsedMinImpressions = parseOptionalNumber(minImpressions);
    if (parsedMinImpressions !== undefined)
      args.minImpressions = parsedMinImpressions;
    const parsedLimit = parseOptionalNumber(limit);
    if (parsedLimit !== undefined) args.limit = parsedLimit;

    const response = (await requestTool<FindContentGapsResult>(
      "find_content_gaps",
      args,
      intent,
      { signal: new AbortController().signal },
    )) as unknown as AuthenticatedResult<FindContentGapsResult>;
    setInFlight(false);

    if ("error" in response) {
      setState({ phase: "error", error: response.error });
      return;
    }
    setResult(response.data);
    setFreshness(response.sourceFreshness);
    setCriteria(response.criteria ?? null);
    setState({
      phase: "ready",
      cardinality: describeSeoIntelligenceBound(
        response.data.count,
        typeof response.criteria?.limit === "number"
          ? response.criteria.limit
          : 100,
        "limit",
      ),
    });
  }

  return (
    <div className="view-stack">
      <form
        className="toolbar"
        onSubmit={handleSubmit}
        aria-label="Find content gaps"
      >
        <div className="field-row">
          <OptionalNumberField
            id="content-gaps-min-position"
            label="Min position"
            value={minPosition}
            onChange={setMinPosition}
            placeholder="server default: 21"
          />
          <OptionalNumberField
            id="content-gaps-min-impressions"
            label="Min impressions"
            value={minImpressions}
            onChange={setMinImpressions}
            placeholder="server default: 10"
          />
          <OptionalNumberField
            id="content-gaps-limit"
            label="Limit"
            value={limit}
            onChange={setLimit}
            placeholder="server default: 100"
          />
        </div>
        <div className="form-actions">
          <button
            className="btn-primary"
            type="submit"
            disabled={inFlight || siteUrl.trim() === ""}
          >
            Find content gaps
          </button>
        </div>
      </form>
      {state && (
        <CountResultRegion
          label="Content gaps"
          state={state}
          freshness={freshness}
          criteria={criteria}
        >
          {result && <ContentGapsPanel gaps={result.gaps} />}
        </CountResultRegion>
      )}
    </div>
  );
}

function DomainReportTab() {
  const [url, setUrl] = useState("");
  const [gscProperty, setGscProperty] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [opportunityLimit, setOpportunityLimit] = useState("");
  const [state, setState] = useState<RegionState | null>(null);
  const [result, setResult] = useState<DomainReportEnvelope | null>(null);
  const [freshness, setFreshness] = useState<SourceFreshness | null>(null);
  const [criteria, setCriteria] = useState<EffectiveCriteria | null>(null);
  const [inFlight, setInFlight] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight || url.trim() === "") return;
    const intent = userIntent(event);
    setInFlight(true);
    setState({ phase: "loading", detail: "Crawling and analyzing domain…" });

    const args: Record<string, string | number> = { url };
    if (gscProperty.trim() !== "") args.gscProperty = gscProperty.trim();
    if (startDate.trim() !== "") args.startDate = startDate.trim();
    if (endDate.trim() !== "") args.endDate = endDate.trim();
    const parsedOpportunityLimit = parseOptionalNumber(opportunityLimit);
    if (parsedOpportunityLimit !== undefined)
      args.opportunityLimit = parsedOpportunityLimit;

    const response = (await requestTool<DomainReportEnvelope>(
      "analyze_domain",
      args,
      intent,
      { signal: new AbortController().signal },
    )) as unknown as AuthenticatedResult<DomainReportEnvelope>;
    setInFlight(false);

    if ("error" in response) {
      setState({ phase: "error", error: response.error });
      return;
    }
    setResult(response.data);
    setFreshness(response.sourceFreshness);
    setCriteria(response.criteria ?? null);
    setState({ phase: "ready", cardinality: { state: "complete", total: 1 } });
  }

  return (
    <div className="view-stack">
      <form
        className="toolbar"
        onSubmit={handleSubmit}
        aria-label="Analyze domain"
      >
        <div className="field-row">
          <div className="field field-url">
            <label htmlFor="domain-report-url">Site URL</label>
            <input
              id="domain-report-url"
              type="url"
              placeholder="https://example.com"
              value={url}
              onChange={(event) => setUrl(event.currentTarget.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="domain-report-gsc-property">
              Search Console property (optional)
            </label>
            <input
              id="domain-report-gsc-property"
              type="text"
              placeholder="sc-domain:example.com"
              value={gscProperty}
              onChange={(event) => setGscProperty(event.currentTarget.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="domain-report-start-date">Start date</label>
            <input
              id="domain-report-start-date"
              type="text"
              placeholder="YYYY-MM-DD"
              value={startDate}
              onChange={(event) => setStartDate(event.currentTarget.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="domain-report-end-date">End date</label>
            <input
              id="domain-report-end-date"
              type="text"
              placeholder="YYYY-MM-DD"
              value={endDate}
              onChange={(event) => setEndDate(event.currentTarget.value)}
            />
          </div>
          <OptionalNumberField
            id="domain-report-opportunity-limit"
            label="Opportunity limit"
            value={opportunityLimit}
            onChange={setOpportunityLimit}
            placeholder="server default: 10"
          />
        </div>
        <div className="form-actions">
          <button
            className="btn-primary"
            type="submit"
            disabled={inFlight || url.trim() === ""}
          >
            Analyze domain
          </button>
        </div>
      </form>
      {state && (
        <StateRegion label="Domain report" state={state}>
          {result && (
            <div className="region-body">
              {freshness && (
                <div
                  className="field-row"
                  role="group"
                  aria-label="Result freshness"
                >
                  <SourceFreshnessBadge freshness={freshness} />
                </div>
              )}
              {criteria && <EffectiveCriteriaPanel criteria={criteria} />}
              <DomainReportPanel
                url={result.url}
                crawl={result.crawl}
                search={result.search}
                enrichmentError={result.enrichmentError}
              />
            </div>
          )}
        </StateRegion>
      )}
    </div>
  );
}

export function SeoIntelligenceContainer() {
  const [siteUrl, setSiteUrl] = useState("");
  const [startDate, setStartDate] = useState(() =>
    toDateOnly(subtractDays(new Date(), DEFAULT_RANGE_DAYS)),
  );
  const [endDate, setEndDate] = useState(() => toDateOnly(new Date()));
  const [activeTab, setActiveTab] = useState<Tab>("opportunities");

  return (
    <div className="view-stack">
      {activeTab !== "domain-report" && (
        <GscSharedSelector
          siteUrl={siteUrl}
          startDate={startDate}
          endDate={endDate}
          onSiteUrlChange={setSiteUrl}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
          disabled={false}
        />
      )}

      <div
        role="tablist"
        aria-label="SEO intelligence tool"
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

      {activeTab === "opportunities" && (
        <OpportunitiesTab
          siteUrl={siteUrl}
          startDate={startDate}
          endDate={endDate}
        />
      )}
      {activeTab === "cannibalization" && (
        <CannibalizationTab
          siteUrl={siteUrl}
          startDate={startDate}
          endDate={endDate}
        />
      )}
      {activeTab === "page-keywords" && (
        <PageKeywordsTab
          siteUrl={siteUrl}
          startDate={startDate}
          endDate={endDate}
        />
      )}
      {activeTab === "content-gaps" && (
        <ContentGapsTab
          siteUrl={siteUrl}
          startDate={startDate}
          endDate={endDate}
        />
      )}
      {activeTab === "domain-report" && <DomainReportTab />}
    </div>
  );
}
