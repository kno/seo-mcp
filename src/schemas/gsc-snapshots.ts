import * as z from "zod/v4";

export const gscMetricsSchema = z.object({
  clicks: z.number(),
  impressions: z.number(),
  ctr: z.number(),
  position: z.number(),
});
export type GscMetrics = z.infer<typeof gscMetricsSchema>;

export const gscDiffRowSchema = z.object({
  query: z.string(),
  page: z.string(),
  base: gscMetricsSchema.nullable(),
  current: gscMetricsSchema.nullable(),
  clicksDelta: z.number(),
  impressionsDelta: z.number(),
  positionDelta: z.number(),
});
export type GscDiffRow = z.infer<typeof gscDiffRowSchema>;

export const gscDiffSchema = z.object({
  baseCount: z.number().int().min(0),
  currentCount: z.number().int().min(0),
  decayed: z.array(gscDiffRowSchema),
  improved: z.array(gscDiffRowSchema),
  lost: z.array(gscDiffRowSchema),
  gained: z.array(gscDiffRowSchema),
});
export type GscDiff = z.infer<typeof gscDiffSchema>;

export const storedSnapshotSchema = z.object({
  id: z.number().int(),
  siteUrl: z.string().min(1),
  capturedAt: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  label: z.string().nullable(),
});
export type StoredSnapshot = z.infer<typeof storedSnapshotSchema>;

// ---------------------------------------------------------------------------
// Tool result shapes (src/server.ts) — the object roots the three
// GSC-snapshot tool registrations actually return.
// ---------------------------------------------------------------------------

export const snapshotSearchConsoleResultSchema = z.object({
  // OBJECT ROOT — required by the SDK
  snapshotId: z.number().int(),
  siteUrl: z.string().min(1),
  rowCount: z.number().int().min(0),
  capturedAt: z.string(),
});
export type SnapshotSearchConsoleResult = z.infer<
  typeof snapshotSearchConsoleResultSchema
>;

export const listSearchConsoleSnapshotsResultSchema = z.object({
  // OBJECT ROOT — required by the SDK
  siteUrl: z.string().min(1),
  count: z.number().int().min(0),
  snapshots: z.array(storedSnapshotSchema),
});
export type ListSearchConsoleSnapshotsResult = z.infer<
  typeof listSearchConsoleSnapshotsResultSchema
>;

export const compareSearchConsoleResultSchema = z.object({
  // OBJECT ROOT — required by the SDK
  siteUrl: z.string().min(1),
  baseSnapshotId: z.number().int(),
  currentSnapshotId: z.number().int(),
  diff: gscDiffSchema,
});
export type CompareSearchConsoleResult = z.infer<
  typeof compareSearchConsoleResultSchema
>;
