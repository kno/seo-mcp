import { describe, expect, it, vi } from "vitest";
import { probeLink } from "../src/crawl/links";
import { LIMITS } from "../src/config";

function bodyResponse(
  status: number,
  init: ResponseInit = {},
): { response: Response; cancel: ReturnType<typeof vi.fn> } {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new TextEncoder().encode("x"));
      controller.close();
    },
    cancel,
  });
  return { response: new Response(body, { status, ...init }), cancel };
}

describe("probeLink", () => {
  it("classifies a 200 response as ok and cancels the body", async () => {
    const { response, cancel } = bodyResponse(200);
    const fetcher = vi.fn<typeof fetch>(async () => response);
    const probe = await probeLink("https://example.com/page", fetcher);
    expect(probe).toEqual({
      url: "https://example.com/page",
      state: "ok",
      status: 200,
      redirects: 0,
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("classifies a 404 response as broken", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => bodyResponse(404).response);
    const probe = await probeLink("https://example.com/missing", fetcher);
    expect(probe).toMatchObject({
      url: "https://example.com/missing",
      state: "broken",
      status: 404,
      redirects: 0,
    });
  });

  it("classifies a 500 response as broken", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => bodyResponse(500).response);
    const probe = await probeLink("https://example.com/boom", fetcher);
    expect(probe).toMatchObject({ state: "broken", status: 500 });
  });

  it("follows a 3xx chain to a 200 and counts redirect hops", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input.toString());
      if (url.pathname === "/start")
        return bodyResponse(301, {
          headers: { location: "https://example.com/next" },
        }).response;
      if (url.pathname === "/next")
        return bodyResponse(302, {
          headers: { location: "https://example.com/final" },
        }).response;
      return bodyResponse(200).response;
    });
    const probe = await probeLink("https://example.com/start", fetcher);
    expect(probe).toMatchObject({
      url: "https://example.com/start",
      state: "ok",
      status: 200,
      redirects: 2,
    });
  });

  it("returns error for a 3xx missing a Location header", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => bodyResponse(301).response);
    const probe = await probeLink("https://example.com/redir", fetcher);
    expect(probe.state).toBe("error");
    expect(probe.error).toBeDefined();
    expect(probe.status).toBeUndefined();
  });

  it("returns error when the redirect cap is exceeded", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        bodyResponse(302, {
          headers: { location: "https://example.com/loop" },
        }).response,
    );
    const probe = await probeLink("https://example.com/loop", fetcher);
    expect(probe.state).toBe("error");
    expect(fetcher).toHaveBeenCalledTimes(LIMITS.maxRedirects + 1);
  });

  it("blocks private/localhost/non-http urls without calling fetch", async () => {
    for (const bad of [
      "http://127.0.0.1/admin",
      "http://localhost/x",
      "ftp://example.com/file",
      "javascript:alert(1)",
    ]) {
      const fetcher = vi.fn<typeof fetch>();
      const probe = await probeLink(bad, fetcher);
      expect(probe.state).toBe("error");
      expect(probe.url).toBe(bad);
      expect(fetcher).not.toHaveBeenCalled();
    }
  });

  it("records a network throw as error", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new Error("network down");
    });
    const probe = await probeLink("https://example.com/x", fetcher);
    expect(probe.state).toBe("error");
    expect(probe.error).toContain("network down");
  });

  it("reports a timeout/abort as error", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
        return await new Promise<Response>((_resolve, reject) => {
          const signal = (init as RequestInit | undefined)?.signal;
          signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      });
      const pending = probeLink("https://example.com/slow", fetcher);
      await vi.advanceTimersByTimeAsync(LIMITS.linkProbeTimeoutMs + 1);
      const probe = await pending;
      expect(probe.state).toBe("error");
      expect(probe.error).toBe("Link probe timed out");
    } finally {
      vi.useRealTimers();
    }
  });
});
