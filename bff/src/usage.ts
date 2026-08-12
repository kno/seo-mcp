/**
 * Isolate-local upstream call accounting behind the read-only `GET
 * /api/usage` route.
 *
 * This is the BFF's OWN observed call volume, never an authoritative
 * remaining-quota figure: the shared Workers rate-limit binding
 * (`src/http/auth.ts:104-107`) reports only `{success}`, never a remaining
 * count, and the `mcp:shared-v1` bucket is shared with every other MCP
 * consumer — traffic the BFF cannot see. `getUsageSnapshot` therefore always
 * marks its figure `estimate: true` with an explanatory note; a caller MUST
 * NOT treat it as authoritative headroom against the shared bucket.
 *
 * Same best-effort, isolate-local caveat as `single-flight.ts`: a plain
 * module-level counter, no persistence mechanism, no cross-isolate
 * visibility. A fresh isolate starts a fresh window at zero.
 */

/** Rolling window covered by the accounting, in milliseconds. */
export const USAGE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

let windowStart = Date.now();
let callCount = 0;

const ESTIMATE_NOTE =
  "This is the BFF's own observed upstream call volume, not an " +
  "authoritative remaining count against the shared rate-limit bucket — " +
  "other consumers of that same bucket are not visible to this figure.";

/**
 * Records one observed upstream call. MUST be called exactly once per
 * actual upstream fetch (see `mcp-client.ts`'s `callTool`) — never once per
 * incoming request, so cache hits and single-flight followers are
 * correctly excluded from the count.
 */
export function recordUpstreamCall(now: number = Date.now()): void {
  if (now - windowStart >= USAGE_WINDOW_MS) {
    windowStart = now;
    callCount = 0;
  }
  callCount += 1;
}

export interface UsageSnapshot {
  callCount: number;
  windowSeconds: number;
  windowElapsedSeconds: number;
  estimate: true;
  note: string;
}

/**
 * Returns a snapshot of the current window's observed call volume. Always
 * marked `estimate: true` per the `dashboard-bff` spec's "Read-Only Usage
 * and Headroom Source" requirement — this figure MUST NOT be presented as
 * an authoritative remaining count.
 */
export function getUsageSnapshot(now: number = Date.now()): UsageSnapshot {
  const elapsedMs = Math.max(0, now - windowStart);
  return {
    callCount,
    windowSeconds: USAGE_WINDOW_MS / 1000,
    windowElapsedSeconds: Math.floor(elapsedMs / 1000),
    estimate: true,
    note: ESTIMATE_NOTE,
  };
}

/**
 * Test-only reset so each test starts from a fresh window, mirroring
 * `single-flight.ts`'s `inFlightSizeForTest` pattern.
 */
export function resetUsageForTest(now: number = Date.now()): void {
  windowStart = now;
  callCount = 0;
}
