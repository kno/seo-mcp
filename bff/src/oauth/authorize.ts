/**
 * `GET /auth/google/authorize?siteId={int}` — behind `authenticate()`
 * (wired in `router.ts`). Mints a signed `state` token bound to the
 * current dashboard session and the target site, then redirects to
 * Google's consent screen.
 *
 * The session's `sub` is re-read here (via `verifySessionCookie`) rather
 * than trusted from the router's `authenticate()` outcome, because that
 * outcome is only `"allowed" | "denied" | "unavailable"` — this handler
 * needs the actual `sub` value to bind it into the minted `state`. An
 * unauthenticated call to this function directly (as `bff/test/oauth/
 * authorize.test.ts` does) is rejected here too, before any KV write or
 * redirect, independent of the router's own gate.
 */
import { bffErrorResponse } from "../errors";
import { readCookie, SESSION_COOKIE_NAME } from "../gate";
import { verifySessionCookie, type SessionDependencies } from "../session";
import { mintState, type OauthStateDependencies } from "./state";
import { callTool } from "../mcp-client";
import { listSitesResultSchema } from "../../../src/schemas/sites";
import { TOOL_TIMEOUT_MS } from "../timeout";

const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/adwords",
].join(" ");

export type OauthAuthorizeDependencies = SessionDependencies &
  OauthStateDependencies;

export async function handleOauthAuthorize(
  request: Request,
  env: Env,
  dependencies: OauthAuthorizeDependencies = {},
): Promise<Response> {
  const url = new URL(request.url);
  const siteIdRaw = url.searchParams.get("siteId");
  const siteId = siteIdRaw === null ? NaN : Number(siteIdRaw);
  if (!Number.isInteger(siteId)) return bffErrorResponse("invalid_input");

  const cookieValue = readCookie(request, SESSION_COOKIE_NAME);
  const session = cookieValue
    ? await verifySessionCookie(
        cookieValue,
        env.DASHBOARD_SESSION_KEY,
        dependencies,
      )
    : undefined;
  if (!session) return bffErrorResponse("gate_unauthorized");

  const sitesResult = await callTool("list_sites", {}, listSitesResultSchema, {
    seoMcp: env.SEO_MCP,
    mcpOrigin: env.MCP_ORIGIN,
    token: env.MCP_AUTH_TOKEN,
    timeoutMs: TOOL_TIMEOUT_MS.list_sites,
  });
  if (!sitesResult.ok) return bffErrorResponse("invalid_input");
  const knownSite = sitesResult.data.sites.some((site) => site.id === siteId);
  if (!knownSite) return bffErrorResponse("invalid_input");

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_OAUTH_STATE_KEY) {
    return bffErrorResponse("gate_unavailable");
  }

  const state = await mintState(
    { siteId, sub: session.sub },
    env.GOOGLE_OAUTH_STATE_KEY,
    env.RESULT_CACHE,
    dependencies,
  );
  if (!state) return bffErrorResponse("gate_unavailable");

  const redirectUri = new URL("/auth/google/callback", url.origin).toString();
  const authorizeUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizeUrl.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", GOOGLE_OAUTH_SCOPES);
  authorizeUrl.searchParams.set("access_type", "offline");
  authorizeUrl.searchParams.set("prompt", "consent");
  authorizeUrl.searchParams.set("state", state);

  return Response.redirect(authorizeUrl.toString(), 302);
}
