/**
 * Credential types plus the global-tier resolver, deliberately isolated
 * from any D1-touching code (`../db/site-store`, `../db/site-credential-store`).
 * `src/types/index.ts` re-exports result types from `search-console.ts`,
 * `ads.ts`, `opportunities.ts`, `intelligence.ts`, and `keyword-pages.ts`
 * for `bff/ui`'s DOM-only tsconfig (no `@cloudflare/workers-types`) — any of
 * those files statically importing D1-typed code would pull `D1Database`
 * generics into a program that has no types for them. `resolveSiteCredentials`
 * (the site-tier resolver, which does need D1) lives in `./credentials`
 * instead, imported only by code that is never reachable from `bff/ui`.
 */
import type { Env } from "../config";

export interface GoogleOAuthCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

export interface ResolvedCredential {
  readonly credentials: GoogleOAuthCredentials;
  readonly source: "site" | "global";
  readonly accountKey: string; // "global" for the env tier
  readonly accountLabel: string | null; // connected Google email; null for global
}

export const CREDENTIALS_NOT_CONFIGURED =
  "Google credentials are not configured";

export function globalTier(env: Env): ResolvedCredential | null {
  if (
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET ||
    !env.GOOGLE_REFRESH_TOKEN
  ) {
    return null;
  }
  return {
    credentials: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      refreshToken: env.GOOGLE_REFRESH_TOKEN,
    },
    source: "global",
    accountKey: "global",
    accountLabel: null,
  };
}

/** Business Profile and Ads are explicitly out of scope for per-site credentials. */
export function globalCredentials(env: Env): GoogleOAuthCredentials {
  const global = globalTier(env);
  if (!global) throw new Error(CREDENTIALS_NOT_CONFIGURED);
  return global.credentials;
}
