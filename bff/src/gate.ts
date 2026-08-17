/**
 * Dashboard access gate. Authenticates every incoming BFF request before
 * any call to `seo-mcp` is made, independent of the server's future OAuth
 * work (`dashboard-access-gate` spec).
 *
 * The gate mechanism is deliberately behind a `GateStrategy` seam so a
 * future strategy (e.g. `bearer-allowlist`, `local-only`) is a new
 * implementation, not a rewrite. `shared-secret-cookie` — the design's
 * default — verifies a presented shared secret against `DASHBOARD_SECRET`
 * via the existing `verifyTokens` timing-safe comparison
 * (`src/http/auth.ts`), then issues an HMAC-signed session cookie that
 * never carries the raw secret.
 */

import { verifyTokens, type TimingSafeSubtleCrypto } from "../../src/http/auth";
import { bffErrorResponse } from "./errors";
import {
  createSessionCookie,
  verifySessionCookie,
  type SessionDependencies,
} from "./session";

export type GateOutcome = "allowed" | "denied" | "unavailable";

export interface GateDependencies extends SessionDependencies {
  subtle?: Pick<SubtleCrypto, "importKey" | "sign" | "digest">;
}

export interface GateStrategy {
  authenticate(
    request: Request,
    env: Env,
    dependencies?: GateDependencies,
  ): Promise<GateOutcome>;
}

export const SESSION_COOKIE_NAME = "dashboard_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12h

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * `SubtleCrypto.timingSafeEqual` is a Cloudflare Workers runtime extension,
 * not present on the standard WebCrypto API (e.g. Node's, used by the unit
 * test environment). When absent, fall back to a manual constant-time
 * (no early-exit) byte comparison so the credential check in
 * `createSession` stays timing-safe on every runtime this module executes
 * in, not only in production.
 */
function toTimingSafeSubtle(
  subtle: Pick<SubtleCrypto, "digest"> & {
    timingSafeEqual?: TimingSafeSubtleCrypto["timingSafeEqual"];
  },
): TimingSafeSubtleCrypto {
  if (typeof subtle.timingSafeEqual === "function") {
    return subtle as TimingSafeSubtleCrypto;
  }
  return {
    digest: (algorithm, data) => subtle.digest(algorithm, data),
    timingSafeEqual: (left, right) => {
      const a = new Uint8Array(
        left instanceof ArrayBuffer ? left : left.buffer,
      );
      const b = new Uint8Array(
        right instanceof ArrayBuffer ? right : right.buffer,
      );
      return timingSafeEqualBytes(a, b);
    },
  };
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = part.slice(0, separatorIndex).trim();
    if (key === name) return part.slice(separatorIndex + 1).trim();
  }
  return undefined;
}

export const sharedSecretCookieStrategy: GateStrategy = {
  async authenticate(request, env, dependencies = {}) {
    if (!env.DASHBOARD_SESSION_KEY) return "unavailable";
    const cookieValue = readCookie(request, SESSION_COOKIE_NAME);
    if (!cookieValue) return "denied";
    const session = await verifySessionCookie(
      cookieValue,
      env.DASHBOARD_SESSION_KEY,
      dependencies,
    );
    return session ? "allowed" : "denied";
  },
};

const STRATEGIES: Record<string, GateStrategy> = {
  "shared-secret-cookie": sharedSecretCookieStrategy,
};

export function selectGateStrategy(env: Env): GateStrategy {
  return STRATEGIES[env.GATE_STRATEGY] ?? sharedSecretCookieStrategy;
}

/**
 * Authenticates a request against the configured `GateStrategy`. This is
 * the single entry point the router MUST call before any dispatch to the
 * MCP client, for every route including unknown ones.
 */
export async function authenticate(
  request: Request,
  env: Env,
  dependencies?: GateDependencies,
): Promise<GateOutcome> {
  return selectGateStrategy(env).authenticate(request, env, dependencies);
}

interface SessionCredential {
  secret: string;
}

function parseSessionCredential(value: unknown): SessionCredential | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const secret = (value as { secret?: unknown }).secret;
  return typeof secret === "string" && secret.length > 0
    ? { secret }
    : undefined;
}

/**
 * `POST /auth/session` — verifies the presented `DASHBOARD_SECRET` and, on
 * success, issues the signed session cookie. This route is the login
 * endpoint itself, so it is intentionally NOT gated by `authenticate()`.
 */
export async function createSession(
  request: Request,
  env: Env,
  dependencies: GateDependencies = {},
): Promise<Response> {
  const subtle = dependencies.subtle ?? globalThis.crypto?.subtle;
  if (!env.DASHBOARD_SECRET || !env.DASHBOARD_SESSION_KEY || !subtle) {
    return bffErrorResponse("gate_unavailable");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bffErrorResponse("invalid_input");
  }

  const credential = parseSessionCredential(body);
  if (!credential) return bffErrorResponse("invalid_input");

  const verification = await verifyTokens(
    credential.secret,
    env.DASHBOARD_SECRET,
    toTimingSafeSubtle(subtle),
  );
  if (verification === "unavailable")
    return bffErrorResponse("gate_unavailable");
  if (verification === "invalid") return bffErrorResponse("gate_unauthorized");

  const cookie = await createSessionCookie(
    "dashboard",
    SESSION_TTL_SECONDS,
    env.DASHBOARD_SESSION_KEY,
    dependencies,
  );
  if (!cookie) return bffErrorResponse("gate_unavailable");

  return new Response(null, {
    status: 204,
    headers: {
      "set-cookie": `${SESSION_COOKIE_NAME}=${cookie}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`,
    },
  });
}
