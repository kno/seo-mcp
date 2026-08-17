import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { MouseEvent, ReactNode } from "react";
import type { BffError, BffOk } from "../../../src/errors";
import type {
  AddSiteResult,
  DeleteSiteResult,
  ListSitesResult,
} from "../../../../src/types";
import { fetchSites, requestTool, userIntent } from "../data/client";

/**
 * `domain-google-credentials` Phase 6. `Site` alone (the bare `siteSchema`
 * shape) is stale — every `list_sites` row has carried a `credential`
 * object since Phase 3 (`src/schemas/sites.ts#listSitesResultSchema`).
 * Derived from the already-imported `ListSitesResult` rather than a
 * hand-rolled duplicate shape, so this type can never drift from the real
 * schema.
 */
export type SiteWithCredential = ListSitesResult["sites"][number];
export type PresentedHealth =
  SiteWithCredential["credential"]["health"]["searchConsole"];

/**
 * `site-google-credentials`'s "An unhealthy site cannot be selected"
 * scenario, restated for the UI: only a `"healthy"` Search Console
 * resolution is selectable at all — `"stale"`/`"unchecked"` still require a
 * probe the dashboard cannot itself run (Manage Domains' "Recheck" action
 * does that), and `"unhealthy"`/`"not_connected"` are definitively unusable.
 */
export function isSiteSelectable(site: SiteWithCredential): boolean {
  return site.credential.health.searchConsole.state === "healthy";
}

/**
 * Human-readable health label, shared by `App.tsx`'s domain selector (task
 * 6.4's "reason in the accessible name") and `ManageDomainsContainer`'s
 * status column (task 6.1's "two distinct elements... never one element
 * conflating both") — both need the SAME wording for the SAME state so a
 * user does not learn two different vocabularies for one fact.
 */
export function describeHealthState(health: PresentedHealth): string {
  switch (health.state) {
    case "healthy":
      return "Healthy";
    case "not_connected":
      return "Not connected";
    case "unchecked":
      return "Not yet verified";
    case "stale":
      return "Needs a fresh check";
    case "unhealthy":
      return health.reason ? `Unhealthy: ${health.reason}` : "Unhealthy";
  }
}

export function describeCredentialTier(
  tier: SiteWithCredential["credential"]["tier"],
): string {
  switch (tier) {
    case "site":
      return "Connected";
    case "global":
      return "Using shared account";
    case "none":
      return "Not connected";
  }
}

const STORAGE_KEY = "seo-mcp:active-site";

function readStoredActiveSite(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredActiveSite(url: string | null): void {
  try {
    if (url === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, url);
    }
  } catch {
    // A throwing/unavailable localStorage must never break the selector —
    // the persisted "remember my last selection" is a convenience, not a
    // correctness requirement (the backend-owned `sites` list is what
    // actually matters, per this module's own doc comment).
  }
}

export interface SiteContextValue {
  readonly sites: readonly SiteWithCredential[];
  readonly activeSite: string | null;
  readonly setActiveSite: (url: string | null) => void;
  readonly refreshSites: () => Promise<void>;
  readonly addSite: (
    event: MouseEvent<HTMLButtonElement> | { readonly type: string },
    url: string,
    label?: string,
  ) => Promise<{ readonly ok: boolean; readonly error?: BffError }>;
  readonly deleteSite: (
    event: MouseEvent<HTMLButtonElement>,
    siteId: number,
  ) => Promise<boolean>;
  readonly disconnectSite: (
    event: MouseEvent<HTMLButtonElement>,
    siteId: number,
  ) => Promise<boolean>;
  readonly recheckSite: (
    event: MouseEvent<HTMLButtonElement>,
    siteId: number,
  ) => Promise<boolean>;
  readonly loading: boolean;
  readonly error: BffError | null;
}

const SiteContext = createContext<SiteContextValue | null>(null);

/**
 * Domain-management follow-up. Backend-owned `sites` list (fetched via
 * `fetchSites()`, `data/client.ts`'s deliberate `UserIntent`-bypass
 * exception — see that function's own doc comment); `activeSite` is the
 * ONE piece of state persisted to `localStorage`, purely as a "remember my
 * last selection across reloads" convenience. If the persisted value is no
 * longer present in the fetched `sites` list, falls back to the first site,
 * or `null` when the list is empty.
 */
