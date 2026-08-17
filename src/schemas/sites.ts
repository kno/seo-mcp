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

/**
 * Presented health state — the five derived-at-read-time states from
 * `src/google/health.ts` (`checking` is UI/response-only and never
 * persisted, so it never appears here either; the read path either has a
 * fresh probe result or one of these five). `reason`/`checkedAt` are
 * present only when they meaningfully apply (absent for `healthy` and
 * `not_connected`).
 */
export const presentedHealthSchema = z.object({
  state: z.enum([
    "not_connected",
    "unchecked",
    "stale",
    "healthy",
    "unhealthy",
  ]),
  reason: z.string().nullable().optional(),
  checkedAt: z.string().nullable().optional(),
});

/**
 * Per-site credential status for `list_sites`. Reads only cached D1 rows —
 * never a live Google call — and never exposes `client_id`, `client_secret`,
 * `refresh_token`, `credentialKey`, ciphertext, or IV.
 */
export const credentialStatusSchema = z.object({
  tier: z.enum(["site", "global", "none"]),
  accountLabel: z.string().nullable(),
  accountKey: z.string().nullable(),
  health: z.object({
    searchConsole: presentedHealthSchema,
    googleAds: presentedHealthSchema,
  }),
});

export const listSitesResultSchema = z.object({
  // OBJECT ROOT — required by the SDK
  count: z.number().int().min(0),
  sites: z.array(siteSchema.extend({ credential: credentialStatusSchema })),
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
