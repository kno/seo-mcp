import { LIMITS } from "../config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type KeywordIntent =
  "transactional" | "commercial" | "informational" | "local";

export interface ClassifiedKeyword {
  keyword: string;
  intent: KeywordIntent;
  tokens: string[];
}

export interface KeywordCluster {
  label: string;
  keywords: string[];
}

export interface ClusterResult {
  count: number;
  intents: Record<string, number>;
  clusters: KeywordCluster[];
  keywords: ClassifiedKeyword[];
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  // Spanish
  "de",
  "la",
  "el",
  "los",
  "las",
  "un",
  "una",
  "para",
  "por",
  "con",
  "en",
  "y",
  "o",
  "del",
  "al",
  "que",
  "como",
  "mas",
  "muy",
  "tu",
  "mi",
  // English
  "the",
  "for",
  "and",
  "with",
  "how",
  "what",
  "why",
  "to",
  "of",
  "a",
  "in",
  "on",
]);

/** Lowercases and strips diacritics from a string (NFD + combining marks removed). */
export function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function normalizeToken(value: string): string {
  return stripDiacritics(value.toLowerCase());
}

/**
 * Tokenizes a keyword: lowercases, strips diacritics, splits on non
 * alphanumeric (unicode-aware), drops stopwords and tokens shorter than
 * 3 characters.
 */
export function tokenize(keyword: string): string[] {
  const normalized = normalizeToken(keyword);
  const rawTokens = normalized.match(/[a-z0-9]+/gu) ?? [];
  return rawTokens.filter(
    (token) => token.length >= 3 && !STOPWORDS.has(token),
  );
}

// ---------------------------------------------------------------------------
// Intent classification (heuristic, not exhaustive)
// ---------------------------------------------------------------------------

const TRANSACTIONAL_CUES = [
  "comprar",
  "compra",
  "precio",
  "precios",
  "barato",
  "barata",
  "oferta",
  "ofertas",
  "descuento",
  "tienda",
  "contratar",
  "presupuesto",
  "cuanto cuesta",
  "coste",
  "tarifa",
  "near me",
  "buy",
  "cheap",
  "price",
  "shop",
  "order",
  "hire",
];

const COMMERCIAL_CUES = [
  "mejor",
  "mejores",
  "opiniones",
  "opinion",
  "review",
  "reviews",
  "comparativa",
  "comparar",
  "vs",
  "top",
  "marcas",
  "alternativa",
  "alternativas",
  "best",
  "compare",
];

const LOCAL_CUES = ["cerca de mi", "cerca", "near me"];

function includesCue(normalized: string, cues: string[]): boolean {
  return cues.some((cue) => normalized.includes(normalizeToken(cue)));
}

/**
 * Classifies the search intent of a keyword. This is a heuristic based on
 * lexical cues (diacritic- and case-insensitive substring matching) and is
 * not a substitute for real intent research.
 */
export function classifyIntent(keyword: string): KeywordIntent {
  const normalized = normalizeToken(keyword);

  if (includesCue(normalized, TRANSACTIONAL_CUES)) return "transactional";
  if (includesCue(normalized, COMMERCIAL_CUES)) return "commercial";
  if (includesCue(normalized, LOCAL_CUES)) return "local";
  return "informational";
}

// ---------------------------------------------------------------------------
// Clustering
// ---------------------------------------------------------------------------

const OTHER_LABEL = "other";

export function clusterKeywords(keywords: string[]): ClusterResult {
  // Trim, drop empties, cap, dedupe preserving first-seen order.
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const raw of keywords) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    deduped.push(trimmed);
    if (deduped.length >= LIMITS.maxClusterKeywords) break;
  }

  const classified: ClassifiedKeyword[] = deduped.map((keyword) => ({
    keyword,
    intent: classifyIntent(keyword),
    tokens: tokenize(keyword),
  }));

  // Document frequency per token.
  const docFreq = new Map<string, number>();
  for (const { tokens } of classified) {
    for (const token of new Set(tokens)) {
      docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
    }
  }

  const clusterKeyFor = (tokens: string[]): string => {
    if (tokens.length === 0) return OTHER_LABEL;
    let best = tokens[0];
    let bestFreq = docFreq.get(best) ?? 0;
    for (const token of tokens.slice(1)) {
      const freq = docFreq.get(token) ?? 0;
      if (
        freq > bestFreq ||
        (freq === bestFreq && token.length > best.length) ||
        (freq === bestFreq &&
          token.length === best.length &&
          token.localeCompare(best) < 0)
      ) {
        best = token;
        bestFreq = freq;
      }
    }
    return best;
  };

  const clusterMap = new Map<string, string[]>();
  for (const { keyword, tokens } of classified) {
    const key = clusterKeyFor(tokens);
    const bucket = clusterMap.get(key);
    if (bucket) {
      bucket.push(keyword);
    } else {
      clusterMap.set(key, [keyword]);
    }
  }

  const clusters: KeywordCluster[] = Array.from(
    clusterMap.entries(),
    ([label, kws]) => ({ label, keywords: kws }),
  ).sort((a, b) => {
    if (b.keywords.length !== a.keywords.length) {
      return b.keywords.length - a.keywords.length;
    }
    return a.label.localeCompare(b.label);
  });

  const intents: Record<string, number> = {};
  for (const { intent } of classified) {
    intents[intent] = (intents[intent] ?? 0) + 1;
  }

  return {
    count: classified.length,
    intents,
    clusters,
    keywords: classified,
  };
}
