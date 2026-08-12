/**
 * Signed session cookie for the `shared-secret-cookie` gate strategy.
 *
 * The cookie carries `HMAC-SHA-256(sub|exp, DASHBOARD_SESSION_KEY)`, never
 * the raw `DASHBOARD_SECRET`. Signature verification uses a manual
 * constant-time byte comparison rather than the Cloudflare-only
 * `SubtleCrypto.timingSafeEqual` extension used in `src/http/auth.ts`,
 * because that extension is not guaranteed to be present in every runtime
 * this module may execute in (e.g. the Node-based unit test environment);
 * a portable constant-time compare keeps the same security property
 * (no early-exit on mismatch) without depending on it.
 */

export interface SessionPayload {
  sub: string;
  exp: number;
}

export interface SessionDependencies {
  subtle?: Pick<SubtleCrypto, "importKey" | "sign">;
  now?: () => number;
}

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

/**
 * Issues a signed session cookie value, or `undefined` when signing is
 * unavailable (missing WebCrypto support) so callers can fail closed with
 * `gate_unavailable` instead of a thrown exception.
 */
export async function createSessionCookie(
  sub: string,
  ttlSeconds: number,
  sessionKey: string,
  dependencies: SessionDependencies = {},
): Promise<string | undefined> {
  const subtle = dependencies.subtle ?? globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.importKey !== "function") return undefined;
  const now = dependencies.now ?? Date.now;
  const exp = Math.floor(now() / 1000) + ttlSeconds;
  const payload = `${sub}|${exp}`;
  const payloadBytes = new TextEncoder().encode(payload);
  const key = await hmacKey(subtle, sessionKey);
  const signature = await subtle.sign("HMAC", key, payloadBytes);
  return `${base64UrlEncode(payloadBytes)}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * Verifies a session cookie value, returning the decoded payload only when
 * the signature is valid and the session has not expired.
 */
export async function verifySessionCookie(
  cookieValue: string,
  sessionKey: string,
  dependencies: SessionDependencies = {},
): Promise<SessionPayload | undefined> {
  const subtle = dependencies.subtle ?? globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.importKey !== "function") return undefined;

  const [encodedPayload, encodedSignature] = cookieValue.split(".");
  if (!encodedPayload || !encodedSignature) return undefined;

  let payloadBytes: Uint8Array<ArrayBuffer>;
  let presentedSignature: Uint8Array<ArrayBuffer>;
  try {
    payloadBytes = base64UrlDecode(encodedPayload);
    presentedSignature = base64UrlDecode(encodedSignature);
  } catch {
    return undefined;
  }

  const key = await hmacKey(subtle, sessionKey);
  const expectedSignature = new Uint8Array(
    await subtle.sign("HMAC", key, payloadBytes),
  );
  if (!timingSafeEqualBytes(presentedSignature, expectedSignature)) {
    return undefined;
  }

  const payload = new TextDecoder().decode(payloadBytes);
  const separatorIndex = payload.lastIndexOf("|");
  if (separatorIndex === -1) return undefined;
  const sub = payload.slice(0, separatorIndex);
  const exp = Number(payload.slice(separatorIndex + 1));
  if (!sub || !Number.isFinite(exp)) return undefined;

  const now = dependencies.now ?? Date.now;
  if (exp * 1000 < now()) return undefined;

  return { sub, exp };
}
