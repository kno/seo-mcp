/**
 * Quota ledger — unit coverage for `bff/src/authenticated/quota-ledger.ts`
 * itself, plus router-level wiring coverage proving the increment fires
 * on the upstream ATTEMPT and nowhere else (tasks 3.1/3.2/3.3).
 */
import { describe, expect, it, vi } from "vitest";
import {
  describeQuotaEstimate,
  getQuotaEstimate,
  incrementLedger,
  isAtOrOverBudget,
  recordUpstreamAttempt,
} from "../../src/authenticated/quota-ledger";
import { handleRequest } from "../../src/router";
import { createSessionCookie } from "../../src/session";

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

describe("incrementLedger", () => {
  it("increments the counter for the source's current window", async () => {
    const kv = fakeKv();
    const now = Date.parse("2026-08-13T00:00:00Z");
    await incrementLedger(kv, "search-console", now);
    await incrementLedger(kv, "search-console", now);
    const estimate = await getQuotaEstimate(kv, "search-console", 300, now);
    expect(estimate.atLeast).toBe(2);
    expect(estimate.basis).toBe("bff-observed");
  });

  it("keys separate sources independently", async () => {
    const kv = fakeKv();
    const now = Date.now();
    await incrementLedger(kv, "search-console", now);
    const other = await getQuotaEstimate(kv, "google-ads", 300, now);
    expect(other.atLeast).toBe(0);
  });

  it("never throws when the KV binding throws", async () => {
    await expect(
      incrementLedger(throwingKv(), "search-console", Date.now()),
    ).resolves.toBeUndefined();
  });

  it("is a no-op (never throws) when the KV binding is absent", async () => {
    await expect(
      incrementLedger(undefined, "search-console", Date.now()),
    ).resolves.toBeUndefined();
  });
});

describe("getQuotaEstimate — threat row (e): KV absent/throwing degrades, never fails closed", () => {
  it("degrades to basis unavailable when the binding is absent", async () => {
    const estimate = await getQuotaEstimate(undefined, "search-console", 300);
    expect(estimate.basis).toBe("unavailable");
    expect(estimate.atLeast).toBe(0);
  });

  it("degrades to basis unavailable when the binding throws", async () => {
    const estimate = await getQuotaEstimate(
      throwingKv(),
      "search-console",
      300,
    );
    expect(estimate.basis).toBe("unavailable");
  });
});

describe("describeQuotaEstimate — wording discipline", () => {
  it("states 'at least N calls used in this window', never a remaining count", () => {
    const message = describeQuotaEstimate({
      source: "search-console",
      atLeast: 7,
      budget: 300,
      basis: "bff-observed",
    });
    expect(message).toContain("At least 7 calls used in this window");
    expect(message).not.toMatch(/remaining/i);
  });

  it("names unavailability distinctly, never a confident zero", () => {
    const message = describeQuotaEstimate({
      source: "search-console",
      atLeast: 0,
      budget: 300,
      basis: "unavailable",
    });
    expect(message).toMatch(/unavailable/i);
  });
});

describe("isAtOrOverBudget", () => {
  it("is true at or above budget with a bff-observed basis", () => {
    expect(
      isAtOrOverBudget({
        source: "search-console",
        atLeast: 300,
        budget: 300,
        basis: "bff-observed",
      }),
    ).toBe(true);
  });

  it("is never true for an unavailable estimate, even if atLeast happens to equal budget", () => {
    expect(
      isAtOrOverBudget({
        source: "search-console",
        atLeast: 300,
        budget: 300,
        basis: "unavailable",
      }),
    ).toBe(false);
  });
});

