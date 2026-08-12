/**
 * Auxiliary stub MCP Worker for `bff/test/integration/gate-ordering.test.ts`.
 *
 * Bound as the `SEO_MCP` service-binding target (name `seo-mcp`, matching
 * `bff/wrangler.jsonc`'s `services[0].service`), replacing the real
 * `seo-mcp` Worker for this test project only. It exists to make the
 * gate-before-dispatch property observable from the test file: every
 * non-`/__calls` request increments a module-level counter, and `GET
 * /__calls` reads it back. Module-level state here is intentional and
 * acceptable — this is test-only fixture code standing in for a real
 * upstream, not production BFF logic, and the constraint against
 * module-level mutable request state applies to the BFF Worker itself.
 *
 * Plain JavaScript (not TypeScript): auxiliary `miniflare.workers` entries
 * are loaded directly by workerd, without the Vite/TypeScript transform
 * `wrangler: { configPath }` applies to the primary worker under test.
 *
 * The canned `tools/call` response below only needs to satisfy
 * `bff/src/mcp-client.ts`'s `callHealth` parsing for this Phase 2 slice;
 * the full JSON-RPC/MCP protocol surface is exercised for real against
 * `seo-mcp` starting in Phase 3.
 */

let calls = 0;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/__calls") {
      return Response.json({ calls });
    }

    calls++;
    return Response.json({
      jsonrpc: "2.0",
      id: "stub",
      result: {
        content: [{ type: "text", text: "ok" }],
        structuredContent: {
          status: "ok",
          service: "seo-mcp",
          version: "0.1.0",
        },
      },
    });
  },
};
