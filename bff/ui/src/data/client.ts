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
}

/**
 * Calls the BFF's `GET /api/tools/{tool}` route. The real route contract
 * (verified against `bff/src/router.ts`) takes inputs as query-string
 * parameters on a GET request, not a POST body — this function matches
 * that frozen contract rather than the design note's illustrative
 * `POST /api/tools/{tool}` shape (see apply-progress for the deviation).
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
