import * as z from "zod/v4";

export const healthSchema = z.object({
  status: z.string(),
  service: z.string(),
  version: z.string(),
});

export type HealthResult = z.infer<typeof healthSchema>;
