import { env as workerEnv } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/google/search-console", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/google/search-console")>();
  return { ...actual, searchConsoleQuery: vi.fn() };
});
vi.mock("../../src/google/credentials", () => ({
  resolveSiteCredentials: vi.fn(),
}));

import {
  searchConsoleQuery,
  SearchConsoleHttpError,
} from "../../src/google/search-console";
import { resolveSiteCredentials } from "../../src/google/credentials";
import { buildServer } from "../../src/server";
import { getSiteCredentialHealth } from "../../src/db/site-credential-store";
import type { ResolvedCredential } from "../../src/google/credential-types";

const DB = (workerEnv as { DB: D1Database }).DB;

const SITE_URL = "sc-domain:wiring-example.com";
const RESOLVED: ResolvedCredential = {
  credentials: { clientId: "c", clientSecret: "s", refreshToken: "r" },
  source: "site",
  accountKey: "account-key-1",
  accountLabel: "owner@example.com",
};

type ToolHandle = {
  handler: (
    args: unknown,
    ctx: unknown,
  ) => Promise<{ isError?: boolean; content: unknown[] }>;
};

function registeredTool(name: string): ToolHandle {
  const server = buildServer({ DB });
  return (server as unknown as { _registeredTools: Record<string, ToolHandle> })
    ._registeredTools[name];
}

beforeAll(async () => {
  await DB.exec(
    "CREATE TABLE IF NOT EXISTS sites (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL UNIQUE, label TEXT, created_at TEXT NOT NULL)",
  );
  await DB.exec(
    "CREATE TABLE IF NOT EXISTS site_credential_health (site_id INTEGER NOT NULL, source TEXT NOT NULL, credential_source TEXT NOT NULL, account_key TEXT NOT NULL, state TEXT NOT NULL, reason TEXT, detail TEXT, checked_at TEXT NOT NULL, expires_at TEXT NOT NULL, PRIMARY KEY (site_id, source))",
  );
});

beforeEach(async () => {
  await DB.exec("DELETE FROM sites");
  await DB.exec("DELETE FROM site_credential_health");
  await DB.prepare(
    "INSERT INTO sites (id, url, label, created_at) VALUES (?, ?, NULL, ?)",
  )
    .bind(1, SITE_URL, new Date().toISOString())
    .run();
  vi.mocked(resolveSiteCredentials).mockResolvedValue(RESOLVED);
});

describe("search_console_query wires real call outcomes into credential health", () => {
  it("a credential-shaped failure (401) marks the site's search-console health unhealthy", async () => {
    vi.mocked(searchConsoleQuery).mockRejectedValue(
      new SearchConsoleHttpError("Request had invalid authentication", 401),
    );

    const tool = registeredTool("search_console_query");
    const response = await tool.handler(
      { siteUrl: SITE_URL, startDate: "2026-01-01", endDate: "2026-01-31" },
      {},
    );

    expect(response.isError).toBe(true);
    const health = await getSiteCredentialHealth(DB, 1, "search-console");
    expect(health?.state).toBe("unhealthy");
    expect(health?.reason).toBe("credential_rejected");
  });

  it("a non-credential failure (network timeout) does not touch credential health", async () => {
    vi.mocked(searchConsoleQuery).mockRejectedValue(
      new Error("The operation was aborted"),
    );

    const tool = registeredTool("search_console_query");
    const response = await tool.handler(
      { siteUrl: SITE_URL, startDate: "2026-01-01", endDate: "2026-01-31" },
      {},
    );

    expect(response.isError).toBe(true);
    const health = await getSiteCredentialHealth(DB, 1, "search-console");
    expect(health).toBeNull();
  });

  it("a successful call extends the site's search-console health to healthy", async () => {
    vi.mocked(searchConsoleQuery).mockResolvedValue({
      siteUrl: SITE_URL,
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      dimensions: ["query", "page"],
      rowCount: 0,
      rows: [],
    });

    const tool = registeredTool("search_console_query");
    const response = await tool.handler(
      { siteUrl: SITE_URL, startDate: "2026-01-01", endDate: "2026-01-31" },
      {},
    );

    expect(response.isError).toBeUndefined();
    const health = await getSiteCredentialHealth(DB, 1, "search-console");
    expect(health?.state).toBe("healthy");
  });
});
