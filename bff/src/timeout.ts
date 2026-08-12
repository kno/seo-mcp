/**
 * Per-tool timeout budgets and the `AbortSignal.timeout` race wrapper
 * `bff/src/mcp-client.ts` uses on every service-binding fetch.
 *
 * Values come from `design.md`'s timeout table: `health` 5s, `crawl_page`
 * 15s, `analyze_pagespeed` 30s, `crawl_site` 55s, `check_links` 55s (the
 * 55s ceiling for the last two is CPU-bound, not wall-clock-bound — see
 * design's rationale). Hardcoded here rather than sourced from a
 * `wrangler.jsonc` var: these are fixed design decisions, not a
 * per-deployment tuning knob, and a flat numeric record is simpler to keep
 * correct than a JSON-encoded Cloudflare `vars` entry.
 */

export type ToolName =
  "health" | "crawl_page" | "crawl_site" | "check_links" | "analyze_pagespeed";

export const TOOL_TIMEOUT_MS: Record<ToolName, number> = {
  health: 5000,
  crawl_page: 15000,
  analyze_pagespeed: 30000,
  crawl_site: 55000,
  check_links: 55000,
};

export type TimeoutResult<T> =
  { ok: true; data: T } | { ok: false; timedOut: true };

/**
 * `AbortSignal.timeout()` sets its abort reason to a `TimeoutError`
 * DOMException per the WHATWG spec; some fetch implementations instead
 * surface the rejection as a plain `AbortError`. Both names are treated as
 * a timeout here so this stays correct across runtimes.
 */
function isTimeoutSignal(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

/**
 * Runs `run` with an `AbortSignal.timeout(timeoutMs)` signal. `run` MUST
 * pass the signal through to whatever async operation it performs (e.g.
 * `fetch(request, { signal })`) so the timeout can actually abort it.
 * An abort from that signal maps to `{ ok: false, timedOut: true }`;
 * any other rejection propagates unchanged.
 */
export async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<TimeoutResult<T>> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const data = await run(signal);
    return { ok: true, data };
  } catch (error) {
    if (isTimeoutSignal(error)) return { ok: false, timedOut: true };
    throw error;
  }
}
