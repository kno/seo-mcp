import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  CACHE_TTL_SECONDS,
  MAX_TTL_SECONDS,
  MIN_TTL_SECONDS,
  authRangeState,
  authenticatedTtlSeconds,
  cacheKey,
  canonicalJson,
  clampTtlSeconds,
  getCached,
  isCacheable,
  putCached,
  shouldBypassCacheRead,
  type AuthSourceTtlTable,
} from "../src/cache";

function fakeKv(initial: Record<string, string> = {}): KVNamespace {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  } as unknown as KVNamespace;
}

function throwingKv(): KVNamespace {
  return {
    get: vi.fn(async () => {
      throw new Error("KV unreachable");
    }),
    put: vi.fn(async () => {
      throw new Error("KV unreachable");
    }),
  } as unknown as KVNamespace;
}

describe("canonicalJson", () => {
  it("produces the same serialization regardless of key insertion order", () => {
    const a = canonicalJson({ a: 1, b: 2 });
    const b = canonicalJson({ b: 2, a: 1 });
    expect(a).toBe(b);
  });

  it("sorts keys recursively in nested objects", () => {
    const a = canonicalJson({ outer: { z: 1, y: 2 }, first: true });
    const b = canonicalJson({ first: true, outer: { y: 2, z: 1 } });
    expect(a).toBe(b);
  });
});

describe("cacheKey", () => {
  it("produces the v1:{tool}:{sha256} shape", async () => {
    const key = await cacheKey("crawl_page", { url: "https://example.com" });
    expect(key).toMatch(/^v1:crawl_page:[0-9a-f]{64}$/);
  });

  it("produces the same key for logically-equal inputs in a different order", async () => {
    const keyA = await cacheKey("crawl_site", {
      url: "https://example.com",
      limit: 10,
    });
    const keyB = await cacheKey("crawl_site", {
      limit: 10,
      url: "https://example.com",
    });
    expect(keyA).toBe(keyB);
  });

  it("produces a different key for different inputs", async () => {
    const keyA = await cacheKey("crawl_page", { url: "https://a.example.com" });
    const keyB = await cacheKey("crawl_page", { url: "https://b.example.com" });
    expect(keyA).not.toBe(keyB);
  });
});

describe("isCacheable", () => {
  it("is cacheable for every route without a secret input", () => {
    expect(isCacheable("health", {})).toBe(true);
    expect(isCacheable("crawl_page", { url: "https://example.com" })).toBe(
      true,
    );
    expect(
      isCacheable("crawl_site", { url: "https://example.com", limit: 10 }),
    ).toBe(true);
    expect(isCacheable("check_links", { url: "https://example.com" })).toBe(
      true,
    );
  });

  it("is cacheable for analyze_pagespeed when apiKey is omitted", () => {
    expect(
      isCacheable("analyze_pagespeed", {
        url: "https://example.com",
        strategy: "mobile",
      }),
    ).toBe(true);
  });

  it("is NEVER cacheable for analyze_pagespeed when apiKey is present", () => {
    expect(
      isCacheable("analyze_pagespeed", {
        url: "https://example.com",
        strategy: "mobile",
        apiKey: "secret-key",
      }),
    ).toBe(false);
  });
});

describe("clampTtlSeconds", () => {
  it("clamps a value below the minimum up to 60", () => {
    expect(clampTtlSeconds(1)).toBe(MIN_TTL_SECONDS);
  });

  it("clamps a value above the maximum down to 86400", () => {
    expect(clampTtlSeconds(1_000_000)).toBe(MAX_TTL_SECONDS);
  });

  it("leaves an in-range value unchanged", () => {
    expect(clampTtlSeconds(3600)).toBe(3600);
  });

  it("declares every tool's default TTL within the clamp bounds", () => {
    for (const ttl of Object.values(CACHE_TTL_SECONDS)) {
      expect(ttl).toBeGreaterThanOrEqual(MIN_TTL_SECONDS);
      expect(ttl).toBeLessThanOrEqual(MAX_TTL_SECONDS);
    }
  });
});

describe("shouldBypassCacheRead", () => {
  it("bypasses when ?refresh=1 is present", () => {
    const request = new Request(
      "https://bff.example/api/tools/health?refresh=1",
    );
    const url = new URL(request.url);
    expect(shouldBypassCacheRead(request, url)).toBe(true);
  });

  it("bypasses when Cache-Control: no-cache is present", () => {
    const request = new Request("https://bff.example/api/tools/health", {
      headers: { "cache-control": "no-cache" },
    });
    const url = new URL(request.url);
    expect(shouldBypassCacheRead(request, url)).toBe(true);
  });

  it("does not bypass a plain request", () => {
    const request = new Request("https://bff.example/api/tools/health");
    const url = new URL(request.url);
    expect(shouldBypassCacheRead(request, url)).toBe(false);
  });
});

