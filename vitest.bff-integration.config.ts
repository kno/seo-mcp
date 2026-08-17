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
            GOOGLE_OAUTH_STATE_KEY: "integration-test-oauth-state-key",
            GOOGLE_CLIENT_ID:
              "integration-test-client-id.apps.googleusercontent.com",
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
              // `google-account-connect-flow`/Phase 4b's headline
              // containment test (`oauth-round-trip.test.ts`): a decoy
              // secret owned by THIS auxiliary worker, never the primary
              // BFF worker under test — proving the value crosses the
              // service binding (as a real refresh token would) and is
              // never observable anywhere on the BFF's own response
              // surface.
              bindings: {
                DECOY_REFRESH_TOKEN:
                  "decoy-refresh-token-should-never-leak-987",
              },
            },
          ],
        },
      },
    },
  },
});
