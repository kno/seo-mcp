import { describe, expect, it, vi } from "vitest";
import { boundMcpRequest } from "../src/http/inbound";

function streamedRequest(
  chunks: string[],
  headers: Record<string, string> = {},
): { request: Request; cancel: ReturnType<typeof vi.fn> } {
  const cancel = vi.fn();
  const encoder = new TextEncoder();
  let index = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (index < chunks.length)
          controller.enqueue(encoder.encode(chunks[index++]));
        else controller.close();
      },
      cancel,
    },
    { highWaterMark: 0 },
  );
  const request = new Request("https://worker.example/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  return { request, cancel };
}

describe("boundMcpRequest", () => {
  it("rejects and cancels a declared oversized body", async () => {
    const { request, cancel } = streamedRequest(["{}"], {
      "content-length": "101",
    });
    const result = await boundMcpRequest(request, 100);
    expect(result.response?.status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects and cancels a chunked body after crossing the limit", async () => {
    const { request, cancel } = streamedRequest(['{"x":"', "1234567890", '"}']);
    const result = await boundMcpRequest(request, 10);
    expect(result.response?.status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects invalid JSON and rebuilds valid bounded JSON", async () => {
    const invalid = await boundMcpRequest(streamedRequest(["{"]).request);
    expect(invalid.response?.status).toBe(400);

    const valid = await boundMcpRequest(
      streamedRequest(['{"jsonrpc":"2.0"}']).request,
    );
    expect(valid.request && (await valid.request.json())).toEqual({
      jsonrpc: "2.0",
    });
  });
});
