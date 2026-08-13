/**
 * JSON export per `design.md`'s "Export Implementation" decision:
 * `{ result, provenance }` where `result` is the container's rendered `data`
 * **verbatim** (same reference, never reshaped, renamed, or stripped) and
 * `provenance` is a SIBLING object carrying freshness (`cacheStatus`,
 * `resultAge`) and truncation/sample provenance (`bounds`, `omittedFields`).
 * Merging markers into `result` itself was rejected because it would
 * violate the `result-export` fidelity requirement.
 */
import type { ToolName } from "../../../src/timeout";
import type { Bound } from "../data/bounds";

export type CacheStatus = "hit" | "miss" | "bypass" | "unavailable";

export interface ExportProvenance {
  readonly exportedAt: string;
  readonly tool: ToolName;
  readonly cacheStatus: CacheStatus;
  readonly resultAge: number;
  /** Empty when the result was not truncated/sampled by any server-side cap. */
  readonly bounds: readonly Bound[];
  /** Fields present in the source result but not represented in this export. */
  readonly omittedFields: readonly string[];
}

export interface JsonExport<T> {
  readonly result: T;
  readonly provenance: ExportProvenance;
}

export interface BuildJsonExportInput<T> {
  readonly tool: ToolName;
  readonly result: T;
  readonly cacheStatus: CacheStatus;
  readonly resultAge: number;
  readonly bounds: readonly Bound[];
  readonly omittedFields?: readonly string[];
  /** Injectable clock for deterministic tests; defaults to `new Date()`. */
  readonly now?: () => Date;
}

export function buildJsonExport<T>(
  input: BuildJsonExportInput<T>,
): JsonExport<T> {
  const now = input.now ? input.now() : new Date();
  return {
    result: input.result,
    provenance: {
      exportedAt: now.toISOString(),
      tool: input.tool,
      cacheStatus: input.cacheStatus,
      resultAge: input.resultAge,
      bounds: input.bounds,
      omittedFields: input.omittedFields ?? [],
    },
  };
}

export function serializeJsonExport<T>(exportValue: JsonExport<T>): string {
  return JSON.stringify(exportValue, null, 2);
}
