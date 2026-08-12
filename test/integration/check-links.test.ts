import { describe, expect, it, vi } from "vitest";
import { checkLinks } from "../../src/crawl/links";
import { LIMITS } from "../../src/config";

function html(anchors: string): string {
  return `<!doctype html>
<html lang="en"><head><title>Check Links Fixture Page</title></head>
<body><h1>Links</h1>${anchors}</body></html>`;
}

describe("checkLinks (real HTMLRewriter)", () => {
  it("aggregates probe results in deterministic input order", async () => {
    const page = html(`
      <a href="https://example.com/ok">ok</a>
      <a href="https://example.com/gone">gone</a>
      <a href="https://other-host.example.org/broken">broken</a>
    `);
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input.toString());
      if (url.hostname === "example.com" && url.pathname === "/")
        return new Response(page, {
          headers: { "content-type": "text/html" },
        });
      if (url.pathname === "/ok") return new Response("x", { status: 200 });
      if (url.pathname === "/gone") return new Response("x", { status: 404 });
      if (url.pathname === "/broken") return new Response("x", { status: 503 });
      return new Response("x", { status: 200 });
    });

    const result = await checkLinks("https://example.com", fetcher);
    expect(result.url).toBe("https://example.com/");
    expect(result.pageStatus).toBe(200);
    expect(result.checked).toBe(3);
    expect(result.ok).toBe(1);
    expect(result.broken).toBe(2);
    expect(result.errors).toBe(0);
    expect(result.results.map((r) => r.url)).toEqual([
      "https://example.com/ok",
      "https://example.com/gone",
      "https://other-host.example.org/broken",
    ]);
    expect(result.results.map((r) => r.state)).toEqual([
      "ok",
      "broken",
      "broken",
    ]);
  });

  it("dedupes repeated links preserving first-seen order", async () => {
    const page = html(`
      <a href="https://example.com/a">a</a>
      <a href="https://example.com/b">b</a>
      <a href="https://example.com/a">a again</a>
    `);
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input.toString());
      if (url.hostname === "example.com" && url.pathname === "/")
        return new Response(page, {
          headers: { "content-type": "text/html" },
        });
      return new Response("x", { status: 200 });
    });

    const result = await checkLinks("https://example.com", fetcher);
    expect(result.checked).toBe(2);
    expect(result.results.map((r) => r.url)).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });

  it("caps probed links at maxLinkChecks", async () => {
    const original = LIMITS.maxLinkChecks;
    (LIMITS as { maxLinkChecks: number }).maxLinkChecks = 5;
    try {
      const anchors = Array.from(
        { length: 20 },
        (_, i) => `<a href="https://example.com/p${i}">p${i}</a>`,
      ).join("");
      const page = html(anchors);
      const fetcher = vi.fn<typeof fetch>(async (input) => {
        const url = new URL(input.toString());
        if (url.hostname === "example.com" && url.pathname === "/")
          return new Response(page, {
            headers: { "content-type": "text/html" },
          });
        return new Response("x", { status: 200 });
      });

      const result = await checkLinks("https://example.com", fetcher);
      expect(result.checked).toBe(5);
      expect(result.results.length).toBe(5);
      expect(result.results.map((r) => r.url)).toEqual([
        "https://example.com/p0",
        "https://example.com/p1",
        "https://example.com/p2",
        "https://example.com/p3",
        "https://example.com/p4",
      ]);
    } finally {
      (LIMITS as { maxLinkChecks: number }).maxLinkChecks = original;
    }
  });

  it("records a probe as error when the subrequest budget is exhausted", async () => {
    const original = LIMITS.linkCheckSubrequestBudget;
    // Only the page fetch fits; both probes must be recorded as errors.
    (
      LIMITS as { linkCheckSubrequestBudget: number }
    ).linkCheckSubrequestBudget = 1;
    try {
      const page = html(`
        <a href="https://example.com/one">one</a>
        <a href="https://example.com/two">two</a>
      `);
      const fetcher = vi.fn<typeof fetch>(async (input) => {
        const url = new URL(input.toString());
        if (url.hostname === "example.com" && url.pathname === "/")
          return new Response(page, {
            headers: { "content-type": "text/html" },
          });
        return new Response("x", { status: 200 });
      });

      const result = await checkLinks("https://example.com", fetcher);
      expect(result.checked).toBe(2);
      expect(result.errors).toBe(2);
      expect(result.results.every((r) => r.state === "error")).toBe(true);
    } finally {
      (
        LIMITS as { linkCheckSubrequestBudget: number }
      ).linkCheckSubrequestBudget = original;
    }
  });

  it("propagates a bad page url as a thrown error", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      checkLinks("http://127.0.0.1/private", fetcher),
    ).rejects.toThrow("not allowed");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
