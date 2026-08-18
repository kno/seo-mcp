import { LIMITS, type Env } from "./config";
import { searchConsoleQuery } from "./google/search-console";
import { resolveSiteCredentials } from "./google/credentials";
import { withCallHealthTracking } from "./google/health";
import { getSiteByUrl } from "./db/site-store";
import { storeGscSnapshot } from "./db/gsc-store";

const DAY_MS = 86_400_000;

function toUtcDate(ms: number): string {
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function snapshotWindow(now: () => number): {
  startDate: string;
  endDate: string;
} {
  const t = now();
  return {
    endDate: toUtcDate(t - 3 * DAY_MS),
    startDate: toUtcDate(t - 31 * DAY_MS),
  };
}

export function parseProperties(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export async function runScheduledSnapshots(
  env: Env,
  fetcher?: typeof fetch,
  now: () => number = Date.now,
): Promise<{ attempted: number; stored: number; skipped: string[] }> {
  if (!env.DB) return { attempted: 0, stored: 0, skipped: ["no-db"] };

  const properties = parseProperties(env.GSC_SNAPSHOT_PROPERTIES);
  if (properties.length === 0) {
    return { attempted: 0, stored: 0, skipped: ["no-properties"] };
  }

  const { startDate, endDate } = snapshotWindow(now);
  const skipped: string[] = [];
  let attempted = 0;
  let stored = 0;

  for (const property of properties) {
    attempted += 1;
    try {
      const resolved = await resolveSiteCredentials(env, property);
      const site =
        resolved.source === "site"
          ? await getSiteByUrl(env.DB, property)
          : null;
      const r = await withCallHealthTracking(
        env.DB,
        site,
        "search-console",
        resolved,
        () =>
          searchConsoleQuery(
            {
              siteUrl: property,
              startDate,
              endDate,
              dimensions: ["query", "page"],
              rowLimit: LIMITS.maxSnapshotRows,
            },
            resolved.credentials,
            fetcher,
            now,
          ),
      );
      await storeGscSnapshot(env.DB, {
        siteUrl: property,
        startDate,
        endDate,
        label: "scheduled",
        capturedAt: new Date(now()).toISOString(),
        rows: r.rows,
      });
      stored += 1;
    } catch {
      skipped.push(property);
    }
  }

  return { attempted, stored, skipped };
}