export function SiteProvider({ children }: { readonly children: ReactNode }) {
  const [sites, setSites] = useState<readonly SiteWithCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<BffError | null>(null);
  const [activeSite, setActiveSiteState] = useState<string | null>(
    readStoredActiveSite,
  );

  /**
   * `site-google-credentials`'s "An unhealthy site cannot be selected"
   * scenario: a selection attempt naming a site that is not currently
   * `isSiteSelectable` is rejected outright — `activeSite` does not change.
   * `url === null` (clearing the selection) is always allowed, and a `url`
   * absent from the current `sites` list (should not happen — the selector
   * only offers known sites) fails open rather than silently rejecting a
   * selection this function cannot explain.
   */
  const setActiveSite = useCallback(
    (url: string | null) => {
      if (url !== null) {
        const site = sites.find((candidate) => candidate.url === url);
        if (site && !isSiteSelectable(site)) return;
      }
      setActiveSiteState(url);
      writeStoredActiveSite(url);
    },
    [sites],
  );

  const refreshSites = useCallback(async () => {
    setLoading(true);
    setError(null);
    const response = await fetchSites();
    setLoading(false);
    if ("error" in response) {
      setError(response.error);
      return;
    }
    const fetched = response.data.sites;
    setSites(fetched);
    setActiveSiteState((current) => {
      if (current !== null && fetched.some((site) => site.url === current)) {
        return current;
      }
      return fetched[0]?.url ?? null;
    });
  }, []);

  useEffect(() => {
    void refreshSites();
  }, [refreshSites]);

  const addSite = useCallback<SiteContextValue["addSite"]>(
    async (event, url, label) => {
      const intent = userIntent(event);
      const args: Record<string, string> = label ? { url, label } : { url };
      const response = (await requestTool<AddSiteResult>(
        "add_site",
        args,
        intent,
        { signal: new AbortController().signal },
      )) as { data: AddSiteResult } | { error: BffError };
      if ("error" in response) return { ok: false, error: response.error };
      await refreshSites();
      return { ok: response.data.added };
    },
    [refreshSites],
  );

  const deleteSite = useCallback<SiteContextValue["deleteSite"]>(
    async (event, siteId) => {
      const intent = userIntent(event);
      const response = (await requestTool<DeleteSiteResult>(
        "delete_site",
        { siteId, confirm: true },
        intent,
        { signal: new AbortController().signal, postJson: true },
      )) as { data: DeleteSiteResult } | { error: BffError };
      if ("error" in response || !response.data.deleted) return false;
      setSites((prev) => prev.filter((site) => site.id !== siteId));
      return true;
    },
    [],
  );

  /**
   * `site-google-credentials`'s disconnect confirm-gate (`confirm: true`,
   * same as `deleteSite` above) via the BFF's own explicitly-registered
   * disconnect route (`POST /api/tools/disconnect_google_account`, never
   * the generic tool-proxy path). Unlike `deleteSite`, the row is not
   * spliced locally — disconnecting changes `credential.tier`/`health`
   * server-side (re-resolves to `"global"` or `"none"`), which only a
   * fresh `list_sites` fetch can reflect.
   */
  const disconnectSite = useCallback<SiteContextValue["disconnectSite"]>(
    async (event, siteId) => {
      const intent = userIntent(event);
      const response = (await requestTool<{ readonly disconnected: boolean }>(
        "disconnect_google_account",
        { siteId, confirm: true },
        intent,
        { signal: new AbortController().signal, postJson: true },
      )) as BffOk<{ readonly disconnected: boolean }> | { error: BffError };
      if ("error" in response || !response.data.disconnected) return false;
      await refreshSites();
      return true;
    },
    [refreshSites],
  );

  /**
   * Manage Domains' "Recheck" action — `POST /api/tools/check_site_credentials`
   * with `forceRecheck: true`, bypassing the 6-hour health TTL (spec's
   * "Manual recheck clears an invalid state without a new OAuth round-trip").
   * Refetches `sites` on success so the row's health reflects the fresh
   * probe outcome immediately.
   */
  const recheckSite = useCallback<SiteContextValue["recheckSite"]>(
    async (event, siteId) => {
      const intent = userIntent(event);
      const response = (await requestTool<Record<string, unknown>>(
        "check_site_credentials",
        { siteId, forceRecheck: true },
        intent,
        { signal: new AbortController().signal, postJson: true },
      )) as BffOk<Record<string, unknown>> | { error: BffError };
      if ("error" in response) return false;
      await refreshSites();
      return true;
    },
    [refreshSites],
  );

  return (
    <SiteContext.Provider
      value={{
        sites,
        activeSite,
        setActiveSite,
        refreshSites,
        addSite,
        deleteSite,
        disconnectSite,
        recheckSite,
        loading,
        error,
      }}
    >
      {children}
    </SiteContext.Provider>
  );
}

export function useSiteContext(): SiteContextValue {
  const ctx = useContext(SiteContext);
  if (!ctx) {
    throw new Error("useSiteContext must be used within a SiteProvider");
  }
  return ctx;
}

/**
 * Non-throwing read of the current `activeSite`, for the per-container
 * default-seeding call sites (`SearchConsoleContainer`,
 * `GscInsightsContainer`, `HistoryContainer`, `SeoIntelligenceContainer`,
 * `PageReportContainer`, `SiteCrawlContainer`, `PageSpeedContainer`).
 * Unlike `useSiteContext()`, this returns `null` rather than throwing when
 * no `SiteProvider` is present — every one of those containers' own test
 * files renders it standalone, without wrapping it in `<SiteProvider>`
 * (they predate this context, and re-wrapping every one is out of scope
 * for a smarter-default seed), so this hook must degrade gracefully rather
 * than requiring every existing test file to change.
 */
export function useActiveSite(): string | null {
  const ctx = useContext(SiteContext);
  return ctx?.activeSite ?? null;
}

/**
 * Non-throwing read of `refreshSites`, for `LoginContainer`. `SiteProvider`'s
 * `list_sites` fetch always fires on mount — before the user has had a
 * chance to submit the login form — so it is a 401 (`gate_unauthorized`)
 * every single time on a fresh session, and nothing was re-triggering it
 * after a successful login: the domain selector and Manage domains view
 * stayed stuck on that stale 401 until a full page reload. `LoginContainer`
 * calls this on a successful sign-in to recover without one. Same
 * degrade-gracefully rationale as `useActiveSite` above: `LoginContainer`'s
 * own test file renders it standalone, without a `SiteProvider`.
 */
export function useSitesRefresher(): () => void {
  const ctx = useContext(SiteContext);
  return () => {
    void ctx?.refreshSites();
  };
}
