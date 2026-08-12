import * as z from "zod/v4";

export const linkProbeSchema = z.object({
  url: z.string(),
  state: z.enum(["ok", "broken", "error"]),
  status: z.number().optional(),
  redirects: z.number().optional(),
  error: z.string().optional(),
});

export const linkCheckResultSchema = z.object({
  url: z.string(),
  pageStatus: z.number(),
  checked: z.number(),
  ok: z.number(),
  broken: z.number(),
  errors: z.number(),
  results: z.array(linkProbeSchema),
});