describe("getCached / putCached — hit, miss, and TTL expiry", () => {
  it("is a miss when the key was never written", async () => {
    const kv = fakeKv();
    const outcome = await getCached(kv, "v1:health:none");
    expect(outcome).toEqual({ status: "miss" });
  });

  it("is a hit with the stored data and a resultAge after a write", async () => {
    const kv = fakeKv();
    await putCached(kv, "v1:health:abc", "health", { status: "ok" }, 3600);
    const outcome = await getCached<{ status: string }>(kv, "v1:health:abc");
    expect(outcome.status).toBe("hit");
    if (outcome.status === "hit") {
      expect(outcome.data).toEqual({ status: "ok" });
      expect(outcome.resultAge).toBeGreaterThanOrEqual(0);
    }
  });

  it("clamps the TTL written to KV to the [60, 86400] range", async () => {
    const kv = fakeKv();
    await putCached(kv, "v1:health:ttl", "health", { status: "ok" }, 5);
    expect(kv.put).toHaveBeenCalledWith(
      "v1:health:ttl",
      expect.any(String),
      expect.objectContaining({ expirationTtl: MIN_TTL_SECONDS }),
    );
  });

  it("treats an entry past its own expiresAt as a miss", async () => {
    const kv = fakeKv();
    const past = Date.now() - 10_000;
    await kv.put(
      "v1:health:expired",
      JSON.stringify({
        storedAt: past - 60_000,
        expiresAt: past,
        tool: "health",
        result: { status: "ok" },
      }),
    );
    const outcome = await getCached(kv, "v1:health:expired");
    expect(outcome).toEqual({ status: "miss" });
  });
});

describe("getCached / putCached — KV absence or failure is unavailable, never fail-closed", () => {
  it("is unavailable when no KV binding is provided", async () => {
    const outcome = await getCached(undefined, "v1:health:none");
    expect(outcome).toEqual({ status: "unavailable" });
  });

  it("does not throw when putCached is called without a KV binding", async () => {
    await expect(
      putCached(undefined, "v1:health:none", "health", { status: "ok" }, 60),
    ).resolves.toBeUndefined();
  });

  it("is unavailable when the KV get() throws", async () => {
    const kv = throwingKv();
    const outcome = await getCached(kv, "v1:health:boom");
    expect(outcome).toEqual({ status: "unavailable" });
  });

  it("does not throw when the KV put() throws", async () => {
    const kv = throwingKv();
    await expect(
      putCached(kv, "v1:health:boom", "health", { status: "ok" }, 60),
    ).resolves.toBeUndefined();
  });
});

describe("authRangeState — closed vs open by reporting-lag boundary", () => {
  const today = new Date("2026-08-13T00:00:00Z");
  const LAG_DAYS = 2; // matches authenticated/freshness.ts's GSC_REPORTING_LAG_DAYS

  it("is closed when endDate is strictly older than the lag boundary (today - lagDays)", () => {
    expect(authRangeState("2026-08-10", LAG_DAYS, today)).toBe("closed");
  });

  it("is open when endDate falls exactly on the lag boundary", () => {
    expect(authRangeState("2026-08-11", LAG_DAYS, today)).toBe("open");
  });

  it("is open when endDate is inside the still-landing window", () => {
    expect(authRangeState("2026-08-13", LAG_DAYS, today)).toBe("open");
  });
});

describe("authenticatedTtlSeconds — the authenticated-delayed cache class", () => {
  const ttlTable: AuthSourceTtlTable = {
    "search-console": { closed: 21600, open: 900 },
  };

  it("uses the long closed TTL for a settled range with rows", () => {
    expect(
      authenticatedTtlSeconds(ttlTable, "search-console", "closed", false),
    ).toBe(21600);
  });

  it("uses the short open TTL for a still-landing range with rows", () => {
    expect(
      authenticatedTtlSeconds(ttlTable, "search-console", "open", false),
    ).toBe(900);
  });

  it("forces the short open TTL for a zero-row result even on a closed range", () => {
    // A zero-row result for a still-landing date range might not stay
    // zero — never cache it at the long TTL as though it were final.
    expect(
      authenticatedTtlSeconds(ttlTable, "search-console", "closed", true),
    ).toBe(900);
  });

  it("clamps a misconfigured value to this module's [60, 86400] ceiling", () => {
    const oversized: AuthSourceTtlTable = {
      "search-console": { closed: 999_999, open: 10 },
    };
    expect(
      authenticatedTtlSeconds(oversized, "search-console", "closed", false),
    ).toBe(MAX_TTL_SECONDS);
    expect(
      authenticatedTtlSeconds(oversized, "search-console", "open", false),
    ).toBe(MIN_TTL_SECONDS);
  });
});

describe("no server-side timer/interval revalidation anywhere in bff/src (no-polling, server half)", () => {
  const SRC_ROOT = join(__dirname, "..", "src");
  const BANNED_TOKENS = ["setInterval", "setTimeout"] as const;

  function collectSourceFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        files.push(...collectSourceFiles(fullPath));
        continue;
      }
      if (/\.ts$/.test(entry) && !entry.endsWith(".test.ts")) {
        files.push(fullPath);
      }
    }
    return files;
  }

  const files = collectSourceFiles(SRC_ROOT);

  it("scans at least one real production source file (proves this is not a placeholder)", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain(join(SRC_ROOT, "cache.ts"));
  });

  it.each(files.map((file) => [file] as const))(
    "%s registers no setInterval/setTimeout",
    (file) => {
      const content = readFileSync(file, "utf-8");
      for (const token of BANNED_TOKENS) {
        expect(content, `${file} must not contain "${token}"`).not.toContain(
          token,
        );
      }
    },
  );
});
