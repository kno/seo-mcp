import { describe, expect, it, vi } from "vitest";
import { mintState, verifyState } from "../../src/oauth/state";

function fakeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(
      async (
        key: string,
        value: string,
        _options?: { expirationTtl?: number },
      ) => {
        store.set(key, value);
      },
    ),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  } as unknown as KVNamespace;
}

const KEY = "state-signing-key";

describe("mintState / verifyState", () => {
  it("round-trips a freshly minted state token", async () => {
    const kv = fakeKv();
    const token = await mintState({ siteId: 7, sub: "dashboard" }, KEY, kv);
    expect(token).toBeDefined();
    const outcome = await verifyState(token as string, KEY, "dashboard", kv);
    expect(outcome).toEqual({
      ok: true,
      payload: { siteId: 7, sub: "dashboard" },
    });
  });

  it("rejects a forged signature", async () => {
    const kv = fakeKv();
    const token = await mintState({ siteId: 7, sub: "dashboard" }, KEY, kv);
    const outcome = await verifyState(`${token}tampered`, KEY, "dashboard", kv);
    expect(outcome.ok).toBe(false);
  });

  it("rejects siteId tampering (invalidates the signature)", async () => {
    const kv = fakeKv();
    const token = await mintState({ siteId: 7, sub: "dashboard" }, KEY, kv);
    const [encodedMessage, encodedSignature] = (token as string).split(".");
    const tamperedMessage = Buffer.from(
      Buffer.from(
        encodedMessage.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      )
        .toString("utf8")
        .replace("|7|", "|999|"),
      "utf8",
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const outcome = await verifyState(
      `${tamperedMessage}.${encodedSignature}`,
      KEY,
      "dashboard",
      kv,
    );
    expect(outcome.ok).toBe(false);
  });

  it("rejects a replayed state on its second use", async () => {
    const kv = fakeKv();
    const token = await mintState({ siteId: 7, sub: "dashboard" }, KEY, kv);
    const first = await verifyState(token as string, KEY, "dashboard", kv);
    expect(first.ok).toBe(true);
    const second = await verifyState(token as string, KEY, "dashboard", kv);
    expect(second).toEqual({ ok: false, reason: "replayed" });
  });

  it("rejects an expired state", async () => {
    const kv = fakeKv();
    let now = 0;
    const token = await mintState({ siteId: 7, sub: "dashboard" }, KEY, kv, {
      now: () => now,
    });
    now = 700_000; // past the 600s TTL
    const outcome = await verifyState(token as string, KEY, "dashboard", kv, {
      now: () => now,
    });
    expect(outcome).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a session-sub mismatch", async () => {
    const kv = fakeKv();
    const token = await mintState({ siteId: 7, sub: "dashboard" }, KEY, kv);
    const outcome = await verifyState(token as string, KEY, "someone-else", kv);
    expect(outcome).toEqual({ ok: false, reason: "sub_mismatch" });
  });
});
