/**
 * Word matching shared by both retrieval backends.
 *
 * Exact words always count fully. On top, a query word also finds:
 * - the same word with or without umlauts ("Prüfung" and "Pruefung"),
 * - its word family through a light stem ("approves" finds "approver",
 *   "approval"; "quotes" finds "quote", "quotation"),
 * - longer words it starts ("warehou" finds "warehouse"), from 5 letters,
 * - compound words that contain it ("schein" finds "lieferschein"), from 6 letters.
 *
 * Variants score below the exact word, and a match through a variant counts
 * as a match of the word the person typed, never as an extra word, so
 * coverage-based confidence gates are not inflated.
 */

export type VariantKind = "family" | "prefix" | "compound";

export interface WordVariant {
  term: string;
  kind: VariantKind;
  factor: number;
}

export const VARIANT_FACTORS: Record<VariantKind, number> = {
  family: 0.85,
  prefix: 0.7,
  compound: 0.5,
};

const MIN_STEM_LENGTH = 4;
const MIN_PREFIX_QUERY_LENGTH = 5;
const MIN_COMPOUND_QUERY_LENGTH = 6;
const MAX_VARIANTS_PER_WORD = 24;
const MAX_PREFIX_EXTRA_LETTERS = 6;

/** Lowercase, umlauts written out (ä→ae, ö→oe, ü→ue, ß→ss), other accents removed. */
export function foldText(text: string): string {
  return `${text || ""}`
    .normalize("NFC")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
}

// Longest first. [suffix, replacement]
const SUFFIXES: Array<[string, string]> = [
  ["ational", "ate"],
  ["ations", ""],
  ["ation", ""],
  ["ments", ""],
  ["ment", ""],
  ["ungen", ""],
  ["heiten", ""],
  ["keiten", ""],
  ["ung", ""],
  ["heit", ""],
  ["keit", ""],
  ["ings", ""],
  ["ing", ""],
  ["ies", "y"],
  ["ied", "y"],
  ["ers", ""],
  ["ors", ""],
  ["als", ""],
  ["er", ""],
  ["or", ""],
  ["al", ""],
  ["ed", ""],
  ["es", ""],
  ["en", ""],
  ["ly", ""],
  ["e", ""],
  ["s", ""],
];

/**
 * A light, deterministic stem for matching word families in English and
 * German. It strips one common ending when at least four letters remain,
 * and drops a doubled final consonant ("planning" → "plan").
 */
export function wordStem(word: string): string {
  const token = foldText(word);
  if (token.length < MIN_STEM_LENGTH || /\d/.test(token)) return token;
  let stem = token;
  for (const [suffix, replacement] of SUFFIXES) {
    if (!token.endsWith(suffix)) continue;
    if (suffix === "s" && /[sui]s$/.test(token)) continue; // process, status, analysis
    const candidate = token.slice(0, token.length - suffix.length) + replacement;
    if (candidate.length < MIN_STEM_LENGTH) continue;
    stem = candidate;
    break;
  }
  if (stem.length > 3 && /([b-df-hj-np-tv-z])\1$/.test(stem)) stem = stem.slice(0, -1);
  return stem;
}

export interface TermIndex {
  /** Indexed words related to a query word, best first; never includes the word itself. */
  variantsFor(word: string): WordVariant[];
}

/** Builds a lookup over the words of an index once; variantsFor is then cheap per query. */
export function buildTermIndex(terms: Iterable<string>): TermIndex {
  const sorted = [...new Set(terms)].filter(Boolean).sort();
  const byStem = new Map<string, string[]>();
  for (const term of sorted) {
    const stem = wordStem(term);
    const list = byStem.get(stem);
    if (list) list.push(term);
    else byStem.set(stem, [term]);
  }
  const memo = new Map<string, WordVariant[]>();

  function startingWith(prefix: string): string[] {
    let low = 0;
    let high = sorted.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((sorted[mid] ?? "") < prefix) low = mid + 1;
      else high = mid;
    }
    const out: string[] = [];
    for (let i = low; i < sorted.length; i += 1) {
      const term = sorted[i] ?? "";
      if (!term.startsWith(prefix)) break;
      out.push(term);
    }
    return out;
  }

  return {
    variantsFor(word: string): WordVariant[] {
      const query = foldText(word);
      const cached = memo.get(query);
      if (cached) return cached;
      const found = new Map<string, WordVariant>();
      const add = (term: string, kind: VariantKind) => {
        if (term === query || found.has(term)) return;
        found.set(term, { term, kind, factor: VARIANT_FACTORS[kind] });
      };

      if (query.length >= MIN_STEM_LENGTH && !/^\d+$/.test(query)) {
        const stem = wordStem(query);
        for (const term of byStem.get(stem) ?? []) add(term, "family");
        if (query.length >= MIN_PREFIX_QUERY_LENGTH) {
          const base = stem.length >= MIN_PREFIX_QUERY_LENGTH ? stem : query;
          for (const term of startingWith(base)) {
            if (term.length - base.length <= MAX_PREFIX_EXTRA_LETTERS) add(term, "prefix");
          }
        }
        if (query.length >= MIN_COMPOUND_QUERY_LENGTH) {
          const part = stem.length >= MIN_COMPOUND_QUERY_LENGTH ? stem : query;
          for (const term of sorted) {
            if (term.length > part.length + 2 && !term.startsWith(part) && term.includes(part)) {
              add(term, "compound");
            }
          }
        }
      }

      const order: Record<VariantKind, number> = { family: 0, prefix: 1, compound: 2 };
      const result = [...found.values()]
        .sort(
          (a, b) =>
            order[a.kind] - order[b.kind] ||
            a.term.length - b.term.length ||
            a.term.localeCompare(b.term),
        )
        .slice(0, MAX_VARIANTS_PER_WORD);
      memo.set(query, result);
      return result;
    },
  };
}

/** True when the folded text contains the word, or (from four letters) its stem. */
export function textHasWordOrFamily(foldedText: string, word: string): "exact" | "family" | null {
  if (foldedText.includes(word)) return "exact";
  const stem = wordStem(word);
  if (stem.length >= MIN_STEM_LENGTH && stem !== word && foldedText.includes(stem)) return "family";
  return null;
}

/** Spellings SQLite's unicode61 tokenizer may have stored for a folded word ("pruefung" → "prufung"). */
export function umlautAlternates(foldedWord: string): string[] {
  const plain = foldedWord.replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u");
  return plain !== foldedWord ? [plain] : [];
}

/** Folded text plus, for each folded character, the index of the original character. */
export function foldWithMap(text: string): { folded: string; map: number[] } {
  const chars: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] ?? "";
    const folded = char.charCodeAt(0) < 128 ? char.toLowerCase() : foldText(char);
    for (const piece of folded) {
      chars.push(piece);
      map.push(i);
    }
  }
  return { folded: chars.join(""), map };
}

/**
 * Query weights plus the indexed words related to each query word.
 * `variantOf` maps every added word back to the query word it stands for.
 */
export function addWordVariants(
  weights: Map<string, number>,
  index: TermIndex,
): { matchWeights: Map<string, number>; variantOf: Map<string, string> } {
  const matchWeights = new Map(weights);
  const variantOf = new Map<string, string>();
  for (const [word, weight] of weights) {
    for (const variant of index.variantsFor(word)) {
      if (weights.has(variant.term)) continue;
      const variantWeight = weight * variant.factor;
      if ((matchWeights.get(variant.term) ?? 0) >= variantWeight) continue;
      matchWeights.set(variant.term, variantWeight);
      variantOf.set(variant.term, word);
    }
  }
  return { matchWeights, variantOf };
}
