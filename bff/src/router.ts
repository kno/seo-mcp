/**
 * BFF request router. The single most important property this module
 * upholds: `authenticate()` runs BEFORE any dispatch to the MCP client, for
 * every route — including unknown routes, which return 404 without ever
 * reaching `SEO_MCP`. `POST /auth/session` is the sole exception: it is
 * the login endpoint itself, so it cannot require a prior session.
 *
 * Phase 2 wires only the `health` route; the remaining four tool routes
 * land in Phase 3 (`bff/src/router.ts` tasks 3.1-3.2).
 */

import { authenticate, createSession } from "./gate";
import { bffErrorResponse } from "./errors";
import { callHealth } from "./mcp-client";

export async function handleRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/auth/session") {
    return createSession(request, env);
  }

  const outcome = await authenticate(request, env);
  if (outcome === "unavailable") return bffErrorResponse("gate_unavailable");
  if (outcome === "denied") return bffErrorResponse("gate_unauthorized");

  if (request.method === "GET" && url.pathname === "/api/tools/health") {
    const result = await callHealth({
      seoMcp: env.SEO_MCP,
      mcpOrigin: env.MCP_ORIGIN,
      token: env.MCP_AUTH_TOKEN,
    });
    if (!result.ok) {
      return bffErrorResponse("upstream_unavailable", result.retryAfter);
    }
    return Response.json({
      data: result.data,
      cacheStatus: "bypass",
      resultAge: 0,
    });
  }

  return new Response("Not found", { status: 404 });
}
