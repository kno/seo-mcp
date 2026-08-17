/**
 * BFF-side upstream quota ledger — the mechanism design.md calls out as
 * "reusing the `quota-visibility` pattern": the same KV-backed observed-
 * call-volume substrate `bff/src/usage.ts` already uses for the MCP
 * bucket, applied to a SECOND, independently exhaustible budget (Google's
 * own per-source quota, not the MCP's 60-req/60s bucket).
 *
 * Key shape: `q1:{source}:{accountKey}:{windowStart}`, where `windowStart`
 * is a day-aligned (24h) bucket boundary in epoch milliseconds — daily, to
 * match `AUTH_SOURCE_BUDGET`'s "daily soft budget" semantics
 * (`bff/wrangler.jsonc`). The window need not align to local midnight; it
 * only needs to be a stable, deterministic 24h bucket, which
 * `Math.floor(now / LEDGER_WINDOW_MS) * LEDGER_WINDOW_MS` gives for free.
 *
 * `accountKey` (`domain-google-credentials`, Phase 5) buckets the ledger per
 * resolved Google account — two sites resolving to the SAME account share
 * ONE bucket (`account-scope.ts#resolveAccountForRoute`'s `accountKey` is
 * identical for both), two sites on two different accounts never share a
 * bucket. Without this, Google-side quota exhaustion for one connected
 * account would be reported as if it applied to every other account too.
 *
 * Three invariants this module (together with its ONE call site in
 * `router.ts`) enforces, per design.md's "Decision: BFF-side upstream
 * quota ledger":
 *
 * 1. **Incremented on the upstream ATTEMPT, not on success.** `router.ts`
 *    calls `recordUpstreamAttempt` from inside the function it hands to
 *    `withSingleFlight`, i.e. exactly when a real upstream call is about
 *    to happen — never on a cache hit (which returns before that point),
 *    never on a gate rejection (handled earlier in `router.ts`, before
 *    `dispatchAuthenticated` is even reached), and never on an
 *    input-validation failure (same reason).
 * 2. **Under-estimate by construction.** KV is eventually consistent and
 *    concurrent increments can be lost, so `basis` is always
 *    `"bff-observed"` and the required presentation is "at least N calls
 *    used in this window" — NEVER a remaining count. This mirrors
 *    `usage.ts`'s `estimate: true` discipline for the MCP bucket; it is
 *    that same estimate-labelling pattern's second instance.
 * 3. **KV absence/failure degrades to `"unavailable"`, never a closed
 *    failure.** Mirrors `cache.ts`'s `getCached`/`putCached`: a missing or
 *    throwing binding must never fail the request that already has a live
 *    result in hand (threat matrix row e).
 */

export const LEDGER_WINDOW_MS = 24 * 60 * 60 * 1000; // 1 day — matches AUTH_SOURCE_BUDGET's daily semantics

function windowStart(now: number): number {
  return Math.floor(now / LEDGER_WINDOW_MS) * LEDGER_WINDOW_MS;
}

function ledgerKey(source: string, accountKey: string, now: number): string {
  return `q1:${source}:${accountKey}:${windowStart(now)}`;
}

/**
 * Increments `source`'s counter for `accountKey`'s window containing `now`.
 * Any KV failure (missing binding, throwing `get`/`put`, malformed stored
 * value) is swallowed — a ledger write failure MUST NOT fail the caller's
 * request, exactly like `cache.ts#putCached`.
 */
export async function incrementLedger(
  kv: KVNamespace | undefined,
  source: string,
  accountKey: string = "global",
  now: number = Date.now(),
): Promise<void> {
  if (!kv) return;
  try {
    const key = ledgerKey(source, accountKey, now);
    const raw = await kv.get(key);
    const current = raw === null ? 0 : Number(raw);
    const count = Number.isFinite(current) ? current + 1 : 1;
    const secondsRemainingInWindow = Math.max(
      60,
      Math.ceil((windowStart(now) + LEDGER_WINDOW_MS - now) / 1000),
    );
    await kv.put(key, String(count), {
      expirationTtl: secondsRemainingInWindow,
    });
  } catch {
    // Ledger write failures must never fail the request — swallow.
  }
}

/**
 * Records one upstream ATTEMPT. When `ctx` (the Worker's
 * `ExecutionContext`) is available, the increment runs via `ctx.waitUntil`
 * — fire-and-forget, so it never adds latency to the response the caller
 * is waiting on. When `ctx` is absent (e.g. a unit test calling
 * `handleRequest` directly without a Workers runtime), the increment is
 * awaited inline instead, so its effect is deterministic for assertions —
 * production code ALWAYS supplies `ctx` (`bff/src/index.ts`), so this
 * fallback is a test-only affordance, never a production behavior.
 */
export async function recordUpstreamAttempt(
  ctx: ExecutionContext | undefined,
  kv: KVNamespace | undefined,
  source: string,
  accountKey: string = "global",
  now: number = Date.now(),
): Promise<void> {
  const attempt = incrementLedger(kv, source, accountKey, now);
  if (ctx) {
    ctx.waitUntil(attempt);
    return;
  }
  await attempt;
}

export interface QuotaEstimate {
  source: string;
  /** Under-estimate by construction — see this module's doc comment. */
  atLeast: number;
  /** `AUTH_SOURCE_BUDGET[source]` — the BFF's own soft accounting
   * threshold for display purposes, NOT Google's real API quota. */
  budget: number;
  /** `"unavailable"` whenever the KV binding is missing or throws —
   * never presented as a confident zero. */
  basis: "bff-observed" | "unavailable";
}

/**
 * Reads the current window's estimate for `source` WITHOUT incrementing
 * it — a pure read, safe to call on both a cache hit and a cache miss.
 * Degrades to `{ atLeast: 0, basis: "unavailable" }` on a missing or
 * throwing KV binding (threat matrix row e): the caller already has a
 * live result in hand and MUST still receive a response.
 */
export async function getQuotaEstimate(
  kv: KVNamespace | undefined,
  source: string,
  budget: number,
  accountKey: string = "global",
  now: number = Date.now(),
): Promise<QuotaEstimate> {
  if (!kv) return { source, atLeast: 0, budget, basis: "unavailable" };
  try {
    const raw = await kv.get(ledgerKey(source, accountKey, now));
    const atLeast = raw === null ? 0 : Number(raw);
    return {
      source,
      atLeast: Number.isFinite(atLeast) ? atLeast : 0,
      budget,
      basis: "bff-observed",
    };
  } catch {
    return { source, atLeast: 0, budget, basis: "unavailable" };
  }
}

/**
 * The required presentation, verbatim: "at least N calls used in this
 * window" — never a remaining count, never an exact claim. Kept as a pure
 * function so a future view (PR4+) can reuse the exact wording rather
 * than re-deriving it.
 */
export function describeQuotaEstimate(estimate: QuotaEstimate): string {
  if (estimate.basis === "unavailable") {
    return "Upstream call volume for this window is currently unavailable.";
  }
  return `At least ${estimate.atLeast} calls used in this window (soft budget: ${estimate.budget}).`;
}

/**
 * Whether the estimate is at or over its soft budget. Only meaningful
 * when `basis === "bff-observed"` — an `"unavailable"` estimate is never
 * treated as exhausted (that would be a false positive disabling submit
 * for a reason that never actually held).
 */
export function isAtOrOverBudget(estimate: QuotaEstimate): boolean {
  return (
    estimate.basis === "bff-observed" && estimate.atLeast >= estimate.budget
  );
}
