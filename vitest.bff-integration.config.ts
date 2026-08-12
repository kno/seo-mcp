import { defineWorkersProject } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersProject({
  test: {
    name: "bff-integration",
    include: ["bff/test/integration/**/*.test.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./bff/wrangler.jsonc" },
        miniflare: {
          // Secret-only bindings (see `bff/src/env.d.ts`) not declared in
          // `bff/wrangler.jsonc`. Test-only fixed values, never real secrets.
          bindings: {
            DASHBOARD_SECRET: "integration-test-secret",
            DASHBOARD_SESSION_KEY: "integration-test-session-key",
            MCP_AUTH_TOKEN: "integration-test-mcp-token",
          },
          // Stub upstream standing in for `seo-mcp`, bound to the same
          // service name the BFF's `services` binding targets, so the BFF
          // Worker's real `SEO_MCP` fetcher resolves to this stub instead
          // of a live deployment.
          workers: [
            {
              name: "seo-mcp",
              modules: true,
              scriptPath: "./bff/test/integration/stub-mcp-worker.js",
            },
          ],
        },
      },
    },
  },
});
