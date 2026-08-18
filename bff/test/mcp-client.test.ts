import { describe, expect, it, vi } from "vitest";
import { callTool, type McpClientDependencies } from "../src/mcp-client";
import { healthSchema } from "../../src/schemas/health";
import { linkCheckResultSchema } from "../../src/schemas/links";

function jsonRpcResult(result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id: "1", result });
}

function fakeDependencies(
  fetchImpl: (request: Request) => Promise<Response> | Response,
  overrides: Partial<McpClientDependencies> = {},
): McpClientDependencies {
  return {
    seoMcp: { fetch: vi.fn(fetchImpl) } as unknown as Fetcher,
    mcpOrigin: "https://seo-mcp.internal",
    token: "shared-mcp-token",
    timeoutMs: 5000,
    validateUpstreamResults: true,
    ...overrides,
  };
}

describe("callTool — token injection", () => {
  it("injects the shared bearer token only on the SEO_MCP fetch request", async () => {
    const dependencies = fakeDependencies(() =>
      jsonRpcResult({
        structuredContent: {
          status: "ok",
          service: "seo-mcp",
          version: "0.1.0",
        },
      }),
    );
    await callTool("health", {}, healthSchema, dependencies);
    const [upstreamRequest] = (
      dependencies.seoMcp.fetch as ReturnType<typeof vi.fn>
    ).mock.calls[0] as [Request];
    expect(upstreamRequest.headers.get("authorization")).toBe(
      `Bearer ${dependencies.token}`,
    );
  });

  it("never leaks the token into the returned result", async () => {
    const dependencies = fakeDependencies(() =>
      jsonRpcResult({
        structuredContent: {
          status: "ok",
          service: "seo-mcp",
          version: "0.1.0",
        },
      }),
    );
    const result = await callTool("health", {}, healthSchema, dependencies);
    expect(JSON.stringify(result)).not.toContain(dependencies.token);
  });
});

describe("callTool — active-site header injection (Threat Matrix row g)", () => {
  it("sets x-seo-active-site on the SEO_MCP fetch when activeSiteUrl is provided", async () => {
    const dependencies = fakeDependencies(
      () =>
        jsonRpcResult({
          structuredContent: {
            status: "ok",
            service: "seo-mcp",
            version: "0.1.0",
          },
        }),
      { activeSiteUrl: "sc-domain:example.com" },
    );
    await callTool("health", {}, healthSchema, dependencies);
    const [upstreamRequest] = (
      dependencies.seoMcp.fetch as ReturnType<typeof vi.fn>
    ).mock.calls[0] as [Request];
    expect(upstreamRequest.headers.get("x-seo-active-site")).toBe(
      "sc-domain:example.com",
    );
  });

  it("omits x-seo-active-site entirely when activeSiteUrl is absent, unchanged from before", async () => {
    const dependencies = fakeDependencies(() =>
      jsonRpcResult({
        structuredContent: {
          status: "ok",
          service: "seo-mcp",
          version: "0.1.0",
        },
      }),
    );
    await callTool("health", {}, healthSchema, dependencies);
    const [upstreamRequest] = (
      dependencies.seoMcp.fetch as ReturnType<typeof vi.fn>
    ).mock.calls[0] as [Request];
    expect(upstreamRequest.headers.get("x-seo-active-site")).toBeNull();
  });
});

describe("callTool — structuredContent re-validation", () => {
  it("returns the validated result when structuredContent conforms to the shared schema", async () => {
    const dependencies = fakeDependencies(() =>
      jsonRpcResult({
        structuredContent: {
          status: "ok",
          service: "seo-mcp",
          version: "0.1.0",
        },
      }),
    );
    const result = await callTool("health", {}, healthSchema, dependencies);
    expect(result).toEqual({
      ok: true,
      data: { status: "ok", service: "seo-mcp", version: "0.1.0" },
    });
  });

  it("maps a structuredContent shape that fails the shared schema to result_invalid", async () => {
    const dependencies = fakeDependencies(() =>
      jsonRpcResult({ structuredContent: { status: "ok" } }),
    );
    const result = await callTool("health", {}, healthSchema, dependencies);
    expect(result).toEqual({ ok: false, code: "result_invalid" });
  });

  it("skips re-validation when validateUpstreamResults is false, trusting the upstream payload", async () => {
    const dependencies = fakeDependencies(
      () => jsonRpcResult({ structuredContent: { status: "ok" } }),
      { validateUpstreamResults: false },
    );
    const result = await callTool("health", {}, healthSchema, dependencies);
    expect(result).toEqual({ ok: true, data: { status: "ok" } });
  });
});

