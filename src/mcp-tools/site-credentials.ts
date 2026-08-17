/**
 * `connect_google_account`, `disconnect_google_account`,
 * `check_site_credentials` — the three MCP tools `bff/src/oauth/callback.ts`
 * (Phase 4a) and `bff/src/router.ts` forward to. Per design's "the code
 * exchange happens in seo-mcp, not the BFF" decision, this module is the
 * ONLY place the app's `GOOGLE_CLIENT_SECRET` is paired with a raw
 * authorization code or a raw refresh token — nothing here ever returns
 * either, or the encrypted ciphertext, in a tool result.
 *
 * `connect_google_account`'s input is `{siteId, code, redirectUri}`, not
 * design.md's mermaid-diagram literal `{siteUrl, code, redirectUri}` — a
 * documented drift from Phase 4a's actual implementation
 * (`bff/src/oauth/callback.ts` forwards `verification.payload.siteId`,
 * since the `state` token itself is minted with `siteId`, not `siteUrl` —
 * see `bff/src/oauth/authorize.ts`/`state.ts`). Flagged for `sdd-verify`,
 * not silently reconciled.
 */
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { LIMITS } from "../config";
import type { Env } from "../config";
import { getSiteById } from "../db/site-store";
import { encryptCredential } from "../crypto/credential-cipher";
import {
  upsertSiteCredential,
  deleteSiteCredential,
  deleteSiteCredentialHealth,
} from "../db/site-credential-store";
import { resolveSiteCredentials } from "../google/credentials";
import type { ResolvedCredential } from "../google/credential-types";
import {
  runConnectHealthCheck,
  checkSearchConsoleHealth,
  checkGoogleAdsHealth,
  credentialStatusForSite,
  type PresentedHealth,
} from "../google/health";
import type { SiteCredentialHealthRecord } from "../db/site-credential-store";
import {
  connectGoogleAccountResultSchema,
  disconnectGoogleAccountResultSchema,
  checkSiteCredentialsResultSchema,
} from "../schemas/sites";
import { jsonResult, errorResult, assertConfirmedDelete } from "./shared";

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * `accountKey = base64url(sha256(client_id + "\0" + lower(email)))[0..22]`
 * — design's own derivation table, a DIFFERENT key space from `auth.ts`'s
 * `credentialKey` (which hashes `client_id + refresh_token`). Deriving one
 * from the other is forbidden; this function never touches a refresh token.
 */
