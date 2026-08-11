import type { Env } from "../config";

export const MCP_RATE_LIMIT_KEY = "mcp:shared-v1";

export interface TimingSafeSubtleCrypto {
  digest(
    algorithm: AlgorithmIdentifier,
    data: BufferSource,
  ): Promise<ArrayBuffer>;
  timingSafeEqual?(
    left: ArrayBuffer | ArrayBufferView,
    right: ArrayBuffer | ArrayBufferView,
  ): boolean;
}

export interface AuthDependencies {
  subtle: TimingSafeSubtleCrypto | undefined;
}

export type TokenVerification = "valid" | "invalid" | "unavailable";

function bearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  return match?.[1];
}

function reject(
  request: Request,
  status: number,
  headers?: HeadersInit,
): Response {
  void request.body?.cancel();
  const message =
    status === 401
      ? "Unauthorized"
      : status === 429
        ? "Too many requests"
        : "Service unavailable";
  return Response.json({ error: message }, { status, headers });
}

export async function verifyTokens(
  provided: string,
  expected: string,
  subtle: TimingSafeSubtleCrypto | undefined,
): Promise<TokenVerification> {
  if (
    !subtle ||
    typeof subtle.digest !== "function" ||
    typeof subtle.timingSafeEqual !== "function"
  ) {
    return "unavailable";
  }

  try {
    const encoder = new TextEncoder();
    const [providedHash, expectedHash] = await Promise.all([
      subtle.digest("SHA-256", encoder.encode(provided)),
      subtle.digest("SHA-256", encoder.encode(expected)),
    ]);
    if (providedHash.byteLength !== expectedHash.byteLength) return "invalid";
    return subtle.timingSafeEqual(providedHash, expectedHash)
      ? "valid"
      : "invalid";
  } catch {
    return "unavailable";
  }
}

export async function protectMcpRequest(
  request: Request,
  env: Env,
  next: () => Promise<Response>,
  dependencies: AuthDependencies = { subtle: globalThis.crypto?.subtle },
): Promise<Response> {
  const subtle = dependencies.subtle;
  if (
    !env.MCP_AUTH_TOKEN ||
    typeof env.MCP_RATE_LIMITER?.limit !== "function" ||
    !subtle ||
    typeof subtle.digest !== "function" ||
    typeof subtle.timingSafeEqual !== "function"
  ) {
    return reject(request, 503);
  }

  const provided = bearerToken(request);
  if (!provided) {
    return reject(request, 401, {
      "www-authenticate": 'Bearer realm="seo-mcp"',
    });
  }

  const verification = await verifyTokens(provided, env.MCP_AUTH_TOKEN, subtle);
  if (verification === "unavailable") return reject(request, 503);
  if (verification === "invalid") {
    return reject(request, 401, {
      "www-authenticate": 'Bearer realm="seo-mcp"',
    });
  }

  try {
    const outcome = await env.MCP_RATE_LIMITER.limit({
      key: MCP_RATE_LIMIT_KEY,
    });
    if (!outcome.success) {
      return reject(request, 429, { "retry-after": "60" });
    }
  } catch {
    return reject(request, 503);
  }

  return next();
}
