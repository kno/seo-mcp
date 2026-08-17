import * as z from "zod/v4";

/**
 * `src/db/site-store.ts`'s stored-row shape for the persisted domain list
 * backing the dashboard's global site selector. `label` is `string | null`
 * (explicit, never optional) — mirrors `storedSnapshotSchema`'s own
 * discipline in `src/schemas/gsc-snapshots.ts`.
 */
export const siteSchema = z.object({
  id: z.number().int(),
  url: z.string().min(1),
  label: z.string().nullable(),
  createdAt: z.string(),
});
export type Site = z.infer<typeof siteSchema>;

// ---------------------------------------------------------------------------
// Tool result shapes (src/mcp-tools/sites.ts) — the object roots the three
// site tool registrations actually return.
// ---------------------------------------------------------------------------

export const listSitesResultSchema = z.object({
  // OBJECT ROOT — required by the SDK
  count: z.number().int().min(0),
  sites: z.array(siteSchema),
});
export type ListSitesResult = z.infer<typeof listSitesResultSchema>;

export const addSiteResultSchema = z.object({
  // OBJECT ROOT — required by the SDK
  added: z.boolean(),
  site: siteSchema.nullable(),
});
export type AddSiteResult = z.infer<typeof addSiteResultSchema>;

export const deleteSiteResultSchema = z.object({
  // OBJECT ROOT — required by the SDK
  siteId: z.number().int(),
  deleted: z.boolean(),
});
export type DeleteSiteResult = z.infer<typeof deleteSiteResultSchema>;
