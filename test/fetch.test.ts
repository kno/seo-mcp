import { describe, expect, it, vi } from "vitest";
import { createResponseByteBudget, fetchBounded } from "../src/http/fetch";

function responseWithStream(chunks: string[], init: ResponseInit = {}) {
  const cancel = vi.fn();
  const encoder = new TextEncoder();
  let index = 0;
  const body = new ReadableStream<Uint8Array>(
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
  return { response: new Response(body, init), cancel };
}

describe("fetchBounded", () => {
  it("cancels a streamed response that crosses the byte limit", async () => {
    const streamed = responseWithStream(["1234", "5678"]);
    await expect(
      fetchBounded("https://example.com", {
        maxBytes: 5,
        accept: "text/plain",
        fetcher: async () => streamed.response,
      }),
    ).rejects.toThrow("byte limit");
    expect(streamed.cancel).toHaveBeenCalledOnce();
  });

  it("enforces a shared aggregate response-byte budget", async () => {
    const streamed = responseWithStream(["1234", "5678"]);
    await expect(
      fetchBounded("https://example.com", {
        maxBytes: 20,
        accept: "text/plain",
        byteBudget: createResponseByteBudget(5),
        fetcher: async () => streamed.response,
      }),
    ).rejects.toThrow("byte budget");
    expect(streamed.cancel).toHaveBeenCalledOnce();
  });

  it("cancels redirect bodies and revalidates redirect destinations", async () => {
    const redirect = responseWithStream(["ignored"], {
      status: 302,
      headers: { location: "https://example.com/final" },
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(redirect.response)
      .mockResolvedValueOnce(
        new Response("ok", { headers: { "content-type": "text/plain" } }),
      );
    const result = await fetchBounded("https://example.com/start", {
      maxBytes: 10,
      accept: "text/plain",
      fetcher,
    });
    expect(result.url.toString()).toBe("https://example.com/final");
    expect(redirect.cancel).toHaveBeenCalledOnce();

    const unsafe = responseWithStream([], {
      status: 302,
      headers: { location: "http://127.0.0.1/admin" },
    });
    await expect(
      fetchBounded("https://example.com", {
        maxBytes: 10,
        accept: "text/plain",
        fetcher: async () => unsafe.response,
      }),
    ).rejects.toThrow("not allowed");
  });
});
