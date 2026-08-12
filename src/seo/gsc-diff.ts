import { LIMITS } from "../config";
import type { GscRow } from "../google/search-console";

export interface GscMetrics {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscDiffRow {
  query: string;
  page: string;
  base: GscMetrics | null;
  current: GscMetrics | null;
  clicksDelta: number;
  impressionsDelta: number;
  positionDelta: number;
}

export interface GscDiff {
  baseCount: number;
  currentCount: number;
  decayed: GscDiffRow[];
  improved: GscDiffRow[];
  lost: GscDiffRow[];
  gained: GscDiffRow[];
}

function keyOf(row: GscRow): string {
  return `${row.keys[0] ?? ""} ${row.keys[1] ?? ""}`;
}

function metricsOf(row: GscRow): GscMetrics {
  return {
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: row.ctr,
    position: row.position,
  };
}

function indexByKey(rows: GscRow[]): Map<string, GscRow> {
  const map = new Map<string, GscRow>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!map.has(key)) map.set(key, row);
  }
  return map;
}

export function diffGscRows(base: GscRow[], current: GscRow[]): GscDiff {
  const baseMap = indexByKey(base);
  const currentMap = indexByKey(current);

  const decayed: GscDiffRow[] = [];
  const improved: GscDiffRow[] = [];
  const lost: GscDiffRow[] = [];
  const gained: GscDiffRow[] = [];

  for (const [key, baseRow] of baseMap) {
    const query = baseRow.keys[0] ?? "";
    const page = baseRow.keys[1] ?? "";
    const currentRow = currentMap.get(key);
    if (currentRow) {
      const clicksDelta = currentRow.clicks - baseRow.clicks;
      const impressionsDelta = currentRow.impressions - baseRow.impressions;
      const positionDelta = currentRow.position - baseRow.position;
      const diffRow: GscDiffRow = {
        query,
        page,
        base: metricsOf(baseRow),
        current: metricsOf(currentRow),
        clicksDelta,
        impressionsDelta,
        positionDelta,
      };
      if (clicksDelta < 0 || positionDelta > 0) {
        decayed.push(diffRow);
      } else if (clicksDelta > 0 || positionDelta < 0) {
        improved.push(diffRow);
      }
    } else {
      lost.push({
        query,
        page,
        base: metricsOf(baseRow),
        current: null,
        clicksDelta: -baseRow.clicks,
        impressionsDelta: -baseRow.impressions,
        positionDelta: -baseRow.position,
      });
    }
  }

  for (const [key, currentRow] of currentMap) {
    if (baseMap.has(key)) continue;
    gained.push({
      query: currentRow.keys[0] ?? "",
      page: currentRow.keys[1] ?? "",
      base: null,
      current: metricsOf(currentRow),
      clicksDelta: currentRow.clicks,
      impressionsDelta: currentRow.impressions,
      positionDelta: currentRow.position,
    });
  }

  decayed.sort(
    (a, b) =>
      a.clicksDelta - b.clicksDelta || b.positionDelta - a.positionDelta,
  );
  improved.sort((a, b) => b.clicksDelta - a.clicksDelta);
  lost.sort((a, b) => (b.base?.clicks ?? 0) - (a.base?.clicks ?? 0));
  gained.sort((a, b) => (b.current?.clicks ?? 0) - (a.current?.clicks ?? 0));

  const cap = LIMITS.maxDiffRows;
  return {
    baseCount: baseMap.size,
    currentCount: currentMap.size,
    decayed: decayed.slice(0, cap),
    improved: improved.slice(0, cap),
    lost: lost.slice(0, cap),
    gained: gained.slice(0, cap),
  };
}
