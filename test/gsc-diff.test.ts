import { describe, expect, it } from "vitest";
import { diffGscRows } from "../src/seo/gsc-diff";
import { LIMITS } from "../src/config";
import type { GscRow } from "../src/google/search-console";

function row(
  query: string,
  page: string,
  clicks: number,
  impressions: number,
  position: number,
  ctr = impressions > 0 ? clicks / impressions : 0,
): GscRow {
  return { keys: [query, page], clicks, impressions, ctr, position };
}

describe("diffGscRows", () => {
  it("returns empty buckets and zero counts for empty inputs", () => {
    const diff = diffGscRows([], []);
    expect(diff.baseCount).toBe(0);
    expect(diff.currentCount).toBe(0);
    expect(diff.decayed).toEqual([]);
    expect(diff.improved).toEqual([]);
    expect(diff.lost).toEqual([]);
    expect(diff.gained).toEqual([]);
  });

  it("classifies a click drop as decayed with correct delta signs", () => {
    const base = [row("shoes", "/p", 100, 1000, 3)];
    const current = [row("shoes", "/p", 40, 900, 5)];
    const diff = diffGscRows(base, current);

    expect(diff.baseCount).toBe(1);
    expect(diff.currentCount).toBe(1);
    expect(diff.decayed).toHaveLength(1);
    const d = diff.decayed[0];
    expect(d.query).toBe("shoes");
    expect(d.page).toBe("/p");
    expect(d.clicksDelta).toBe(-60);
    expect(d.impressionsDelta).toBe(-100);
    // position 3 -> 5 means worse ranking => positive delta
    expect(d.positionDelta).toBe(2);
    expect(diff.improved).toEqual([]);
  });

  it("treats worsened position alone (no click drop) as decayed", () => {
    const base = [row("a", "/x", 10, 100, 2)];
    const current = [row("a", "/x", 10, 100, 8)];
    const diff = diffGscRows(base, current);
    expect(diff.decayed).toHaveLength(1);
    expect(diff.decayed[0].positionDelta).toBe(6);
    expect(diff.improved).toEqual([]);
  });

  it("classifies click gain / better position as improved", () => {
    const base = [row("a", "/x", 10, 100, 9)];
    const current = [row("a", "/x", 30, 120, 4)];
    const diff = diffGscRows(base, current);
    expect(diff.improved).toHaveLength(1);
    const i = diff.improved[0];
    expect(i.clicksDelta).toBe(20);
    expect(i.positionDelta).toBe(-5);
    expect(diff.decayed).toEqual([]);
  });

  it("keys present only in base become lost with negative deltas", () => {
    const base = [row("gone", "/g", 50, 500, 4)];
    const current: GscRow[] = [];
    const diff = diffGscRows(base, current);
    expect(diff.lost).toHaveLength(1);
    const l = diff.lost[0];
    expect(l.query).toBe("gone");
    expect(l.base).not.toBeNull();
    expect(l.current).toBeNull();
    expect(l.clicksDelta).toBe(-50);
    expect(l.impressionsDelta).toBe(-500);
    expect(diff.decayed).toEqual([]);
    expect(diff.gained).toEqual([]);
  });

  it("keys present only in current become gained with positive deltas", () => {
    const base: GscRow[] = [];
    const current = [row("new", "/n", 25, 300, 6)];
    const diff = diffGscRows(base, current);
    expect(diff.gained).toHaveLength(1);
    const g = diff.gained[0];
    expect(g.query).toBe("new");
    expect(g.base).toBeNull();
    expect(g.current).not.toBeNull();
    expect(g.clicksDelta).toBe(25);
    expect(g.impressionsDelta).toBe(300);
  });

  it("sorts decayed by clicksDelta ASC then positionDelta DESC", () => {
    const base = [
      row("big", "/1", 100, 1000, 5),
      row("mid", "/2", 50, 500, 5),
      row("tie", "/3", 30, 300, 5),
      row("tieb", "/4", 30, 300, 5),
    ];
    const current = [
      row("big", "/1", 10, 900, 6), // -90
      row("mid", "/2", 20, 400, 6), // -30
      row("tie", "/3", 10, 200, 6), // -20, posDelta +1
      row("tieb", "/4", 10, 200, 9), // -20, posDelta +4 (worse -> first among tie)
    ];
    const diff = diffGscRows(base, current);
    expect(diff.decayed.map((d) => d.query)).toEqual([
      "big",
      "mid",
      "tieb",
      "tie",
    ]);
  });

  it("sorts improved by clicksDelta DESC", () => {
    const base = [row("a", "/a", 10, 100, 5), row("b", "/b", 10, 100, 5)];
    const current = [
      row("a", "/a", 20, 100, 5), // +10
      row("b", "/b", 40, 100, 5), // +30
    ];
    const diff = diffGscRows(base, current);
    expect(diff.improved.map((d) => d.query)).toEqual(["b", "a"]);
  });

  it("sorts lost by base.clicks DESC and gained by current.clicks DESC", () => {
    const base = [row("l1", "/a", 5, 50, 5), row("l2", "/b", 40, 400, 5)];
    const current = [row("g1", "/c", 3, 30, 5), row("g2", "/d", 33, 330, 5)];
    const diff = diffGscRows(base, current);
    expect(diff.lost.map((d) => d.query)).toEqual(["l2", "l1"]);
    expect(diff.gained.map((d) => d.query)).toEqual(["g2", "g1"]);
  });

  it("caps each bucket at LIMITS.maxDiffRows", () => {
    const original = LIMITS.maxDiffRows;
    (LIMITS as { maxDiffRows: number }).maxDiffRows = 2;
    try {
      const base = Array.from({ length: 5 }, (_, i) =>
        row(`d${i}`, `/d${i}`, 100, 1000, 5),
      );
      const current = Array.from({ length: 5 }, (_, i) =>
        row(`d${i}`, `/d${i}`, 10, 900, 6),
      );
      const gainedCur = Array.from({ length: 5 }, (_, i) =>
        row(`g${i}`, `/g${i}`, 10, 100, 5),
      );
      const diff = diffGscRows(base, [...current, ...gainedCur]);
      expect(diff.decayed).toHaveLength(2);
      expect(diff.gained).toHaveLength(2);
    } finally {
      (LIMITS as { maxDiffRows: number }).maxDiffRows = original;
    }
  });

  it("uses empty-string defaults for missing keys and counts distinct keys", () => {
    const base: GscRow[] = [
      { keys: [], clicks: 5, impressions: 50, ctr: 0.1, position: 4 },
    ];
    const current: GscRow[] = [
      { keys: ["only"], clicks: 8, impressions: 80, ctr: 0.1, position: 3 },
    ];
    const diff = diffGscRows(base, current);
    expect(diff.baseCount).toBe(1);
    expect(diff.currentCount).toBe(1);
    expect(diff.lost[0].query).toBe("");
    expect(diff.lost[0].page).toBe("");
    expect(diff.gained[0].query).toBe("only");
    expect(diff.gained[0].page).toBe("");
  });
});
