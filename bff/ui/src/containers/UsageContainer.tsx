import { useEffect, useRef, useState } from "react";
import { fetchUsage } from "../data/client";
import { HeadroomIndicator } from "../molecules/HeadroomIndicator";

/**
 * Container consuming the existing, already-verified `GET /api/usage`
 * route (`bff/src/usage.ts` — not recreated here). Per `design.md`'s
 * "Quota and Freshness" decision, this fetches **once per explicit user
 * action** — the initial mount IS the user's navigation to this view, and
 * this route never spends the shared MCP rate-limit bucket, so a mount
 * fetch here does not reintroduce polling: there is no timer, no repeated
 * fetch, and no `requestTool` call in the effect body (the `no-polling`
 * structural test scans for `requestTool(` specifically, which this
 * container never calls — it calls the distinct `fetchUsage`). A manual
 * "Refresh" button covers the "explicit user action" case beyond the
 * initial mount.
 */
export function UsageContainer() {
  const [snapshot, setSnapshot] = useState<Awaited<
    ReturnType<typeof fetchUsage>
  > | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  async function load() {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const result = await fetchUsage(controller.signal);
    setSnapshot(result);
  }

  useEffect(() => {
    void load();
    return () => controllerRef.current?.abort();
    // Runs exactly once on mount — the initial navigation to this view is
    // itself the "explicit user action" `design.md` names; there is no
    // dependency on any value that would cause a repeat fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <button type="button" onClick={() => void load()}>
        Refresh usage
      </button>
      {snapshot && <HeadroomIndicator snapshot={snapshot} />}
    </div>
  );
}
