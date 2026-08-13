import * as z from "zod/v4";
import { LIMITS } from "../config";

export const gscDimensionSchema = z.enum([
  "query",
  "page",
  "country",
  "device",
  "date",
  "searchAppearance",
]);
export const gscRowSchema = z.object({
  keys: z.array(z.string()),
  clicks: z.number(),
  impressions: z.number(),
  ctr: z.number(),
  position: z.number(),
});
export const gscQueryResultSchema = z.object({
  // OBJECT ROOT — required by the SDK
  siteUrl: z.string().min(1),
  startDate: z.string(),
  endDate: z.string(),
  dimensions: z.array(gscDimensionSchema),
  rowCount: z.number().int().min(0),
  rows: z.array(gscRowSchema).max(LIMITS.maxGscRows),
});
export type GscQueryResult = z.infer<typeof gscQueryResultSchema>;
export type GscRow = z.infer<typeof gscRowSchema>;
