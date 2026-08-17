import * as z from "zod/v4";

/**
 * Builds the `structuredContent` payload for a tool response.
 *
 * Two call shapes:
 * - `jsonResult(schema, value)` — every tool with a published `outputSchema`
 *   (the `mcp-result-contract` reconciliation gate). `schema.parse` validates
 *   `value` against the tool's own declared `outputSchema` before it is
 *   returned; a thrown `ZodError` is caught by the same try/catch each tool
 *   handler already uses for `errorResult`, so a result violating its own
 *   schema surfaces as a normal tool failure rather than invalid
 *   `structuredContent`.
 * - `jsonResult(value)` — legacy single-argument form kept for the
 *   remaining tools that do not yet declare an `outputSchema` (all six
 *   `business_*` tools); out of scope for this change. `snapshot_crawl`,
 *   `list_crawl_snapshots` and `compare_crawls` (`history-comparison-view`,
 *   PR11) now use the two-argument `jsonResult(schema, value)` form like
 *   every other reconciled tool.
 */
export function jsonResult<T extends Record<string, unknown>>(
  schema: z.ZodType<T>,
  value: T,
): { content: [{ type: "text"; text: string }]; structuredContent: T };
export function jsonResult(value: unknown): {
  content: [{ type: "text"; text: string }];
  structuredContent: Record<string, unknown>;
};
export function jsonResult(schemaOrValue: unknown, value?: unknown) {
  if (arguments.length < 2) {
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(schemaOrValue, null, 2) },
      ],
      structuredContent: schemaOrValue as Record<string, unknown>,
    };
  }
  const parsed = (schemaOrValue as z.ZodType).parse(value);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(parsed, null, 2) }],
    structuredContent: parsed,
  };
}

export const errorResult = (error: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: error instanceof Error ? error.message : "Unexpected error",
    },
  ],
  isError: true,
});

// Deletion-specific confirm gate — mirrors `src/google/business.ts`'s
// `assertConfirmed`/`REFUSE_WRITE` shape exactly (same "throw unless
// confirm===true" contract), with a delete-specific message since deleting
// a snapshot is a distinct, irreversible action from a Business Profile
// write.
export const REFUSE_DELETE =
  "Refusing to delete: pass confirm=true to execute this deletion";

export function assertConfirmedDelete(confirm: boolean): void {
  if (confirm !== true) {
    throw new Error(REFUSE_DELETE);
  }
}