describe("callTool — SSE-transported replies", () => {
  it("parses a text/event-stream reply the same as a plain JSON one — the real seo-mcp SDK's legacy stateless transport always responds this way, regardless of the Accept header sent", async () => {
    const dependencies = fakeDependencies(
      () =>
        new Response(
          'event: message\ndata: {"jsonrpc":"2.0","id":"1","result":{"structuredContent":{"status":"ok","service":"seo-mcp","version":"0.1.0"}}}\n\n',
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
    );
    const result = await callTool("health", {}, healthSchema, dependencies);
    expect(result).toEqual({
      ok: true,
      data: { status: "ok", service: "seo-mcp", version: "0.1.0" },
    });
  });

  it("maps a malformed text/event-stream body (no data: line) to upstream_protocol", async () => {
    const dependencies = fakeDependencies(
      () =>
        new Response("event: message\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const result = await callTool("health", {}, healthSchema, dependencies);
    expect(result).toEqual({ ok: false, code: "upstream_protocol" });
  });
});

describe("callTool — malformed upstream replies", () => {
  it("maps a non-JSON body to upstream_protocol", async () => {
    const dependencies = fakeDependencies(
      () => new Response("not json", { status: 200 }),
    );
    const result = await callTool("health", {}, healthSchema, dependencies);
    expect(result).toEqual({ ok: false, code: "upstream_protocol" });
  });

  it("maps a JSON reply missing both result and error to upstream_protocol", async () => {
    const dependencies = fakeDependencies(() =>
      Response.json({ jsonrpc: "2.0", id: "1" }),
    );
    const result = await callTool("health", {}, healthSchema, dependencies);
    expect(result).toEqual({ ok: false, code: "upstream_protocol" });
  });
});

describe("callTool — upstream transport status mapping", () => {
  it("maps an upstream 401 to upstream_unauthorized, without leaking the www-authenticate header value", async () => {
    const dependencies = fakeDependencies(
      () =>
        new Response("Unauthorized", {
          status: 401,
          headers: { "www-authenticate": 'Bearer realm="seo-mcp"' },
        }),
    );
    const result = await callTool("health", {}, healthSchema, dependencies);
    expect(result).toEqual({ ok: false, code: "upstream_unauthorized" });
  });

  it("maps an upstream 429 to upstream_rate_limited, carrying retryAfter from the retry-after header", async () => {
    const dependencies = fakeDependencies(
      () =>
        new Response("Too many requests", {
          status: 429,
          headers: { "retry-after": "60" },
        }),
    );
    const result = await callTool("health", {}, healthSchema, dependencies);
    expect(result).toEqual({
      ok: false,
      code: "upstream_rate_limited",
      retryAfter: 60,
    });
  });

  it("maps an upstream 503 to upstream_unavailable", async () => {
    const dependencies = fakeDependencies(
      () => new Response("Service unavailable", { status: 503 }),
    );
    const result = await callTool("health", {}, healthSchema, dependencies);
    expect(result).toEqual({ ok: false, code: "upstream_unavailable" });
  });

  it("maps an upstream 403 to upstream_forbidden", async () => {
    const dependencies = fakeDependencies(
      () => new Response("Forbidden", { status: 403 }),
    );
    const result = await callTool("health", {}, healthSchema, dependencies);
    expect(result).toEqual({ ok: false, code: "upstream_forbidden" });
  });

  it("distinguishes bff_timeout from upstream_unavailable for the same route", async () => {
    const timeoutDependencies = fakeDependencies(
      (request) =>
        new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener("abort", () => {
            reject(
              request.signal.reason ??
                new DOMException("Aborted", "TimeoutError"),
            );
          });
        }),
      { timeoutMs: 5 },
    );
    const timeoutResult = await callTool(
      "health",
      {},
      healthSchema,
      timeoutDependencies,
    );
    expect(timeoutResult).toEqual({ ok: false, code: "bff_timeout" });

    const unavailableDependencies = fakeDependencies(
      () => new Response("Service unavailable", { status: 503 }),
    );
    const unavailableResult = await callTool(
      "health",
      {},
      healthSchema,
      unavailableDependencies,
    );
    expect(unavailableResult).toEqual({
      ok: false,
      code: "upstream_unavailable",
    });
    expect(timeoutResult.ok).toBe(false);
    if (!timeoutResult.ok && !unavailableResult.ok) {
      expect(timeoutResult.code).not.toBe(unavailableResult.code);
    }
  });
});

describe("callTool — platform-failure mapping (check_links)", () => {
  it("maps an isError tool response to tool_failed, never an empty success", async () => {
    const dependencies = fakeDependencies(() =>
      jsonRpcResult({
        content: [{ type: "text", text: "Too many subrequests." }],
        isError: true,
      }),
    );
    const result = await callTool(
      "check_links",
      { url: "https://example.com" },
      linkCheckResultSchema,
      dependencies,
    );
    expect(result).toEqual({ ok: false, code: "tool_failed" });
  });

  it("preserves bounded checked/ok/broken/errors counts on a successful partial result", async () => {
    const partial = {
      url: "https://example.com",
      pageStatus: 200,
      checked: 12,
      ok: 10,
      broken: 2,
      errors: 0,
      results: [],
      linksFound: 12,
      truncated: false,
    };
    const dependencies = fakeDependencies(() =>
      jsonRpcResult({ structuredContent: partial }),
    );
    const result = await callTool(
      "check_links",
      { url: "https://example.com" },
      linkCheckResultSchema,
      dependencies,
    );
    expect(result).toEqual({ ok: true, data: partial });
  });
});
