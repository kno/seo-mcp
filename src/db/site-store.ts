import type * as z from "zod/v4";
import { siteSchema } from "../schemas/sites";

export type Site = z.infer<typeof siteSchema>;

interface SiteInput {
  url: string;
  label?: string;
}

interface SiteRecord {
  id: number;
  url: string;
  label: string | null;
  created_at: string;
}

function toSite(record: SiteRecord): Site {
  return {
    id: record.id,
    url: record.url,
    label: record.label,
    createdAt: record.created_at,
  };
}

export async function listSites(db: D1Database): Promise<Site[]> {
  const { results } = await db
    .prepare("SELECT id, url, label, created_at FROM sites ORDER BY id ASC")
    .all<SiteRecord>();
  return results.map(toSite);
}

/**
 * Inserts a new site. `INSERT OR IGNORE` on the unique `url` column makes
 * a duplicate add a no-op rather than an error — mirrors
 * `gsc-store.ts#deleteGscSnapshot`'s `result.meta.changes > 0` pattern to
 * distinguish "inserted" from "already existed" instead of reporting
 * success either way.
 */
export async function addSite(
  db: D1Database,
  input: SiteInput,
): Promise<{ added: boolean; site: Site | null }> {
  const createdAt = new Date().toISOString();
  const result = await db
    .prepare(
      "INSERT OR IGNORE INTO sites (url, label, created_at) VALUES (?, ?, ?)",
    )
    .bind(input.url, input.label ?? null, createdAt)
    .run();

  const added = result.meta.changes > 0;
  if (!added) return { added: false, site: null };

  return {
    added: true,
    site: {
      id: Number(result.meta.last_row_id),
      url: input.url,
      label: input.label ?? null,
      createdAt,
    },
  };
}

export async function deleteSite(
  db: D1Database,
  siteId: number,
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM sites WHERE id = ?")
    .bind(siteId)
    .run();
  return result.meta.changes > 0;
}
