/**
 * Isolate-local, best-effort single-flight dedupe.
 *
 * A module-level `Map<string, Promise<T>>` keyed ONLY by the content hash
 * (the same string `bff/src/cache.ts`'s `cacheKey` produces), never by
 * caller identity. Concurrent callers for the same key within one isolate
 * await the SAME promise (one leader makes the real call; followers get
 * the leader's promise directly). The entry is deleted in a `finally`
 * block, so a failed leader call does not permanently block later
 * attempts for that key.
 *
 * This is explicitly isolate-local: Workers give no guarantee that two
 * concurrent requests land in the same isolate, so cross-isolate
 * coalescing is an accepted best-effort limitation, not a contract this
 * module tries to uphold.
 */

const inFlight = new Map<string, Promise<unknown>>();

export async function withSingleFlight<T>(
  key: string,
  run: () => Promise<T>,
): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = run();
  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}

/** Test-only escape hatch to inspect leak-freedom between test cases. */
export function inFlightSizeForTest(): number {
  return inFlight.size;
}
