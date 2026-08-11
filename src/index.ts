import { createMcpHandler } from "@modelcontextprotocol/server";
import type { Env } from "./config";
import { protectMcpRequest } from "./http/auth";
import { boundMcpRequest } from "./http/inbound";
import { validateMcpRequest } from "./http/request-policy";
import { buildServer } from "./server";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/mcp")
      return new Response("Not found", { status: 404 });
    const policyError = validateMcpRequest(request);
    if (policyError) return policyError;
    return protectMcpRequest(request, env, async () => {
      const bounded = await boundMcpRequest(request);
      if (bounded.response) return bounded.response;
      return createMcpHandler(() => buildServer(env)).fetch(bounded.request);
    });
  },
};
