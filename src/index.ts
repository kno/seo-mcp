import { createMcpHandler } from "@modelcontextprotocol/server";
import type { Env } from "./config";
import { protectMcpRequest } from "./http/auth";
import { boundMcpRequest } from "./http/inbound";
import { validateMcpRequest } from "./http/request-policy";
import { logRequestMetrics } from "./http/telemetry";
import { runScheduledSnapshots } from "./scheduled";
import { buildServer } from "./server";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const start = Date.now();
    let response: Response;
    if (url.pathname !== "/mcp") {
      response = new Response("Not found", { status: 404 });
    } else {
      const policyError = validateMcpRequest(request);
      if (policyError) {
        response = policyError;
      } else {
        response = await protectMcpRequest(request, env, async () => {
          const bounded = await boundMcpRequest(request);
          if (bounded.response) return bounded.response;
          return createMcpHandler(() => buildServer(env)).fetch(
            bounded.request,
          );
        });
      }
    }
    logRequestMetrics({
      path: url.pathname,
      status: response.status,
      durationMs: Date.now() - start,
    });
    return response;
  },

  async scheduled(
    _event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(
      runScheduledSnapshots(env).then((s) =>
        console.log(JSON.stringify({ kind: "scheduled_snapshots", ...s })),
      ),
    );
  },
};