describe("recordUpstreamAttempt — fire-and-forget via ctx.waitUntil when ctx is present", () => {
  it("hands the increment to ctx.waitUntil rather than awaiting it inline", async () => {
    const kv = fakeKv();
    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;

    await recordUpstreamAttempt(ctx, kv, "search-console", Date.now());
    // recordUpstreamAttempt resolved without this test ever awaiting the
    // ledger write directly — the only way it could complete the KV write
    // is through the promise handed to ctx.waitUntil.
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
    const estimate = await getQuotaEstimate(kv, "search-console", 300);
    expect(estimate.atLeast).toBe(1);
  });

  it("awaits the increment inline when ctx is absent (test-only fallback)", async () => {
    const kv = fakeKv();
    await recordUpstreamAttempt(undefined, kv, "search-console", Date.now());
    const estimate = await getQuotaEstimate(kv, "search-console", 300);
    expect(estimate.atLeast).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Router-level wiring: the ledger increments on the upstream ATTEMPT and
// nowhere else (tasks 3.1, 3.2).
// ---------------------------------------------------------------------------

function stubToolFetch(structuredContent: unknown, isError = false) {
  return vi.fn(async () =>
    Response.json({
      jsonrpc: "2.0",
      id: "1",
      result: isError
        ? { isError: true, content: [{ type: "text", text: "boom" }] }
        : { structuredContent },
    }),
  );
}

const GSC_RESULT = {
  siteUrl: "https://example.com",
  startDate: "2026-07-01",
  endDate: "2026-07-28",
  dimensions: ["query", "page"],
  rowCount: 1,
  rows: [{ keys: ["q"], clicks: 1, impressions: 1, ctr: 1, position: 1 }],
};

function fakeEnv(overrides: Partial<Env> = {}): Env {
  return {
    GATE_STRATEGY: "shared-secret-cookie",
    MCP_ORIGIN: "https://seo-mcp.internal",
    DASHBOARD_SECRET: "top-secret-value",
    DASHBOARD_SESSION_KEY: "session-signing-key",
    MCP_AUTH_TOKEN: "mcp-token",
    SEO_MCP: { fetch: stubToolFetch(GSC_RESULT) } as unknown as Fetcher,
    RESULT_CACHE: fakeKv(),
    AUTH_SOURCE_TTL_SECONDS: { "search-console": { closed: 21600, open: 900 } },
    AUTH_SOURCE_BUDGET: { "search-console": 300 },
    ...overrides,
  } as unknown as Env;
}

async function authenticatedRequest(env: Env, path: string): Promise<Request> {
  const cookie = await createSessionCookie(
    "dashboard",
    3600,
    env.DASHBOARD_SESSION_KEY,
  );
  return new Request(`https://bff.example${path}`, {
    headers: { cookie: `dashboard_session=${cookie}` },
  });
}

const GSC_PATH =
  "/api/tools/search_console_query?siteUrl=https%3A%2F%2Fexample.com&startDate=2026-07-01&endDate=2026-07-28";

describe("router — quota ledger increments on upstream attempt only", () => {
  it("increments once on a real cache-miss upstream call", async () => {
    const env = fakeEnv();
    const request = await authenticatedRequest(env, GSC_PATH);
    await handleRequest(request, env);
    const estimate = await getQuotaEstimate(
      env.RESULT_CACHE,
      "search-console",
      300,
    );
    expect(estimate.atLeast).toBe(1);
  });

  it("never increments on a cache hit", async () => {
    const env = fakeEnv();
    const first = await authenticatedRequest(env, GSC_PATH);
    await handleRequest(first, env);
    const afterFirst = await getQuotaEstimate(
      env.RESULT_CACHE,
      "search-console",
      300,
    );
    expect(afterFirst.atLeast).toBe(1);

    const second = await authenticatedRequest(env, GSC_PATH);
    const response = await handleRequest(second, env);
    const body = (await response.json()) as { cacheStatus: string };
    expect(body.cacheStatus).toBe("hit");
    const afterSecond = await getQuotaEstimate(
      env.RESULT_CACHE,
      "search-console",
      300,
    );
    expect(afterSecond.atLeast).toBe(1); // unchanged — the cache hit never attempted upstream
  });

  it("never increments on a gate rejection (unauthenticated request)", async () => {
    const env = fakeEnv();
    const response = await handleRequest(
      new Request(`https://bff.example${GSC_PATH}`),
      env,
    );
    expect(response.status).toBe(401);
    const estimate = await getQuotaEstimate(
      env.RESULT_CACHE,
      "search-console",
      300,
    );
    expect(estimate.atLeast).toBe(0);
    expect(env.SEO_MCP.fetch).not.toHaveBeenCalled();
  });

  it("never increments on invalid input (fails schema validation before dispatch)", async () => {
    const env = fakeEnv();
    const request = await authenticatedRequest(
      env,
      "/api/tools/search_console_query?siteUrl=&startDate=bad&endDate=2026-07-28",
    );
    const response = await handleRequest(request, env);
    expect(response.status).toBe(400);
    const estimate = await getQuotaEstimate(
      env.RESULT_CACHE,
      "search-console",
      300,
    );
    expect(estimate.atLeast).toBe(0);
    expect(env.SEO_MCP.fetch).not.toHaveBeenCalled();
  });

  it("still increments once even when the upstream call itself fails (attempt, not success)", async () => {
    const env = fakeEnv({
      SEO_MCP: { fetch: stubToolFetch(undefined, true) } as unknown as Fetcher,
    });
    const request = await authenticatedRequest(env, GSC_PATH);
    const response = await handleRequest(request, env);
    expect(response.status).toBe(422); // unmatched failure text -> non-retryable default
    const estimate = await getQuotaEstimate(
      env.RESULT_CACHE,
      "search-console",
      300,
    );
    expect(estimate.atLeast).toBe(1);
  });
});

describe("router — threat row (e): KV absent/throwing serves a live result with an unavailable estimate", () => {
  it("serves the live result and marks quota basis unavailable when RESULT_CACHE is absent", async () => {
    const env = fakeEnv({ RESULT_CACHE: undefined });
    const request = await authenticatedRequest(env, GSC_PATH);
    const response = await handleRequest(request, env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: unknown;
      quota?: { basis: string };
    };
    expect(body.data).toBeDefined();
    expect(body.quota?.basis).toBe("unavailable");
  });

  it("serves the live result and marks quota basis unavailable when RESULT_CACHE throws", async () => {
    const env = fakeEnv({ RESULT_CACHE: throwingKv() });
    const request = await authenticatedRequest(env, GSC_PATH);
    const response = await handleRequest(request, env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: unknown;
      quota?: { basis: string };
    };
    expect(body.data).toBeDefined();
    expect(body.quota?.basis).toBe("unavailable");
  });
});
