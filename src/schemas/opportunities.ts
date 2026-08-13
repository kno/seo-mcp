import * as z from "zod/v4";
import { gscRowSchema } from "./search-console";

export const opportunityResultSchema = z
  .object({
    // OBJECT ROOT — required by the SDK
    siteUrl: z.string().min(1),
    startDate: z.string(),
    endDate: z.string(),
    dimensions: z.array(z.string()),
    criteria: z.record(z.string(), z.number()),
    rowCount: z.number().int().min(0),
    rows: z.array(gscRowSchema),
  })
  .refine(
    (data) =>
      typeof data.criteria.limit !== "number" ||
      data.rows.length <= data.criteria.limit,
    { message: "rows.length exceeds criteria.limit" },
  );

export type OpportunityResult = z.infer<typeof opportunityResultSchema>;
