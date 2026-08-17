import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { MouseEvent, ReactNode } from "react";
import type { BffError } from "../../../src/errors";
import type {
  AddSiteResult,
  DeleteSiteResult,
  Site,
} from "../../../../src/types";
import { fetchSites, requestTool, userIntent } from "../data/client";

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
  readonly sites: readonly Site[];
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
  const [sites, setSites] = useState<readonly Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<BffError | null>(null);
  const [activeSite, setActiveSiteState] = useState<string | null>(
    readStoredActiveSite,
  );

  const setActiveSite = useCallback((url: string | null) => {
    setActiveSiteState(url);
    writeStoredActiveSite(url);
  }, []);

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

  return (
    <SiteContext.Provider
      value={{
        sites,
        activeSite,
        setActiveSite,
        refreshSites,
        addSite,
        deleteSite,
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
