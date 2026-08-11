import { describe, expect, it, vi } from "vitest";
import {
  MCP_RATE_LIMIT_KEY,
  protectMcpRequest,
  verifyTokens,
  type TimingSafeSubtleCrypto,
} from "../src/http/auth";
import type { Env } from "../src/config";

function testingSubtle(): TimingSafeSubtleCrypto {
  return {
    digest: (algorithm, data) => crypto.subtle.digest(algorithm, data),
    timingSafeEqual: vi.fn((left, right) => {
      const a = new Uint8Array(
        left instanceof ArrayBuffer ? left : left.buffer,
      );
      const b = new Uint8Array(
        right instanceof ArrayBuffer ? right : right.buffer,
      );
      return (
        a.length === b.length && a.every((value, index) => value === b[index])
      );
    }),
  };
}

function request(authorization?: string): Request {
  return new Request("https://worker.example/mcp", {
    method: "POST",
    headers: authorization ? { authorization } : undefined,
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

describe("MCP bearer authentication and rate limiting", () => {
  it("fails closed when configuration or native timing comparison is unavailable", async () => {
    const next = vi.fn(async () => new Response("next"));
    expect(
      (
        await protectMcpRequest(request(), {}, next, {
          subtle: testingSubtle(),
        })
      ).status,
    ).toBe(503);
    expect(
      (
        await protectMcpRequest(request(), environment(), next, {
          subtle: undefined,
        })
      ).status,
    ).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });

  it.each([undefined, "Basic abc", "Bearer", "Bearer wrong-token"])(
    "rejects invalid authorization %s without invoking the limiter",
    async (authorization) => {
      const limit = vi.fn();
      const next = vi.fn(async () => new Response("next"));
      const response = await protectMcpRequest(
        request(authorization),
        environment(limit),
        next,
        { subtle: testingSubtle() },
      );
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe(
        'Bearer realm="seo-mcp"',
      );
      expect(limit).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    },
  );

  it("compares hashed tokens of different lengths without throwing", async () => {
    await expect(
      verifyTokens("short", "a-much-longer-token", testingSubtle()),
    ).resolves.toBe("invalid");
  });

  it("invokes the shared limiter once and continues for a valid token", async () => {
    const limit = vi.fn().mockResolvedValue({ success: true });
    const next = vi.fn(async () => new Response("next", { status: 202 }));
    const response = await protectMcpRequest(
      request("Bearer correct-token"),
      environment(limit),
      next,
      { subtle: testingSubtle() },
    );
    expect(limit).toHaveBeenCalledOnce();
    expect(limit).toHaveBeenCalledWith({ key: MCP_RATE_LIMIT_KEY });
    expect(next).toHaveBeenCalledOnce();
    expect(response.status).toBe(202);
  });

  it("returns 429 with Retry-After when the shared bucket is exhausted", async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    const response = await protectMcpRequest(
      request("Bearer correct-token"),
      environment(limit),
      vi.fn(async () => new Response("next")),
      { subtle: testingSubtle() },
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
  });

  it("fails closed when the rate limiter binding throws", async () => {
    const limit = vi.fn().mockRejectedValue(new Error("binding unavailable"));
    const response = await protectMcpRequest(
      request("Bearer correct-token"),
      environment(limit),
      vi.fn(async () => new Response("next")),
      { subtle: testingSubtle() },
    );
    expect(response.status).toBe(503);
  });
});
