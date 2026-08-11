import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/config";

const nativeSubtle = globalThis.crypto.subtle;

function request(
  path = "/mcp",
  options: {
    authorization?: string;
    contentType?: string;
    host?: string;
    origin?: string;
  } = {},
): Request {
  const headers = new Headers({
    host: options.host ?? "worker.example",
    origin: options.origin ?? "https://worker.example",
  });
  if (options.authorization)
    headers.set("authorization", options.authorization);
  if (options.contentType) headers.set("content-type", options.contentType);
  return new Request(`https://worker.example${path}`, {
    method: "POST",
    headers,
    body: "{}",
  });
}

function environment(
  limit = vi.fn().mockResolvedValue({ success: true }),
): Env {
  return {
    MCP_AUTH_TOKEN: "correct-token",
    MCP_RATE_LIMITER: { limit },
  };
}

describe("Worker MCP request pipeline", () => {
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

  it("returns 404 outside the MCP route", async () => {
    expect((await worker.fetch(request("/health"), {})).status).toBe(404);
  });

  it.each([
    { host: "attacker.example" },
    { origin: "https://attacker.example" },
  ])(
    "rejects invalid request policy before authentication",
    async (headers) => {
      const limit = vi.fn();
      const response = await worker.fetch(
        request("/mcp", {
          authorization: "Bearer correct-token",
          ...headers,
        }),
        environment(limit),
      );
      expect(response.status).toBe(403);
      expect(limit).not.toHaveBeenCalled();
    },
  );

  it("fails closed when authentication configuration is missing", async () => {
    expect((await worker.fetch(request(), {})).status).toBe(503);
  });

  it("rejects an invalid bearer token before rate limiting", async () => {
    const limit = vi.fn();
    const response = await worker.fetch(
      request("/mcp", { authorization: "Bearer wrong-token" }),
      environment(limit),
    );
    expect(response.status).toBe(401);
    expect(limit).not.toHaveBeenCalled();
  });

  it("rate limits an authenticated request before reading its body", async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    const response = await worker.fetch(
      request("/mcp", {
        authorization: "Bearer correct-token",
        contentType: "text/plain",
      }),
      environment(limit),
    );
    expect(response.status).toBe(429);
    expect(limit).toHaveBeenCalledOnce();
  });

  it("sends an allowed authenticated request into inbound validation", async () => {
    const limit = vi.fn().mockResolvedValue({ success: true });
    const response = await worker.fetch(
      request("/mcp", {
        authorization: "Bearer correct-token",
        contentType: "text/plain",
      }),
      environment(limit),
    );
    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toEqual({
      error: "Content-Type must be application/json",
    });
    expect(limit).toHaveBeenCalledOnce();
  });
});
