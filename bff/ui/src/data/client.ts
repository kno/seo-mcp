/**
 * Gesture-gated fetching. `requestTool()` requires a `UserIntent` token that
 * can only be minted by `userIntent(event)` from a real user-gesture event
 * type. No timer, no repeating-interval primitive, and no tab-visibility
 * or window-focus listener has an `event` shaped like a click or submit,
 * so no such call site can produce a token by calling `userIntent()`
 * legitimately — and constructing a `UserIntent` value directly (e.g. `{}`
 * or `{} as UserIntent`) is either a type error or an explicit, auditable
 * escape hatch, never an accident. This makes "no polling / no
 * auto-refresh / no refresh-on-tab-visibility" a type-level property of
 * `requestTool`'s signature, backstopped by the structural test
 * (`bff/ui/src/no-polling.test.ts`) that independently scans real source
 * for the banned APIs regardless of how a call site obtained a token.
 */

import type { BffError, BffOk } from "../../../src/errors";
import type { ToolName } from "../../../src/timeout";
import type { UsageSnapshot } from "../../../src/usage";
import type { ListSitesResult } from "../../../../src/types";
import type { SecretCell } from "./secret";

declare const brand: unique symbol;

/** Opaque capability token. The only way to obtain one is `userIntent()`. */
export type UserIntent = { readonly [brand]: "user-intent" };

/**
 * DOM event types that represent a direct, synchronous result of a user
 * action — as opposed to a timer, a lifecycle event, or a visibility
 * change, all of which fire without any user action at all.
 */
const USER_GESTURE_EVENT_TYPES: ReadonlySet<string> = new Set([
  "click",
  "submit",
]);

export function userIntent(event: { readonly type: string }): UserIntent {
  if (!USER_GESTURE_EVENT_TYPES.has(event.type)) {
    throw new Error(
      `userIntent() requires a user-gesture event ("click" or "submit"); received "${event.type}".`,
    );
  }
  return {} as unknown as UserIntent;
}

export type ToolInput = Readonly<Record<string, string | number | boolean>>;

export interface RequestToolOptions {
  readonly signal: AbortSignal;
  /** Forces the BFF to bypass its KV cache read (`?refresh=1`). */
  readonly refresh?: boolean;
  /**
   * Secret-bearing inputs, e.g. `analyze_pagespeed`'s optional `apiKey`.
   * When present, the whole request is sent as `POST` with a JSON body
   * (`bff/src/router.ts`'s one secret-bearing route accepts this) instead
   * of `GET` with a query string, so the secret never appears in the
   * outgoing request URL — not in DevTools' Network tab, not in any access
   * log the request passes through. Each cell is `.take()`n exactly once
   * while building that body; the raw value is never assigned to any
   * variable this function keeps beyond building the body payload, and
   * never appears in any thrown error, log, or the resolved value.
   */
  readonly secrets?: Readonly<Record<string, SecretCell>>;
  /**
   * Forces `POST` with `input` as a plain JSON body, with none of
   * `opts.secrets`'s cell-consuming machinery — for a route that requires
   * POST for a reason OTHER than a secret input.
   * `delete_search_console_snapshot`/`delete_crawl_snapshot`
   * (manual-snapshot-deletion) are the only current callers: their BFF
   * route is POST-only because deletion is irreversible and a GET request
   * can be triggered unintentionally (`bff/src/router.ts`'s doc comment),
   * not because any field here is secret. Mutually exclusive with
   * `opts.secrets` in practice — no current caller supplies both.
   */
  readonly postJson?: boolean;
}

/**
 * Calls the BFF's `/api/tools/{tool}` route. Ordinary calls use `GET` with
 * query-string parameters, matching `bff/src/router.ts`'s default contract.
 * A call carrying `opts.secrets` instead uses `POST` with a JSON body, the
 * one exception that route accepts specifically so a secret input never
 * travels as a query-string parameter.
 */
export async function requestTool<T>(
  tool: ToolName,
  input: ToolInput,
  intent: UserIntent,
  opts: RequestToolOptions,
): Promise<BffOk<T> | { error: BffError }> {
  // The token's only job is to exist at the call site; requestTool never
  // reads its value.
  void intent;

  if (opts.secrets) {
    const body: Record<string, string | number | boolean> = { ...input };
    for (const [key, cell] of Object.entries(opts.secrets)) {
      const value = cell.take();
      if (value !== undefined) body[key] = value;
    }
    const response = await fetch(`/api/tools/${tool}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    return (await response.json()) as BffOk<T> | { error: BffError };
  }

  if (opts.postJson) {
    const response = await fetch(`/api/tools/${tool}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: opts.signal,
    });
    return (await response.json()) as BffOk<T> | { error: BffError };
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    params.set(key, String(value));
  }
  if (opts.refresh) params.set("refresh", "1");

  const query = params.toString();
  const response = await fetch(
    `/api/tools/${tool}${query ? `?${query}` : ""}`,
    {
      method: "GET",
      signal: opts.signal,
    },
  );

  return (await response.json()) as BffOk<T> | { error: BffError };
}

/**
 * `quota-visibility`'s read-only usage source. `GET /api/usage` is a
 * distinct route from `/api/tools/{tool}` — it returns the BFF's own
 * `UsageSnapshot` envelope directly (`{ callCount, windowSeconds,
 * windowElapsedSeconds, estimate: true, note }`), never a `BffOk<T>`
 * wrapper, and never spends the shared MCP rate-limit bucket (`bff/src/
 * usage.ts`'s own doc comment: it reads the BFF's own accounting, not an
 * upstream call). No `UserIntent` is required: this route makes no upstream
 * call at all, so there is nothing here for the no-polling guard to gate —
 * `UsageContainer` calls it once on mount (a real user navigation) and
 * again only on an explicit user action, never on a timer.
 */
export async function fetchUsage(signal?: AbortSignal): Promise<UsageSnapshot> {
  const response = await fetch("/api/usage", { method: "GET", signal });
  return (await response.json()) as UsageSnapshot;
}

/**
 * Domain-management follow-up's read source for `SiteContext`. Deliberately
 * bypasses `requestTool`'s `UserIntent` gate — the same exception
 * `fetchUsage` above already establishes — because `list_sites` spends no
 * Google quota and makes no external call (a cheap local D1 read, per
 * `bff/src/cache.ts#isCacheable`'s own doc comment); `SiteContext` calls
 * this once on mount, not on a timer, so the "no polling" invariant
 * (`no-polling.test.ts`) is unaffected: that invariant is specifically about
 * `requestTool()` being called from a `useEffect` body, not about mount-time
 * fetching in general.
 */
export async function fetchSites(
  signal?: AbortSignal,
): Promise<BffOk<ListSitesResult> | { error: BffError }> {
  try {
    const response = await fetch("/api/tools/list_sites", {
      method: "GET",
      signal,
    });
    return (await response.json()) as
      BffOk<ListSitesResult> | { error: BffError };
  } catch {
    // A network-level failure (offline, unreachable BFF) must degrade to
    // the same normalized error shape `SiteContext` already branches on,
    // never an unhandled rejection from a mount-time fetch.
    return {
      error: { code: "upstream_unavailable", message: "Network error" },
    };
  }
}
