import { describe, expect, it } from "vitest";
import { classifyIntent, tokenize, clusterKeywords } from "../src/seo/keywords";
import { LIMITS } from "../src/config";

// ---------------------------------------------------------------------------
// classifyIntent
// ---------------------------------------------------------------------------

describe("classifyIntent", () => {
  it("classifies transactional keywords", () => {
    expect(classifyIntent("comprar cortacésped")).toBe("transactional");
  });

  it("classifies commercial keywords", () => {
    expect(classifyIntent("mejores tijeras de podar")).toBe("commercial");
  });

  it("classifies informational keywords", () => {
    expect(classifyIntent("cómo podar un seto")).toBe("informational");
  });

  it("classifies local keywords", () => {
    expect(classifyIntent("jardinería cerca de mi")).toBe("local");
  });

  it("is diacritic-insensitive", () => {
    expect(classifyIntent("comó podar un seto")).toBe("informational");
    expect(classifyIntent("como podar un seto")).toBe("informational");
  });

  it("defaults to informational for a bare noun", () => {
    expect(classifyIntent("cortacésped")).toBe("informational");
  });
});

// ---------------------------------------------------------------------------
// tokenize
// ---------------------------------------------------------------------------

describe("tokenize", () => {
  it("strips accents", () => {
    expect(tokenize("jardinería")).toEqual(["jardineria"]);
  });

  it("drops stopwords and short tokens", () => {
    expect(tokenize("la mejor tienda de flores")).toEqual([
      "mejor",
      "tienda",
      "flores",
    ]);
  });

  it("drops tokens shorter than 3 chars", () => {
    expect(tokenize("un ir de tienda")).toEqual(["tienda"]);
  });
});

// ---------------------------------------------------------------------------
// clusterKeywords
// ---------------------------------------------------------------------------

describe("clusterKeywords", () => {
  it("groups keywords sharing a dominant token into the same cluster", () => {
    const result = clusterKeywords([
      "comprar cortacésped barato",
      "cortacésped a gasolina",
      "mejor cortacésped 2026",
      "regar el jardín",
    ]);

    const cortacespedCluster = result.clusters.find(
      (c) => c.label === "cortacesped",
    );
    expect(cortacespedCluster).toBeDefined();
    expect(cortacespedCluster!.keywords).toEqual([
      "comprar cortacésped barato",
      "cortacésped a gasolina",
      "mejor cortacésped 2026",
    ]);
  });

  it("sorts clusters by size DESC", () => {
    const result = clusterKeywords([
      "comprar cortacésped barato",
      "cortacésped a gasolina",
      "mejor cortacésped 2026",
      "regar el jardín",
    ]);

    expect(result.clusters[0].label).toBe("cortacesped");
    expect(result.clusters[0].keywords.length).toBeGreaterThanOrEqual(
      result.clusters[1]?.keywords.length ?? 0,
    );
  });

  it("puts a keyword with only stopwords into 'other'", () => {
    const result = clusterKeywords(["de la el un"]);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].label).toBe("other");
    expect(result.clusters[0].keywords).toEqual(["de la el un"]);
  });

  it("dedupes keywords preserving first-seen order", () => {
    const result = clusterKeywords([
      "comprar flores",
      "comprar flores",
      "regar plantas",
    ]);
    expect(result.count).toBe(2);
    expect(result.keywords.map((k) => k.keyword)).toEqual([
      "comprar flores",
      "regar plantas",
    ]);
  });

  it("trims and drops empty entries", () => {
    const result = clusterKeywords(["  comprar flores  ", "   ", ""]);
    expect(result.count).toBe(1);
    expect(result.keywords[0].keyword).toBe("comprar flores");
  });

  it("caps input at LIMITS.maxClusterKeywords", () => {
    const many = Array.from(
      { length: LIMITS.maxClusterKeywords + 50 },
      (_, i) => `keyword unique-${i}`,
    );
    const result = clusterKeywords(many);
    expect(result.count).toBe(LIMITS.maxClusterKeywords);
  });

  it("intents counts add up to count", () => {
    const result = clusterKeywords([
      "comprar flores",
      "mejores floristerías",
      "cómo cuidar flores",
      "floristería cerca de mi",
    ]);
    const total = Object.values(result.intents).reduce((a, b) => a + b, 0);
    expect(total).toBe(result.count);
  });

  it("is deterministic for the same input", () => {
    const input = [
      "comprar cortacésped barato",
      "cortacésped a gasolina",
      "mejor cortacésped 2026",
      "regar el jardín",
    ];
    expect(clusterKeywords(input)).toEqual(clusterKeywords(input));
  });

  it("keywords array preserves input order and reports tokens", () => {
    const result = clusterKeywords(["comprar flores baratas", "regar plantas"]);
    expect(result.keywords[0].keyword).toBe("comprar flores baratas");
    expect(result.keywords[0].tokens).toEqual(["comprar", "flores", "baratas"]);
    expect(result.keywords[1].keyword).toBe("regar plantas");
  });
});
