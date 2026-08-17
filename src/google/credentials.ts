/**
 * Site-tier credential resolution — the only module allowed to touch
 * `../db/site-store`/`../db/site-credential-store` on the credentials path.
 * Never import this file from anything reachable from `bff/ui` (see
 * `./credential-types`'s header comment); import `./credential-types`
 * directly instead when only the types or the global tier are needed.
 */
import type { Env } from "../config";
import { decryptCredential } from "../crypto/credential-cipher";
import { getSiteByUrl } from "../db/site-store";
import { getSiteCredential } from "../db/site-credential-store";
import {
  globalTier,
  CREDENTIALS_NOT_CONFIGURED,
  type ResolvedCredential,
} from "./credential-types";

export type {
  GoogleOAuthCredentials,
  ResolvedCredential,
} from "./credential-types";
export { globalCredentials } from "./credential-types";

async function siteTier(
  env: Env,
  siteUrl: string,
): Promise<ResolvedCredential | null> {
  if (
    !env.DB ||
    !env.DOMAIN_CREDENTIAL_ENCRYPTION_KEY ||
    !env.GOOGLE_CLIENT_SECRET
  ) {
    return null;
  }
  const site = await getSiteByUrl(env.DB, siteUrl);
  if (!site) return null;
  const record = await getSiteCredential(env.DB, site.id);
  if (!record) return null;

  try {
    const refreshToken = await decryptCredential(
      {
        ciphertext: record.refreshTokenCiphertext,
        iv: record.refreshTokenIv,
      },
      env.DOMAIN_CREDENTIAL_ENCRYPTION_KEY,
      `site:${site.id}:refresh_token`,
    );
    return {
      credentials: {
        clientId: record.clientId,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        refreshToken,
      },
      source: "site",
      accountKey: record.accountKey,
      accountLabel: record.googleAccountEmail,
    };
  } catch {
    // Decryption failure (tampered ciphertext, wrong AAD, rotated key)
    // means this site-tier attempt is unusable — fall through to global,
    // never complete the set with a global-tier field.
    return null;
  }
}

export async function resolveSiteCredentials(
  env: Env,
  siteUrl: string | undefined,
): Promise<ResolvedCredential> {
  if (siteUrl) {
    const site = await siteTier(env, siteUrl);
    if (site) return site;
  }
  const global = globalTier(env);
  if (global) return global;
  throw new Error(CREDENTIALS_NOT_CONFIGURED);
}
