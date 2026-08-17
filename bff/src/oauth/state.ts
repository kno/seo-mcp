/**
 * Signed, single-use `state` token for the Google OAuth authorize/callback
 * round-trip (`google-account-connect-flow`).
 *
 * `HMAC-SHA-256` over `v1:oauth-state|{siteId}|{sub}|{nonce}|{exp}`, keyed
 * by `GOOGLE_OAUTH_STATE_KEY` — a secret deliberately separate from
 * `DASHBOARD_SESSION_KEY`, so a compromised session-signing key cannot also
 * forge OAuth state and vice versa. Mirrors `bff/src/session.ts`'s
 * `subtle.importKey` HMAC shape.
 *
 * Single-use is enforced by a KV entry (`oauth-state:{nonce}`, TTL 600s)
 * that `verifyState` deletes on its first successful read; a second
 * presentation of the same token finds no KV entry and is rejected as a
 * replay, even though its signature and expiry both still check out.
 */

export interface OauthStatePayload {
  siteId: number;
  sub: string;
}

export interface OauthStateDependencies {
  subtle?: Pick<SubtleCrypto, "importKey" | "sign">;
  now?: () => number;
}

export type StateVerificationOutcome =
  | { ok: true; payload: OauthStatePayload }
  | {
      ok: false;
      reason:
        | "forged"
        | "expired"
        | "replayed"
        | "sub_mismatch"
        | "malformed"
        | "unavailable";
    };

const STATE_TTL_SECONDS = 600;
const NONCE_BYTES = 16;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const withPadding = padded.padEnd(
    padded.length + ((4 - (padded.length % 4)) % 4),
    "=",
  );
  const binary = atob(withPadding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmacKey(
  subtle: Pick<SubtleCrypto, "importKey" | "sign">,
  key: string,
): Promise<CryptoKey> {
  return subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function randomNonce(): string {
  const bytes = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function kvKeyForNonce(nonce: string): string {
  return `oauth-state:${nonce}`;
}

/**
 * Mints a signed state token and writes its single-use KV marker. Returns
 * `undefined` when WebCrypto is unavailable, so callers can fail closed
 * with `gate_unavailable` instead of throwing.
 */
export async function mintState(
  payload: OauthStatePayload,
  key: string,
  kv: KVNamespace,
  dependencies: OauthStateDependencies = {},
): Promise<string | undefined> {
  const subtle = dependencies.subtle ?? globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.importKey !== "function") return undefined;
  const now = dependencies.now ?? Date.now;
  const exp = Math.floor(now() / 1000) + STATE_TTL_SECONDS;
  const nonce = randomNonce();
  const message = `v1:oauth-state|${payload.siteId}|${payload.sub}|${nonce}|${exp}`;
  const messageBytes = new TextEncoder().encode(message);
  const hmacCryptoKey = await hmacKey(subtle, key);
  const signature = await subtle.sign("HMAC", hmacCryptoKey, messageBytes);

  await kv.put(
    kvKeyForNonce(nonce),
    JSON.stringify({ siteId: payload.siteId, sub: payload.sub }),
    { expirationTtl: STATE_TTL_SECONDS },
  );

  return `${base64UrlEncode(messageBytes)}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * Verifies a state token's signature, expiry, and session binding, then
 * consumes its single-use KV marker (`GET`+`DELETE`). Order: signature,
 * then structural shape, then expiry, then session binding, then the
 * single-use KV check — a session-mismatched state is rejected without
 * ever consuming its nonce.
 */
export async function verifyState(
  token: string,
  key: string,
  expectedSub: string,
  kv: KVNamespace,
  dependencies: OauthStateDependencies = {},
): Promise<StateVerificationOutcome> {
  const subtle = dependencies.subtle ?? globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.importKey !== "function") {
    return { ok: false, reason: "unavailable" };
  }

  const [encodedMessage, encodedSignature] = token.split(".");
  if (!encodedMessage || !encodedSignature) {
    return { ok: false, reason: "malformed" };
  }

  let messageBytes: Uint8Array<ArrayBuffer>;
  let presentedSignature: Uint8Array<ArrayBuffer>;
  try {
    messageBytes = base64UrlDecode(encodedMessage);
    presentedSignature = base64UrlDecode(encodedSignature);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const hmacCryptoKey = await hmacKey(subtle, key);
  const expectedSignature = new Uint8Array(
    await subtle.sign("HMAC", hmacCryptoKey, messageBytes),
  );
  if (!timingSafeEqualBytes(presentedSignature, expectedSignature)) {
    return { ok: false, reason: "forged" };
  }

  const message = new TextDecoder().decode(messageBytes);
  const parts = message.split("|");
  if (parts.length !== 5 || parts[0] !== "v1:oauth-state") {
    return { ok: false, reason: "malformed" };
  }
  const [, siteIdRaw, sub, nonce, expRaw] = parts;
  const siteId = Number(siteIdRaw);
  const exp = Number(expRaw);
  if (!Number.isInteger(siteId) || !sub || !nonce || !Number.isFinite(exp)) {
    return { ok: false, reason: "malformed" };
  }

  const now = dependencies.now ?? Date.now;
  if (exp * 1000 < now()) return { ok: false, reason: "expired" };

  if (sub !== expectedSub) return { ok: false, reason: "sub_mismatch" };

  const marker = await kv.get(kvKeyForNonce(nonce));
  if (!marker) return { ok: false, reason: "replayed" };
  await kv.delete(kvKeyForNonce(nonce));

  return { ok: true, payload: { siteId, sub } };
}