async function deriveAccountKey(
  clientId: string,
  email: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(`${clientId}\0${email.toLowerCase()}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return base64UrlEncode(new Uint8Array(digest)).slice(0, 22);
}

interface GoogleTokenResponse {
  refresh_token?: string;
  access_token?: string;
  id_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

/**
 * Decoded client-side rather than an extra `GET /oauth2/v3/userinfo` call:
 * the `openid email` scope guarantees Google's `/token` response carries an
 * `id_token` JWT with an `email` claim, so decoding it is one fewer network
 * round-trip than calling the userinfo endpoint for the same fact. The JWT
 * signature is not verified — its origin is trusted structurally, since it
 * arrived over TLS directly from Google's own token endpoint in the same
 * response as the refresh token, not from anything the browser or a
 * third party supplied.
 */
function decodeIdTokenEmail(idToken: string): string | null {
  const parts = idToken.split(".");
  if (parts.length < 2) return null;
  try {
    const payloadJson = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(payloadJson) as { email?: string };
    return payload.email ?? null;
  } catch {
    return null;
  }
}

async function exchangeCodeForTokens(
  env: Env,
  code: string,
  redirectUri: string,
): Promise<GoogleTokenResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    LIMITS.googleTokenTimeoutMs,
  );
  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: env.GOOGLE_CLIENT_ID ?? "",
      client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
    });
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });
    const data = (await response.json()) as GoogleTokenResponse;
    if (!response.ok || !data.refresh_token) {
      throw new Error(
        data.error_description ?? data.error ?? "Google token exchange failed",
      );
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function toPresentedHealth(
  record: SiteCredentialHealthRecord,
): PresentedHealth {
  return {
    state: record.state,
    reason: record.reason,
    checkedAt: record.checkedAt,
  };
}

export function registerSiteCredentialsTools(
  server: McpServer,
  env: Env,
): void {
  server.registerTool(
    "connect_google_account",
    {
      description:
        "Exchange an OAuth authorization code for a refresh token, encrypt and persist it for the given site, and run the mandatory post-connect health probe. Forwarded internally by the dashboard-bff OAuth callback; never reachable via the generic /api/tools dispatch path.",
      inputSchema: z.object({
        siteId: z.number().int().positive(),
        code: z.string().min(1),
        redirectUri: z.string().min(1),
      }),
      outputSchema: connectGoogleAccountResultSchema,
    },
    async ({ siteId, code, redirectUri }) => {
      if (!env.DB)
        return errorResult(new Error("D1 storage is not configured"));
      if (
        !env.DOMAIN_CREDENTIAL_ENCRYPTION_KEY ||
        !env.GOOGLE_CLIENT_ID ||
        !env.GOOGLE_CLIENT_SECRET
      ) {
        return errorResult(new Error("Google credentials are not configured"));
      }
      try {
        const site = await getSiteById(env.DB, siteId);
        if (!site) return errorResult(new Error("Site not found"));

        const tokens = await exchangeCodeForTokens(env, code, redirectUri);
        const refreshToken = tokens.refresh_token as string;
        const email = tokens.id_token
          ? decodeIdTokenEmail(tokens.id_token)
          : null;
        if (!email) {
          return errorResult(
            new Error("Google did not return an account email"),
          );
        }

        const accountKey = await deriveAccountKey(env.GOOGLE_CLIENT_ID, email);
        const encrypted = await encryptCredential(
          refreshToken,
          env.DOMAIN_CREDENTIAL_ENCRYPTION_KEY,
          `site:${site.id}:refresh_token`,
        );
        await upsertSiteCredential(env.DB, {
          siteId: site.id,
          clientId: env.GOOGLE_CLIENT_ID,
          refreshTokenCiphertext: encrypted.ciphertext,
          refreshTokenIv: encrypted.iv,
          googleAccountEmail: email,
          accountKey,
          scopes: tokens.scope ?? "",
          connectedAt: new Date().toISOString(),
        });

        const resolved: ResolvedCredential = {
          credentials: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            refreshToken,
          },
          source: "site",
          accountKey,
          accountLabel: email,
        };
        const healthResult = await runConnectHealthCheck(
          env.DB,
          { id: site.id, url: site.url },
          resolved,
          env.GOOGLE_ADS_DEVELOPER_TOKEN,
        );

        return jsonResult(connectGoogleAccountResultSchema, {
          siteUrl: site.url,
          connected: true,
          accountLabel: email,
          health: {
            searchConsole: toPresentedHealth(healthResult.searchConsole),
            googleAds: healthResult.googleAds
              ? toPresentedHealth(healthResult.googleAds)
              : null,
          },
        });
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "disconnect_google_account",
    {
      description:
        "Delete a site's connected Google account credential row, re-resolving it to the global fallback tier. Requires confirm=true.",
      inputSchema: z.object({
        siteId: z.number().int().positive(),
        confirm: z.boolean(),
      }),
      outputSchema: disconnectGoogleAccountResultSchema,
    },
    async ({ siteId, confirm }) => {
      if (!env.DB)
        return errorResult(new Error("D1 storage is not configured"));
      try {
        assertConfirmedDelete(confirm);
        const disconnected = await deleteSiteCredential(env.DB, siteId);
        // Explicit cleanup, not strictly required for correctness — a
        // stale health row is already treated as `unchecked` by
        // `derivePresentedHealth`'s `accountKey` mismatch check once the
        // site re-resolves to the global tier's `accountKey: "global"`.
        // Deleted anyway so no unreachable row is left behind once the
        // credential identity it was scoped to no longer exists, mirroring
        // `deleteSite`'s own batch-delete precedent for the same tables.
        if (disconnected) await deleteSiteCredentialHealth(env.DB, siteId);
        return jsonResult(disconnectGoogleAccountResultSchema, {
          siteId,
          disconnected,
        });
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "check_site_credentials",
    {
      description:
        "Return a site's current credential tier and per-source health. Reads only cached state unless forceRecheck is true, which bypasses the freshness window and runs a fresh probe.",
      inputSchema: z.object({
        siteId: z.number().int().positive(),
        forceRecheck: z.boolean().optional(),
      }),
      outputSchema: checkSiteCredentialsResultSchema,
    },
    async ({ siteId, forceRecheck }) => {
      if (!env.DB)
        return errorResult(new Error("D1 storage is not configured"));
      try {
        const site = await getSiteById(env.DB, siteId);
        if (!site) return errorResult(new Error("Site not found"));

        if (forceRecheck) {
          const resolved = await resolveSiteCredentials(env, site.url);
          await checkSearchConsoleHealth(env.DB, site, resolved, {
            forceRecheck: true,
          });
          if (env.GOOGLE_ADS_DEVELOPER_TOKEN) {
            await checkGoogleAdsHealth(
              env.DB,
              site,
              resolved,
              env.GOOGLE_ADS_DEVELOPER_TOKEN,
              { forceRecheck: true },
            );
          }
        }

        const status = await credentialStatusForSite(env, site);
        return jsonResult(checkSiteCredentialsResultSchema, {
          siteId,
          ...status,
        });
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
