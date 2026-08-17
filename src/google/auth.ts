import { LIMITS } from "../config";
import type { GoogleOAuthCredentials } from "./credential-types";

/**
 * Keyed by `credentialKey` (never exported, never leaves this module) so
 * that two distinct credential sets can never share a cached access token
 * — the cross-account token-cache leak this design closes. Bounded at
 * `MAX_CACHED_TOKENS`, evicting expired entries first, then the oldest
 * (insertion-order via `Map`).
 */
const MAX_CACHED_TOKENS = 8;

interface CacheEntry {
  token: string;
  expiresAtMs: number;
}

let cache = new Map<string, CacheEntry>();

export function resetGoogleTokenCache(): void {
  cache = new Map();
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function credentialKey(
  credentials: GoogleOAuthCredentials,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    `${credentials.clientId}\0${credentials.refreshToken}`,
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return base64UrlEncode(new Uint8Array(digest)).slice(0, 22);
}

function evictIfNeeded(nowMs: number): void {
  if (cache.size < MAX_CACHED_TOKENS) return;
  for (const [key, entry] of cache) {
    if (entry.expiresAtMs <= nowMs) cache.delete(key);
    if (cache.size < MAX_CACHED_TOKENS) return;
  }
  while (cache.size >= MAX_CACHED_TOKENS) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

export async function getGoogleAccessToken(
  credentials: GoogleOAuthCredentials,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<string> {
  if (
    !credentials.clientId ||
    !credentials.clientSecret ||
    !credentials.refreshToken
  ) {
    throw new Error("Google credentials are not configured");
  }

  const key = await credentialKey(credentials);
  const cached = cache.get(key);
  if (cached && now() < cached.expiresAtMs) {
    return cached.token;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    LIMITS.googleTokenTimeoutMs,
  );
  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
    });
    const response = await fetcher("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });
    const data = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!response.ok) {
      throw new Error(
        data.error_description ?? data.error ?? "Google token refresh failed",
      );
    }
    const nowMs = now();
    evictIfNeeded(nowMs);
    const entry: CacheEntry = {
      token: data.access_token as string,
      expiresAtMs: nowMs + (data.expires_in ?? 3600) * 1000 - 60_000,
    };
    cache.set(key, entry);
    return entry.token;
  } finally {
    clearTimeout(timeout);
  }
}
