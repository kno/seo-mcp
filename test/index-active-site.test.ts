import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { buildServerMock } = vi.hoisted(() => ({
  buildServerMock: vi.fn(() => ({}) as unknown),
}));
vi.mock("../src/server", () => ({ buildServer: buildServerMock }));

vi.mock("@modelcontextprotocol/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@modelcontextprotocol/server")>();
  return {
    ...actual,
    createMcpHandler: (factory: () => unknown) => ({
      fetch: async () => {
        factory();
        return new Response("ok");
      },
    }),
  };
});

import worker from "../src/index";
import type { Env } from "../src/config";

function environment(): Env {
  return {
    MCP_AUTH_TOKEN: "correct-token",
    MCP_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
  };
}

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://worker.example/mcp", {
    method: "POST",
    headers: {
      host: "worker.example",
      origin: "https://worker.example",
      authorization: "Bearer correct-token",
      "content-type": "application/json",
      ...headers,
    },
    body: "{}",
  });
}

const nativeSubtle = globalThis.crypto.subtle;

describe("Worker threads the x-seo-active-site header into buildServer as per-request state (Threat Matrix row g)", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", {
      subtle: {
        digest: nativeSubtle.digest.bind(nativeSubtle),
        timingSafeEqual(left: ArrayBuffer, right: ArrayBuffer): boolean {
          const a = new Uint8Array(left);
          const b = new Uint8Array(right);
          return (
            a.length === b.length &&
            a.every((value, index) => value === b[index])
          );
        },
      },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("passes { activeSiteUrl } when the header is present", async () => {
    buildServerMock.mockClear();
    await worker.fetch(
      request({ "x-seo-active-site": "sc-domain:example.com" }),
      environment(),
    );
    expect(buildServerMock).toHaveBeenCalledWith(expect.anything(), {
      activeSiteUrl: "sc-domain:example.com",
    });
  });

  it("passes undefined when the header is absent — unchanged global-tier resolution", async () => {
    buildServerMock.mockClear();
    await worker.fetch(request(), environment());
    expect(buildServerMock).toHaveBeenCalledWith(expect.anything(), undefined);
  });
});
