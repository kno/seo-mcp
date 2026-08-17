/**
 * `GET /auth/google/callback?code&state` — the OAuth callback. Registered
 * in `router.ts` in the SAME pre-gate slot as `POST /auth/session`
 * (`handleRequest` checks it BEFORE the `/api/*` `authenticate()` branch),
 * because Google's cross-site 302 to this route is not guaranteed to carry
 * the dashboard session cookie. This route's authorization is the signed,
 * single-use, session-bound `state` token (`bff/src/oauth/state.ts`), never
 * the cookie — `handleOauthCallback` does not read one.
 *
 * Fixed `connect_error` enum values this route can redirect with (never the
 * upstream Google error text, which is discarded immediately after
 * classification):
 * - `state_invalid` — the `state` parameter is missing, malformed, forged,
 *   expired, replayed, or bound to a different session.
 * - `token_exchange_failed` — `connect_google_account` (forwarded to
 *   `seo-mcp`; not implemented until Phase 4b, so this also covers the
 *   404 that call currently produces) did not report success.
 *
 * `connect_google_account` is an MCP tool `seo-mcp` will build in Phase
 * 4b — this route only wires the forward-call shape now, per Phase 4a's
 * scope. The BFF cannot hold or write a credential row itself (it has no
 * D1 binding), so a failed exchange structurally cannot leave a partial
 * row here.
 */
import { callTool } from "../mcp-client";
import { verifyState, type OauthStateDependencies } from "./state";
import * as z from "zod/v4";

export type ConnectErrorCode = "state_invalid" | "token_exchange_failed";

const SESSION_SUB = "dashboard";

export type OauthCallbackDependencies = OauthStateDependencies;

function redirectWithError(origin: string, code: ConnectErrorCode): Response {
  const target = new URL(origin);
  target.hash = `/manage-domains?connect_error=${encodeURIComponent(code)}`;
  return Response.redirect(target.toString(), 302);
}

function redirectConnected(origin: string): Response {
  const target = new URL(origin);
  target.hash = "/manage-domains?connected=1";
  return Response.redirect(target.toString(), 302);
}

export async function handleOauthCallback(
  request: Request,
  env: Env,
  dependencies: OauthCallbackDependencies = {},
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateToken = url.searchParams.get("state");
  if (!code || !stateToken)
    return redirectWithError(url.origin, "state_invalid");
  if (!env.GOOGLE_OAUTH_STATE_KEY) {
    return redirectWithError(url.origin, "state_invalid");
  }

  const verification = await verifyState(
    stateToken,
    env.GOOGLE_OAUTH_STATE_KEY,
    SESSION_SUB,
    env.RESULT_CACHE,
    dependencies,
  );
  if (!verification.ok) return redirectWithError(url.origin, "state_invalid");

  const redirectUri = new URL("/auth/google/callback", url.origin).toString();

  const result = await callTool(
    "connect_google_account",
    { siteId: verification.payload.siteId, code, redirectUri },
    z.unknown(),
    {
      seoMcp: env.SEO_MCP,
      mcpOrigin: env.MCP_ORIGIN,
      token: env.MCP_AUTH_TOKEN,
      timeoutMs: 30_000,
      validateUpstreamResults: false,
    },
  );
  if (!result.ok) return redirectWithError(url.origin, "token_exchange_failed");

  return redirectConnected(url.origin);
}
