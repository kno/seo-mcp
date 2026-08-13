/**
 * Exhaustive presentation mapping for `BffErrorCode` (`bff/src/errors.ts`).
 *
 * `ERROR_PRESENTATION` is typed `Record<BffErrorCode, ErrorPresentation>` —
 * a mapped type over the SAME union the BFF ships, imported directly rather
 * than re-declared. Adding a new code to that union breaks `tsc` here until
 * this table is updated (verified in apply-progress by temporarily removing
 * an entry and re-running `pnpm typecheck`). `presentFor()` is the runtime
 * companion: it degrades any `code` absent from the table (including a
 * value the current union does not even contain, which can only reach this
 * function through a decoded network response) to an explicit "unmapped"
 * state instead of silently rendering empty or success — the compile-time
 * table and the runtime fallback together satisfy the `dashboard-shell`
 * "every code has a defined presentation" requirement without a paragraph
 * of review-convention text carrying any of the weight.
 */

import type { BffError, BffErrorCode } from "../../../src/errors";

export type ErrorPlacement =
  "full-view-interstitial" | "panel" | "inline-form" | "inline-field";

export type RetryAffordance =
  | { readonly kind: "reauthenticate" }
  | { readonly kind: "manual" }
  | { readonly kind: "disabled-permanent" }
  | {
      readonly kind: "disabled-until-elapsed";
      readonly retryAfterSeconds: number;
    };

export interface ErrorPresentation {
  readonly code: BffErrorCode | "unmapped";
  readonly title: string;
  readonly description: string;
  readonly placement: ErrorPlacement;
  readonly retry: RetryAffordance;
  readonly operatorActionRequired: boolean;
}

export const ERROR_PRESENTATION: Record<BffErrorCode, ErrorPresentation> = {
  gate_unauthorized: {
    code: "gate_unauthorized",
    title: "Session expired",
    description: "You are not authenticated. Sign in again to continue.",
    placement: "full-view-interstitial",
    retry: { kind: "reauthenticate" },
    operatorActionRequired: false,
  },
  gate_unavailable: {
    code: "gate_unavailable",
    title: "Dashboard access is unavailable",
    description:
      "The access gate is temporarily unavailable. This is a server-side configuration issue.",
    placement: "full-view-interstitial",
    retry: { kind: "manual" },
    operatorActionRequired: true,
  },
  invalid_input: {
    code: "invalid_input",
    title: "Check the highlighted field",
    description:
      "The request input failed validation. Fix the field and resubmit.",
    placement: "inline-form",
    retry: { kind: "manual" },
    operatorActionRequired: false,
  },
  upstream_unauthorized: {
    code: "upstream_unauthorized",
    title: "Dashboard cannot authenticate to the MCP server",
    description:
      "The upstream service rejected the dashboard's credentials. This requires operator action; retrying will not help.",
    placement: "panel",
    retry: { kind: "disabled-permanent" },
    operatorActionRequired: true,
  },
  upstream_rate_limited: {
    code: "upstream_rate_limited",
    title: "Shared rate limit reached",
    description:
      "The shared upstream rate limit has been exceeded. The action will re-enable once the delay elapses.",
    placement: "panel",
    retry: { kind: "disabled-until-elapsed", retryAfterSeconds: 0 },
    operatorActionRequired: false,
  },
  upstream_unavailable: {
    code: "upstream_unavailable",
    title: "MCP server temporarily unavailable",
    description:
      "The upstream service is temporarily unavailable. You can retry.",
    placement: "panel",
    retry: { kind: "manual" },
    operatorActionRequired: false,
  },
  upstream_forbidden: {
    code: "upstream_forbidden",
    title: "Target URL rejected",
    description:
      "The upstream service rejected the request. Try a different URL.",
    placement: "inline-field",
    retry: { kind: "manual" },
    operatorActionRequired: false,
  },
  upstream_protocol: {
    code: "upstream_protocol",
    title: "Unexpected response from the MCP server",
    description:
      "The upstream service returned an unexpected response. Report this to an operator if it persists.",
    placement: "panel",
    retry: { kind: "manual" },
    operatorActionRequired: false,
  },
  tool_failed: {
    code: "tool_failed",
    title: "Tool call failed",
    description: "The requested tool call failed.",
    placement: "panel",
    retry: { kind: "manual" },
    operatorActionRequired: false,
  },
  result_invalid: {
    code: "result_invalid",
    title: "Result could not be trusted",
    description:
      "The server returned a result the dashboard cannot trust, so nothing is shown for this request.",
    placement: "panel",
    retry: { kind: "manual" },
    operatorActionRequired: false,
  },
  bff_timeout: {
    code: "bff_timeout",
    title: "Request timed out",
    description:
      "The request exceeded its time budget. Try again, or lower the requested scope.",
    placement: "panel",
    retry: { kind: "manual" },
    operatorActionRequired: false,
  },
};

function unmappedPresentation(error: BffError): ErrorPresentation {
  return {
    code: "unmapped",
    title: `Unrecognized error (${error.code})`,
    description: error.message,
    placement: "panel",
    retry: { kind: "manual" },
    operatorActionRequired: false,
  };
}

/**
 * Looks up the presentation for a decoded `BffError`. `error.code` is typed
 * as `BffErrorCode`, but this function treats the value defensively at
 * runtime (`in` check, not direct indexing) because it is decoded from a
 * network response and a server ahead of this build can send a code this
 * build's union does not yet know about.
 */
export function presentFor(error: BffError): ErrorPresentation {
  const mapped = (ERROR_PRESENTATION as Record<string, ErrorPresentation>)[
    error.code
  ];
  if (mapped === undefined) return unmappedPresentation(error);

  if (
    mapped.retry.kind === "disabled-until-elapsed" &&
    typeof error.retryAfter === "number"
  ) {
    return {
      ...mapped,
      retry: {
        kind: "disabled-until-elapsed",
        retryAfterSeconds: error.retryAfter,
      },
    };
  }

  return mapped;
}
