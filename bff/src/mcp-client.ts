/**
 * Minimal MCP client — `health` only, for Phase 2 of `dashboard-bff-foundations`.
 *
 * Sends a single JSON-RPC `tools/call` request to `seo-mcp` over the
 * `SEO_MCP` service binding, injecting the shared bearer token only on
 * this fetch (never anywhere else). The token is transmitted purely
 * in-process through the binding, never over a public network hop.
 *
 * Deliberate Phase 2 simplification: this issues one self-contained
 * `tools/call` frame without a prior MCP `initialize` handshake. The real
 * MCP Streamable HTTP session negotiation, the remaining four tool routes,
 * and upstream 401/429/503 status mapping are Phase 3's "full
 * implementation" (`bff/src/mcp-client.ts` task 3.4); this client is
 * intentionally scoped to make the `health` route and the gate-ordering
 * property demonstrable now.
 */

import { healthSchema } from "../../src/schemas/health";
import type { HealthResult } from "../../src/types";

export interface McpClientDependencies {
  seoMcp: Fetcher;
  mcpOrigin: string;
  token: string;
}

export type McpClientResult<T> =
  { ok: true; data: T } | { ok: false; status: number; retryAfter?: number };

export async function callHealth(
  dependencies: McpClientDependencies,
): Promise<McpClientResult<HealthResult>> {
  const upstreamRequest = new Request(`${dependencies.mcpOrigin}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${dependencies.token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "tools/call",
      params: { name: "health", arguments: {} },
    }),
  });

  const response = await dependencies.seoMcp.fetch(upstreamRequest);
  if (!response.ok) {
    const retryAfterHeader = response.headers.get("retry-after");
    return {
      ok: false,
      status: response.status,
      retryAfter: retryAfterHeader ? Number(retryAfterHeader) : undefined,
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, status: 502 };
  }

  const structuredContent = (
    payload as { result?: { structuredContent?: unknown } }
  )?.result?.structuredContent;
  const parsed = healthSchema.safeParse(structuredContent);
  if (!parsed.success) return { ok: false, status: 502 };
  return { ok: true, data: parsed.data };
}
