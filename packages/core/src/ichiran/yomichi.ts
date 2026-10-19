/** Projects Ichiran analysis results onto Yomichi's Analysis format:
 * UTF-16 offsets into the original input, every character of which is
 * covered by a token, and candidates as top combinations of chunk paths.
 * Scores are Ichiran path scores, not probabilities. */
import { basicSplit, normalizeWithMap } from "./chars.js";
import { bundle, dictSegment, getConjData, type WordInfo } from "./dict.js";
import { conjInfoJson, getSensesJson, romanizeWordInfo, wordInfoReading, type Json } from "./output.js";
import { getSuffixDescription } from "./grammar.js";
import { METHODS, type RomanizationMethod } from "./romanize.js";
import { stripHints } from "./split.js";
import type { Candidate, Lexeme, Sense, Token } from "../types.js";
import type { RomanizationScheme } from "../kana.js";

/** Yomichi romanization names to Ichiran methods ("hepburn" is Ichiran's default). */
export function ichiranMethod(scheme: RomanizationScheme | undefined): RomanizationMethod {
  switch (scheme) {
    case undefined:
    case "hepburn":
    case "hepburn-traditional":
      return METHODS["hepburn-traditional"];
    case "kunrei":
    case "kunrei-shiki":
      return METHODS["kunrei-siki"];
    default:
      return METHODS[scheme];
  }
}

export interface ProjectOptions {
  limit: number;
  method: RomanizationMethod;
  includeGlosses: boolean;
  includeConjugation: boolean;
  /** Original UTF-16 offsets at which word runs are additionally split. */
  hints?: number[];
}

type JsObj = { [k: string]: Json };

/** Must run inside runSync: reads dictionary rows from the active store. */
export function projectAnalysis(input: string, o: ProjectOptions): Candidate[] {
  const norm = normalizeWithMap(input);
  const orig = (a: number, b: number): [number, number] => [norm.source[a][0], norm.source[b - 1][1]];
  const hintSet = new Set(o.hints ?? []);
  // each chunk: alternative token lists with their scores
  const chunks: { tokens: Token[]; score: number }[][] = [];
  for (const seg of basicSplit(norm.text)) {
    if (seg.type === "misc") {
      const [s, e] = orig(seg.start, seg.end);
      chunks.push([{ tokens: [plainToken(input, s, e)], score: 0 }]);
      continue;
    }
    for (const [a, b] of splitAtHints(seg.start, seg.end, (i) => hintSet.has(norm.source[i][0]))) {
      const text = norm.text.slice(a, b);
      const paths = dictSegment(text, o.limit);
      if (!paths.length) {
        const [s, e] = orig(a, b);
        chunks.push([{ tokens: [plainToken(input, s, e, "unknown")], score: 0 }]);
        continue;
      }
      // Ichiran paths may differ only in hidden scoring details; keep the
      // best-scored path for each visible segmentation
      const seen = new Set<string>();
      const alts: { tokens: Token[]; score: number }[] = [];
      for (const [words, score] of paths) {
        const tokens = words.map((wi) => wordToken(input, wi, a + (wi.start ?? 0), a + (wi.end ?? text.length), orig, o));
        const key = JSON.stringify(tokens.map(signature));
        if (seen.has(key)) continue;
        seen.add(key);
        alts.push({ tokens, score });
      }
      chunks.push(alts);
    }
  }
  // beam over chunk alternatives, keeping the `limit` best total scores
  let beam: { picks: number[]; score: number }[] = [{ picks: [], score: 0 }];
  for (const alts of chunks) {
    const next: { picks: number[]; score: number }[] = [];
    for (const b of beam)
      alts.forEach((alt, i) => next.push({ picks: [...b.picks, i], score: b.score + alt.score }));
    next.sort((x, y) => y.score - x.score);
    beam = next.slice(0, o.limit);
  }
  return beam.map((b) => ({
    score: b.score,
    tokens: b.picks.flatMap((p, i) => chunks[i][p].tokens),
  }));
}

function signature(t: Token): unknown {
  return [t.start, t.end, t.entryId, t.reading, t.lemma, t.conjugationSteps, t.components.map(signature)];
}

