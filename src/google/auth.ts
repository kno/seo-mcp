import { LIMITS, type Env } from "../config";

let cache: { token: string; expiresAtMs: number } | null = null;

export function resetGoogleTokenCache(): void {
  cache = null;
}

export async function getGoogleAccessToken(
  env: Env,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<string> {
  if (
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET ||
    !env.GOOGLE_REFRESH_TOKEN
  ) {
    throw new Error("Google credentials are not configured");
  }

  if (cache && now() < cache.expiresAtMs) {
    return cache.token;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    LIMITS.googleTokenTimeoutMs,
  );
  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
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
    cache = {
      token: data.access_token as string,
      expiresAtMs: now() + (data.expires_in ?? 3600) * 1000 - 60_000,
    };
    return cache.token;
  } finally {
    clearTimeout(timeout);
  }
}
