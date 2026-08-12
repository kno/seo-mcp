import { describe, expect, it, vi } from "vitest";
import { inFlightSizeForTest, withSingleFlight } from "../src/single-flight";

/** Resolves/rejects only when `release()` is called, to force overlap. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("withSingleFlight — leader/follower coalescing within one isolate", () => {
  it("makes only one real call for concurrent identical keys", async () => {
    const gate = deferred<string>();
    const client = vi.fn(() => gate.promise);

    const first = withSingleFlight("v1:health:abc", client);
    const second = withSingleFlight("v1:health:abc", client);

    expect(client).toHaveBeenCalledTimes(1);

    gate.resolve("result");
    await expect(first).resolves.toBe("result");
    await expect(second).resolves.toBe("result");
    expect(client).toHaveBeenCalledTimes(1);
  });

  it("does not coalesce different keys", async () => {
    const clientA = vi.fn(async () => "a");
    const clientB = vi.fn(async () => "b");

    await Promise.all([
      withSingleFlight("v1:health:aaa", clientA),
      withSingleFlight("v1:health:bbb", clientB),
    ]);

    expect(clientA).toHaveBeenCalledTimes(1);
    expect(clientB).toHaveBeenCalledTimes(1);
  });

  it("deletes the map entry in a finally block after a successful call", async () => {
    await withSingleFlight("v1:health:ok", async () => "done");
    expect(inFlightSizeForTest()).toBe(0);
  });

  it("deletes the map entry in a finally block even when the call fails", async () => {
    await expect(
      withSingleFlight("v1:health:fail", async () => {
        throw new Error("upstream boom");
      }),
    ).rejects.toThrow("upstream boom");
    expect(inFlightSizeForTest()).toBe(0);
  });

  it("allows a fresh leader for the same key after a prior failure cleared it", async () => {
    await expect(
      withSingleFlight("v1:health:retry", async () => {
        throw new Error("first attempt fails");
      }),
    ).rejects.toThrow("first attempt fails");

    const result = await withSingleFlight(
      "v1:health:retry",
      async () => "second attempt succeeds",
    );
    expect(result).toBe("second attempt succeeds");
  });

  it("propagates the leader's rejection to every follower", async () => {
    const gate = deferred<never>();
    const client = vi.fn(() => gate.promise);

    const first = withSingleFlight("v1:health:shared-failure", client);
    const second = withSingleFlight("v1:health:shared-failure", client);

    gate.reject(new Error("leader failed"));

    await expect(first).rejects.toThrow("leader failed");
    await expect(second).rejects.toThrow("leader failed");
    expect(client).toHaveBeenCalledTimes(1);
  });
});

// Cross-isolate coalescing is an accepted best-effort limitation: this
// module is a plain isolate-local `Map`, so no test asserts coalescing
// across isolates — there is nothing in-process to assert on, and Workers
// give no guarantee two concurrent requests share an isolate at all.