function splitAtHints(start: number, end: number, isHint: (i: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  let last = start;
  for (let i = start + 1; i < end; i++)
    if (isHint(i)) {
      out.push([last, i]);
      last = i;
    }
  out.push([last, end]);
  return out;
}

function plainToken(input: string, start: number, end: number, kind?: Token["kind"]): Token {
  const surface = input.slice(start, end);
  return {
    surface,
    start,
    end,
    kind: kind ?? (/^[\s\p{P}\p{S}]*$/u.test(surface) ? "separator" : "unknown"),
    lemma: null,
    reading: null,
    romanization: null,
    entryId: null,
    pos: [],
    senses: [],
    senseIndices: [],
    conjugationSteps: [],
    components: [],
    alternatives: [],
  };
}

/** Ichiran joins the kana of compound parts with spaces; a token reading is
 * the continuous kana of its surface. */
function firstKana(kana: string | string[]): string {
  return stripHints(Array.isArray(kana) ? (kana[0] ?? "") : kana).replaceAll(" ", "");
}

/** Every sense of an entry in Yomichi's format (sense order, all languages as "en"). */
export function entrySenses(seq: number): Sense[] {
  const b = bundle(seq);
  if (!b) return [];
  return [...b.senses]
    .sort((x, y) => x.ord - y.ord)
    .map((s) => {
      const props = b.props.filter((p) => p.senseId === s.id).sort((x, y) => x.ord - y.ord || x.id - y.id);
      const tagged = (tag: string) => props.filter((p) => p.tag === tag).map((p) => p.text);
      return {
        pos: tagged("pos"),
        glosses: (b.glosses ?? [])
          .filter((g) => g.senseId === s.id)
          .sort((x, y) => x.ord - y.ord)
          .map((g) => ({ language: "en", text: g.text })),
        restrictions: tagged("stagk"),
        readingRestrictions: tagged("stagr"),
      };
    });
}

interface WordFacts {
  lemma: string;
  entryId: string | null;
  pos: string[];
  senses: Sense[];
  senseIndices: number[];
  steps: string[];
}

function stepName(p: JsObj): string {
  return `${p.type}${p.neg === true ? ", negative" : ""}${p.fml === true ? ", formal" : ""}`;
}

/** Root entry, lemma, senses and conjugation steps of a simple word. */
function wordFacts(wi: WordInfo, o: ProjectOptions): WordFacts {
  const seq = typeof wi.seq === "number" ? wi.seq : null;
  const facts: WordFacts = { lemma: wi.text, entryId: seq === null ? null : String(seq), pos: [], senses: [], senseIndices: [], steps: [] };
  if (seq === null) return facts;
  let root = seq;
  let posList: string[] | undefined;
  if (!wi.counter && wi.conjugations !== "root") {
    const cij = conjInfoJson(seq, wi.conjugations, wi.trueText) as JsObj[];
    let item: JsObj | undefined = cij[0];
    const chain: JsObj[] = [];
    while (item) {
      chain.unshift(item);
      item = Array.isArray(item.via) ? (item.via[0] as JsObj) : undefined;
    }
    if (chain.length) {
      for (const c of chain) {
        const names = [...new Set((c.prop as JsObj[]).map(stepName))];
        facts.steps.push(...names);
      }
      const inner = chain[0];
      const reading = typeof inner.reading === "string" ? inner.reading : "";
      facts.lemma = reading.split(" 【")[0] || wi.text;
      posList = (inner.prop as JsObj[]).map((p) => p.pos as string);
      const froms = [...new Set(getConjData(seq, wi.conjugations, wi.trueText).map((cd) => cd.from))];
      root =
        froms.find((f) => bundle(f)?.readings.some((r) => r.text === facts.lemma)) ?? froms[0] ?? seq;
    }
  }
  facts.entryId = String(root);
  if (wi.counter) posList = ["ctr"];
  const indices: number[] = [];
  getSensesJson(root, { posList, readingGetter: () => (root === seq ? wordInfoReading(wi) : null), indices });
  const senses = entrySenses(root);
  facts.senses = senses;
  facts.senseIndices = indices;
  facts.pos = [...new Set(indices.flatMap((i) => senses[i]?.pos ?? []))];
  if (!facts.pos.length) facts.pos = [...new Set(senses.flatMap((s) => s.pos))];
  return facts;
}

type OrigSpan = (a: number, b: number) => [number, number];
/** `a`/`b` are offsets in the normalized input; tokens use original offsets. */
function wordToken(input: string, wi: WordInfo, a: number, b: number, orig: OrigSpan, o: ProjectOptions): Token {
  const [start, end] = orig(a, b);
  if (wi.type === "gap") return plainToken(input, start, end, "unknown");
  const tok = plainToken(input, start, end, "word");
  tok.reading = firstKana(wi.kana);
  tok.romanization = romanizeWordInfo(wi, o.method);
  if (wi.alternative) {
    const alts = wi.components.map((c) => ({ wi: c, facts: wordFacts(c, o) }));
    Object.assign(tok, tokenFacts(alts[0].facts, o));
    tok.alternatives = alts.map(({ wi: c, facts }) => lexeme(c, facts, o));
    return tok;
  }
  if (wi.components.length) {
    // compound: parts in order; the primary part carries the meaning
    let pos = a;
    tok.components = wi.components.map((c) => {
      // component texts concatenate to the compound text; clamp defensively
      const s = Math.min(b - 1, pos);
      const e = Math.max(s + 1, Math.min(b, pos + c.text.length));
      pos += c.text.length;
      const part = wordToken(input, c, s, e, orig, o);
      // a suffix part is described by its grammatical role, as in Ichiran
      const desc = !c.primary && typeof c.seq === "number" ? getSuffixDescription(c.seq) : undefined;
      if (desc && o.includeConjugation) part.conjugationSteps = [desc, ...part.conjugationSteps];
      return part;
    });
    const primary = tok.components[wi.components.findIndex((c) => c.primary)] ?? tok.components[0];
    tok.lemma = primary.lemma;
    tok.entryId = primary.entryId;
    tok.pos = primary.pos;
    tok.senses = primary.senses;
    tok.senseIndices = primary.senseIndices;
    if (o.includeConjugation) tok.conjugationSteps = tok.components.flatMap((c) => c.conjugationSteps);
    return tok;
  }
  Object.assign(tok, tokenFacts(wordFacts(wi, o), o));
  return tok;
}

function tokenFacts(f: WordFacts, o: ProjectOptions): Partial<Token> {
  return {
    lemma: f.lemma,
    entryId: f.entryId,
    pos: f.pos,
    // like the legacy engine: the senses Ichiran shows, indices into the entry
    senses: o.includeGlosses ? f.senseIndices.map((i) => f.senses[i]).filter(Boolean) : [],
    senseIndices: o.includeGlosses ? f.senseIndices : [],
    conjugationSteps: o.includeConjugation ? f.steps : [],
  };
}

function lexeme(wi: WordInfo, f: WordFacts, o: ProjectOptions): Lexeme {
  return {
    surface: wi.text,
    reading: firstKana(wi.kana),
    entryId: f.entryId ?? "",
    lemma: f.lemma,
    pos: f.pos,
    priority: wi.score,
    senseIndices: o.includeGlosses ? f.senseIndices : [],
    conjugationSteps: o.includeConjugation ? f.steps : [],
    cost: 0,
  };
}
