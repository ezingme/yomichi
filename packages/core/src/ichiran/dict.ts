/** Port of the scoring and segmentation core of Ichiran dict.lisp
 * (Timofei Shatrov, MIT): word objects, conjugation data, calc-score,
 * join-substring-words and find-best-path. Function names follow upstream so
 * that behaviour can be audited line by line against the Lisp source. */
import {
  countCharClass,
  consecutiveCharGroups,
  findStickyPositions,
  getCharClass,
  kanjiCrossMatch,
  kanjiMatch,
  kanjiRegex,
  moraLength,
  sequentialKanjiPositions,
  testWord,
  asHiragana,
} from "./chars.js";
import { S, bind } from "./state.js";
import type {
  ConjPropRow,
  ReadingRow,
  ReadingTable,
  SeqBundle,
  SensePropRow,
} from "./store.js";
import {
  COPULAE,
  FINAL_PRT,
  FORCE_KANJI_BREAK,
  NO_KANJI_BREAK,
  NO_KANJI_BREAK_PENALTY,
  NON_FINAL_PRT,
  SEMI_FINAL_PRT,
  SKIP_WORDS,
  WEAK_CONJ_FORMS,
  skipByConjData,
  testConjProp,
} from "./errata.js";
import {
  findWordSuffix,
  getSuffixes,
  getSuffixMap,
  applySegfilters,
  getPenalties,
  getSynergies,
  type Synergy,
} from "./grammar.js";
import { getSplit, getSegsplit, getHint } from "./split.js";
import {
  findCounter,
  counterGetKana,
  counterGetKanji,
  counterText,
  valueString,
  type CounterText,
} from "./counters.js";

// ---------------------------------------------------------------------------
// Words

export type Conjugations = null | "root" | number[];
export interface SimpleText {
  kind: "simple";
  row: ReadingRow;
  conjugations: Conjugations;
  hintedp: boolean;
}
export interface ProxyText {
  kind: "proxy";
  text: string;
  kana: string;
  source: SimpleLike;
  hintedp: boolean;
}
export type SimpleLike = SimpleText | ProxyText;
export type ScoreMod = number | ((score: number) => number) | ScoreMod[];
export interface CompoundText {
  kind: "compound";
  text: string;
  kana: string;
  primary: SimpleLike;
  words: SimpleLike[];
  scoreBase: SimpleLike | null;
  scoreMod: ScoreMod;
}
export type Word = SimpleLike | CompoundText | CounterText;

export function makeWord(row: ReadingRow): SimpleText {
  return { kind: "simple", row, conjugations: null, hintedp: false };
}
export function makeProxy(
  source: SimpleLike,
  text: string,
  kana: string,
  hintedp = false,
): ProxyText {
  return { kind: "proxy", source, text, kana, hintedp };
}
export const isSimple = (w: Word): w is SimpleLike =>
  w.kind === "simple" || w.kind === "proxy";

export function seqOf(w: Word): number | null {
  switch (w.kind) {
    case "simple":
      return w.row.seq;
    case "proxy":
      return seqOf(w.source);
    case "counter":
      return w.source ? seqOf(w.source) : null;
    case "compound":
      throw new Error("compound seq is a list; use seqList");
  }
}
export function seqList(w: Word): number[] | number | null {
  return w.kind === "compound" ? w.words.map((x) => seqOf(x)!) : seqOf(w);
}
export function textOf(w: Word): string {
  switch (w.kind) {
    case "simple":
      return w.row.text;
    case "proxy":
    case "compound":
      return w.text;
    case "counter":
      return counterText(w);
  }
}
export function trueText(w: Word): string {
  return w.kind === "proxy" ? trueText(w.source) : textOf(w);
}
export function wordType(w: Word): ReadingTable {
  switch (w.kind) {
    case "simple":
      return w.row.table;
    case "proxy":
      return wordType(w.source);
    case "compound":
      return wordType(w.primary);
    case "counter":
      return countCharClass(counterText(w), "kanji-char") > 0 ? "kanji" : "kana";
  }
}
/** common slot: number, or null for :null. Counter-specific semantics kept. */
export function commonOf(w: Word): number | null {
  switch (w.kind) {
    case "simple":
      return w.row.common;
    case "proxy":
      return commonOf(w.source);
    case "compound":
      return commonOf(w.primary);
    case "counter":
      if (w.common !== undefined) return w.common;
      return w.source ? commonOf(w.source) : 0;
  }
}
export function ordOf(w: Word): number {
  switch (w.kind) {
    case "simple":
      return w.row.ord;
    case "proxy":
      return ordOf(w.source);
    case "compound":
      return ordOf(w.primary);
    case "counter":
      return w.source ? ordOf(w.source) : 0;
  }
}
export function nokanjiOf(w: Word): boolean {
  switch (w.kind) {
    case "simple":
      return w.row.nokanji;
    case "proxy":
      return nokanjiOf(w.source);
    case "counter":
      return !!w.source && nokanjiOf(w.source);
    case "compound":
      return nokanjiOf(w.primary);
  }
}
export function wordConjugations(w: Word): Conjugations {
  switch (w.kind) {
    case "simple":
      return w.conjugations;
    case "proxy":
      return wordConjugations(w.source);
    case "compound":
      return wordConjugations(w.words.at(-1)!);
    case "counter":
      return null;
  }
}
export function setWordConjugations(w: Word, value: Conjugations): void {
  switch (w.kind) {
    case "simple":
      w.conjugations = value;
      return;
    case "proxy":
      setWordConjugations(w.source, value);
      return;
    case "compound":
      setWordConjugations(w.words.at(-1)!, value);
      return;
    case "counter":
      return;
  }
}

// ---------------------------------------------------------------------------
// Data access helpers

export function bundle(seq: number): SeqBundle | null {
  return S().store.bundle(seq);
}
export function entryRootP(seq: number): boolean {
  return bundle(seq)?.entry.rootP ?? false;
}
function readingsOf(seq: number, table: ReadingTable): ReadingRow[] {
  return (bundle(seq)?.readings ?? []).filter((r) => r.table === table);
}
export function readingsByOrd(seq: number, table: ReadingTable): ReadingRow[] {
  return [...readingsOf(seq, table)].sort((a, b) => a.ord - b.ord);
}
export function findReading(
  seq: number,
  table: ReadingTable,
  text: string,
): ReadingRow[] {
  return readingsOf(seq, table).filter((r) => r.text === text);
}
export function tableFor(text: string): ReadingTable {
  return testWord(text, "kana") ? "kana" : "kanji";
}
/** find-word-seq: readings with this text belonging to one of `seqs`. */
export function findWordSeq(word: string, ...seqs: number[]): SimpleText[] {
  return S()
    .store.byText(word)
    .filter((r) => seqs.includes(r.seq))
    .map(makeWord);
}
/** find-word-conj-of: as above, plus conjugated forms of `seqs`. */
export function findWordConjOf(word: string, ...seqs: number[]): SimpleText[] {
  const rows = S().store.byText(word);
  const direct = rows.filter((r) => seqs.includes(r.seq));
  const conj = rows.filter((r) => {
    const b = bundle(r.seq);
    return !!b && b.conjugations.some((c) => seqs.includes(c.from));
  });
  const seen = new Set<number>();
  const out: SimpleText[] = [];
  // union ... :key #'id (order: first list, then new rows of the second)
  for (const r of [...direct, ...conj])
    if (!seen.has(r.id)) {
      seen.add(r.id);
      out.push(makeWord(r));
    }
  return out;
}
export function findWordWithPos(word: string, ...posi: string[]): SimpleText[] {
  return S()
    .store.byText(word)
    .filter((r) =>
      (bundle(r.seq)?.props ?? []).some(
        (p) => p.tag === "pos" && posi.includes(p.text),
      ),
    )
    .map(makeWord);
}
export function sensePropsOf(seq: number): SensePropRow[] {
  return bundle(seq)?.props ?? [];
}

const ARCH = new Set(["arch", "obsc", "rare"]);
function archSenseIds(b: SeqBundle): Set<number> {
  return new Set(
    b.props
      .filter((p) => p.tag === "misc" && ARCH.has(p.text))
      .map((p) => p.senseId),
  );
}
function isArchRoot(seq: number): boolean {
  const b = bundle(seq);
  if (!b || !b.senses.length) return false;
  const arch = archSenseIds(b);
  return b.senses.every((s) => arch.has(s.id));
}
export function isArch(seq: number): boolean {
  if (isArchRoot(seq)) return true;
  const b = bundle(seq);
  return !!b && b.conjugations.some((c) => isArchRoot(c.from));
}
export function getNonArchPosi(seqSet: (number | null)[]): string[] {
  const out: string[] = [];
  for (const seq of seqSet) {
    if (seq === null) continue;
    const b = bundle(seq);
    if (!b) continue;
    const arch = archSenseIds(b);
    for (const p of b.props)
      if (p.tag === "pos" && !arch.has(p.senseId) && !out.includes(p.text))
        out.push(p.text);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Conjugation data

export interface ConjData {
  seq: number;
  from: number;
  via: number | null;
  prop: ConjPropRow;
  srcMap: [string, string][];
}

export function noConjData(seq: number): boolean {
  const b = bundle(seq);
  return !b || b.conjugations.length === 0;
}

export function getConjData(
  seq: number,
  fromOrConjIds: Conjugations | number = null,
  texts: string | string[] | null = null,
): ConjData[] {
  if (fromOrConjIds === "root" || noConjData(seq)) return [];
  const b = bundle(seq)!;
  const textList = texts === null ? null : Array.isArray(texts) ? texts : [texts];
  let conjs = b.conjugations;
  if (Array.isArray(fromOrConjIds))
    conjs = conjs.filter((c) => fromOrConjIds.includes(c.id));
  else if (typeof fromOrConjIds === "number")
    conjs = conjs.filter((c) => c.from === fromOrConjIds);
  const out: ConjData[] = [];
  for (const conj of conjs) {
    const srcMap = b.conjSources
      .filter(
        (s) => s.conjId === conj.id && (!textList || textList.includes(s.text)),
      )
      .map((s) => [s.text, s.sourceText] as [string, string]);
    if (textList && textList.length && !srcMap.length) continue;
    for (const prop of b.conjProps.filter((p) => p.conjId === conj.id))
      out.push({ seq: conj.seq, from: conj.from, via: conj.via, prop, srcMap });
  }
  return out;
}

function getOriginalTextStar(
  conjDatas: ConjData[],
  texts: string[],
): [string, number][] {
  const out: [string, number][] = [];
  for (const cd of conjDatas) {
    const src: string[] = [];
    for (const [txt, srcTxt] of cd.srcMap) if (texts.includes(txt)) src.push(srcTxt);
    if (cd.via === null) for (const t of src) out.push([t, cd.from]);
    else out.push(...getOriginalTextStar(getConjData(cd.via, cd.from), src));
  }
  return out;
}

export function getOriginalText(
  reading: SimpleLike,
  conjData?: ConjData[],
): SimpleText[] {
  if (reading.kind === "proxy")
    return getOriginalText(reading.source, conjData);
  const orig = getOriginalTextStar(conjData ?? wordConjData(reading), [
    textOf(reading),
  ]);
  const table = wordType(reading);
  return orig.flatMap(([txt, seq]) => findReading(seq, table, txt).map(makeWord));
}

export function wordConjData(w: Word): ConjData[] {
  switch (w.kind) {
    case "simple":
    case "proxy":
      return getConjData(seqOf(w)!, wordConjugations(w), trueText(w));
    case "compound":
      return wordConjData(w.words.at(-1)!);
    case "counter":
      return [];
  }
}

function queryParents(seq: number, text: string, table: ReadingTable) {
  const b = bundle(seq);
  if (!b) return [];
  const out: [ReadingRow, number][] = [];
  for (const conj of b.conjugations)
    for (const csr of b.conjSources)
      if (csr.conjId === conj.id && csr.text === text) {
        const parentSeq = conj.via ?? conj.from;
        for (const kt of findReading(parentSeq, table, csr.sourceText))
          out.push([kt, conj.id]);
      }
  return out;
}
function sourceReadingsFor(seq: number, conjId: number, sourceText: string): string[] {
  const b = bundle(seq);
  if (!b) return [];
  return b.conjSources
    .filter((s) => s.conjId === conjId && s.sourceText === sourceText)
    .map((s) => s.text);
}

export function bestKanaConj(obj: SimpleText): string | null {
  const wc = obj.conjugations;
  if ((!wc || wc === "root") && obj.row.best !== null) return obj.row.best;
  for (const [parent, cid] of queryParents(obj.row.seq, obj.row.text, "kanji")) {
    const parentBk = bestKanaConj(makeWord(parent));
    if (parentBk === null || (wc && (wc === "root" || !wc.includes(cid)))) continue;
    const readings = sourceReadingsFor(obj.row.seq, cid, parentBk);
    if (!readings.length) continue;
    if (readings.length === 1) return readings[0];
    const km = kanjiCrossMatch(parent.text, parentBk, obj.row.text);
    if (km !== null && readings.includes(km)) return km;
    const lenKm = km?.length ?? 0;
    const sorted = [...readings].sort(
      (a, b) => Math.abs(a.length - lenKm) - Math.abs(b.length - lenKm),
    );
    const re = kanjiRegex(obj.row.text);
    return sorted.find((r) => re.test(r)) ?? readings[0];
  }
  return null;
}
export function bestKanjiConj(obj: SimpleText): string | null {
  const wc = obj.conjugations;
  if ((!wc || wc === "root") && obj.row.best !== null) return obj.row.best;
  if (obj.row.nokanji || (bundle(obj.row.seq)?.entry.nKanji ?? 0) === 0)
    return null;
  for (const [parent, cid] of queryParents(obj.row.seq, obj.row.text, "kana")) {
    const parentBk = bestKanjiConj(makeWord(parent));
    if (parentBk === null || (wc && (wc === "root" || !wc.includes(cid)))) continue;
    const readings = sourceReadingsFor(obj.row.seq, cid, parentBk);
    const match = readings.find((r) => kanjiMatch(r, obj.row.text));
    if (match) return match;
  }
  return null;
}
function getKanjiKanaOld(obj: SimpleText): string {
  const re = kanjiRegex(obj.row.text);
  const kts = readingsByOrd(obj.row.seq, "kana");
  return (kts.find((k) => re.test(k.text)) ?? kts[0])?.text ?? "";
}

export function getKana(w: Word): string {
  if (isSimple(w) && !S().disableHints && !w.hintedp) {
    const hint = bind({ disableHints: true }, () => getHint(w));
    if (hint) return hint;
  }
  switch (w.kind) {
    case "simple":
      if (w.row.table === "kana") return w.row.text;
      return bestKanaConj(w) ?? getKanjiKanaOld(w);
    case "proxy":
    case "compound":
      return w.kana;
    case "counter":
      return counterGetKana(w);
  }
}
export function getKanji(w: Word): string | null {
  switch (w.kind) {
    case "simple":
      return w.row.table === "kanji" ? w.row.text : bestKanjiConj(w);
    case "proxy":
      return getKanji(w.source);
    case "compound":
      return null;
    case "counter":
      return counterGetKanji(w);
  }
}
export function trueKana(w: Word): string {
  return w.kind === "proxy" ? trueKana(w.source) : getKana(w);
}
export function trueKanji(w: Word): string | null {
  return w.kind === "proxy" ? trueKanji(w.source) : getKanji(w);
}

// ---------------------------------------------------------------------------
// Compounds

export function adjoinWord(
  word1: SimpleLike | CompoundText,
  word2: SimpleLike,
  opts: {
    text?: string;
    kana?: string;
    scoreMod?: ScoreMod;
    scoreBase?: SimpleLike | null;
  } = {},
): CompoundText {
  const text = opts.text ?? textOf(word1) + textOf(word2);
  const kana = opts.kana ?? getKana(word1) + getKana(word2);
  const scoreMod = opts.scoreMod ?? 0;
  if (word1.kind === "compound") {
    word1.text = text;
    word1.kana = kana;
    word1.words = [...word1.words, word2];
    word1.scoreMod = Array.isArray(word1.scoreMod)
      ? [scoreMod, ...word1.scoreMod]
      : [scoreMod, word1.scoreMod];
    return word1;
  }
  return {
    kind: "compound",
    text,
    kana,
    primary: word1,
    words: [word1, word2],
    scoreBase: opts.scoreBase ?? null,
    scoreMod,
  };
}

// ---------------------------------------------------------------------------
// Scoring

export interface Segment {
  start: number;
  end: number;
  word: Word;
  score: number | null;
  info: Info | null;
  text: string | null;
}
export interface Info {
  posi: string[];
  seqSet: (number | null)[];
  conj: ConjData[];
  common: number | null;
  scoreInfo: unknown[];
  kpcl: [boolean, boolean, boolean, boolean];
}
export function segmentText(s: Segment): string {
  return (s.text ??= textOf(s.word));
}

const LENGTH_COEFFS: Record<string, number[]> = {
  strong: [1, 8, 24, 40, 60],
  weak: [1, 4, 9, 16, 25, 36],
  tail: [4, 9, 16, 24],
  ltail: [4, 12, 18, 24],
};
export function lengthMultiplierCoeff(length: number, cls: keyof typeof LENGTH_COEFFS): number {
  const c = LENGTH_COEFFS[cls];
  if (length > 0 && length <= c.length) return c[length - 1];
  return length * Math.floor(c[c.length - 1] / c.length);
}

export function applyScoreMod(mod: ScoreMod, score: number, len: number): number {
  if (typeof mod === "number") return score * mod * len;
  if (typeof mod === "function") return mod(score);
  return mod.reduce((acc: number, m) => acc + applyScoreMod(m, score, len), 0);
}

export const SCORE_CUTOFF = 5;

function kanjiBreakPenalty(
  kanjiBreak: number[],
  score: number,
  info: Info | null,
  text: string,
  useLength: number | null,
  scoreMod: ScoreMod,
): number {
  const end = kanjiBreak.length > 1 ? "both" : kanjiBreak[0] === 0 ? "beg" : "end";
  let bonus = 0;
  const posi = info?.posi ?? [];
  if (info) {
    if (
      info.seqSet.some((s) => s !== null && NO_KANJI_BREAK_PENALTY.has(s)) ||
      (end === "beg" && text.startsWith("す"))
    )
      return score;
    if (posi.includes("vs-s") || posi.includes("v5s")) {
      const suru = getSuffixes(text).find((s) => s[1] === "suru");
      if (suru) {
        const offset = moraLength(text) - moraLength(suru[0]);
        const suffixScore = calcScore(suru[2]!, {
          useLength: useLength !== null ? useLength - offset : null,
          scoreMod,
        })[0];
        return Math.min(score, suffixScore + 50);
      }
    } else if (end === "beg" && posi.includes("num")) bonus += 5;
    else if (end === "beg" && (posi.includes("suf") || posi.includes("n-suf")))
      bonus += 10;
    else if (end === "end" && posi.includes("pref")) bonus += 12;
  }
  if (score >= SCORE_CUTOFF)
    return Math.max(SCORE_CUTOFF, Math.ceil(score / 2) + bonus);
  return score;
}

/** compare-common: is c1 "better" than c2 (sort predicate). */
export function compareCommon(c1: number | null, c2: number | null): boolean {
  if (c2 === null) return c1 !== null;
  if (c2 === 0) return c1 !== null && c1 > 0;
  if (c1 !== null && c1 > 0) return c1 < c2;
  return false;
}
export function stableSort<T>(arr: T[], less: (a: T, b: T) => boolean): T[] {
  return arr
    .map((v, i) => [v, i] as const)
    .sort((a, b) => (less(a[0], b[0]) ? -1 : less(b[0], a[0]) ? 1 : a[1] - b[1]))
    .map(([v]) => v);
}

export interface ScoreOptions {
  final?: boolean;
  useLength?: number | null;
  scoreMod?: ScoreMod;
  kanjiBreak?: number[] | null;
}

export function calcScore(reading: Word, opts: ScoreOptions = {}): [number, Info | null] {
  const final = !!opts.final;
  const useLength = opts.useLength ?? null;
  const scoreMod = opts.scoreMod ?? 0;
  const kanjiBreak = opts.kanjiBreak && opts.kanjiBreak.length ? opts.kanjiBreak : null;
  if (reading.kind === "compound") {
    const base = reading.scoreBase ?? reading.primary;
    const ul = moraLength(reading.text);
    let [score, info] = calcScore(base, { useLength: ul, scoreMod: reading.scoreMod });
    if (info) info.conj = wordConjData(reading);
    else info = null;
    if (kanjiBreak)
      score = kanjiBreakPenalty(kanjiBreak, score, info, textOf(base), ul, reading.scoreMod);
    return [score, info];
  }
  const ctrMode = reading.kind === "counter";

  let score = 1,
    propScore = 0;
  const kanjiP = wordType(reading) === "kanji";
  const katakanaP = !kanjiP && countCharClass(trueText(reading), "katakana-uniq") > 0;
  const text = textOf(reading);
  const nKanji = countCharClass(text, "kanji");
  const len = Math.max(1, moraLength(text));
  const seq = seqOf(reading);
  let ord = ordOf(reading);
  const entry = seq !== null ? (bundle(seq)?.entry ?? null) : null;
  const wc = wordConjugations(reading);
  const conjOnly = !!wc && wc !== "root";
  const rootP = ctrMode || (!conjOnly && !!entry?.rootP);
  let conjData = wordConjData(reading);
  let secondaryConjP = false;
  if (conjData.length) {
    if (conjData.every((c) => c.via !== null)) secondaryConjP = true;
    else conjData = conjData.filter((c) => c.via === null);
  }
  const conjOf = conjData.map((c) => c.from);
  const conjProps = conjData.map((c) => c.prop);
  const conjTypes = conjProps.map((p) => p.conjType);
  const conjTypesP =
    rootP ||
    useLength !== null ||
    (conjProps.length > 0 && !conjProps.every((p) => testConjProp(p, WEAK_CONJ_FORMS)));
  const seqSet: number[] = seq !== null ? [seq, ...conjOf] : [];
  const spSeqSet = seq !== null && rootP && useLength === null ? [seq] : seqSet;
  const preferKana: SensePropRow[] = [];
  for (const s of new Set(spSeqSet))
    for (const p of sensePropsOf(s))
      if (p.tag === "misc" && p.text === "uk") preferKana.push(p);
  const isArchP = spSeqSet.every((s) => isArch(s));
  const posi = ctrMode ? ["ctr"] : getNonArchPosi(seqSet);
  let common: number | null = conjOnly ? null : commonOf(reading);
  let commonOf_ = common;
  let commonP = common !== null;
  const particleP = posi.includes("prt");
  const semiFinalParticleP = seq !== null && SEMI_FINAL_PRT.has(seq);
  const nonFinalParticleP = seq !== null && NON_FINAL_PRT.has(seq);
  const pronounP = posi.includes("pn");
  const copDaP = seqSet.some((s) => COPULAE.has(s));
  const longThreshold =
    kanjiP &&
    !preferKana.length &&
    ((rootP && !conjData.length) || (useLength !== null && conjTypes.includes(13)))
      ? 2
      : commonP && common! > 0 && common! < 10
        ? 2
        : (conjTypes.includes(3) || conjTypes.includes(9)) && useLength === null
          ? 4
          : 3;
  const longP = len > longThreshold;
  const noCommonBonus =
    particleP || !conjTypesP || (!longP && posi.length === 1 && posi[0] === "int");
  let primaryP = false;
  let useLengthBonus = 0;
  let splitInfo: unknown = null;

  if (
    seqSet.some((s) => SKIP_WORDS.has(s)) ||
    (!final && seq !== null && FINAL_PRT.has(seq)) ||
    (!rootP && skipByConjData(conjData))
  )
    return [0, null];

  if (conjData.length && !(ord === 0 && commonP)) {
    const conjOfData = getOriginalText(reading as SimpleLike, conjData).map(
      (ot) => [commonOf(ot), ordOf(ot)] as const,
    );
    if (conjOfData.length) {
      if (!commonP) {
        const conjOfCommon = conjOfData
          .map(([c]) => c)
          .filter((c): c is number => c !== null);
        if (conjOfCommon.length) {
          common = 0;
          commonP = true;
          commonOf_ = stableSort(conjOfCommon, compareCommon)[0];
        }
      }
      const conjOfOrd = Math.min(...conjOfData.map(([, o]) => o));
      if (conjOfOrd < ord) ord = conjOfOrd;
    }
  }

  if (!isArchP) {
    primaryP =
      !entry ||
      (preferKana.length > 0 &&
        conjTypesP &&
        !kanjiP &&
        (!entry.primaryNokanji || nokanjiOf(reading))) ||
      ((ord === 0 || copDaP) &&
        (kanjiP || conjTypesP) &&
        ((kanjiP && !preferKana.length) ||
          (commonP && pronounP) ||
          entry.nKanji === 0)) ||
      (preferKana.length > 0 &&
        kanjiP &&
        ord === 0 &&
        !preferKana.some((p) => {
          const senses = bundle(p.seq)?.senses ?? [];
          return senses.some((s) => s.id === p.senseId && s.ord === 0);
        }));
  }

  if (primaryP)
    score += longP
      ? 10
      : secondaryConjP && !kanjiP
        ? 2
        : commonP && conjTypesP
          ? 5
          : preferKana.length || !entry || entry.nKanji === 0
            ? 3
            : 2;
  if (particleP && (final || !semiFinalParticleP)) {
    score += 2;
    if (commonP) score += 2 + len;
    if (final && !nonFinalParticleP) {
      if (primaryP) score += 5;
      else if (semiFinalParticleP) score += 2;
    }
  }
  if (commonP && !noCommonBonus) {
    let commonBonus: number;
    if (secondaryConjP && useLength === null) commonBonus = kanjiP && primaryP ? 4 : 2;
    else if (longP || copDaP || (rootP && (kanjiP || (primaryP && len > 2))))
      commonBonus =
        common === 0 ? 10 : !primaryP ? Math.max(15 - common!, 10) : Math.max(20 - common!, 10);
    else if (kanjiP) commonBonus = 8;
    else if (primaryP) commonBonus = 4;
    else if (len > 2 || (common! > 0 && common! < 10)) commonBonus = 3;
    else commonBonus = 2;
    if (commonBonus >= 10 && conjTypes.includes(10)) commonBonus -= 4;
    score += commonBonus;
  }
  if (longP) score = Math.max(len, score);
  if (kanjiP) {
    score = Math.max(isArchP ? 3 : 5, score);
    if (longP && (nKanji > 1 || len > 4)) score += 2;
  }
  if (ctrMode) score = Math.max(5, score);
  propScore = score;
  score =
    propScore *
    (lengthMultiplierCoeff(len, kanjiP || katakanaP ? "strong" : "weak") +
      (nKanji > 1 ? (nKanji - 1) * 5 : 0));

  if (useLength !== null) {
    useLengthBonus += propScore *
      lengthMultiplierCoeff(useLength - len, len > 3 && (kanjiP || katakanaP) ? "ltail" : "tail");
    useLengthBonus += applyScoreMod(scoreMod, propScore, useLength - len);
    score += useLengthBonus;
  }

  if (!ctrMode) {
    const split = getSplit(reading as SimpleLike, conjOf);
    if (split) {
      const [parts, scoreModSplit] = split;
      if (parts.includes("score")) {
        score += scoreModSplit;
        splitInfo = scoreModSplit;
      } else if (parts.includes("pscore")) {
        const newPropScore = Math.max(1, propScore + scoreModSplit);
        score = Math.ceil((score * newPropScore) / propScore);
        propScore = newPropScore;
      } else {
        const words = parts as SimpleLike[];
        let slen = 0,
          smlen = 0;
        const partScores: number[] = [];
        words.forEach((part, i) => {
          const last = i === words.length - 1;
          const ptext = textOf(part);
          const plen = ptext.length;
          slen += plen;
          const pmlen = moraLength(ptext);
          smlen += pmlen;
          const tpart: SimpleLike =
            last && slen > text.length
              ? makeProxy(part, ptext.slice(0, Math.max(1, plen + (text.length - slen))), "")
              : part;
          partScores.push(
            calcScore(tpart, {
              final: final && last,
              useLength: last && useLength !== null ? pmlen + (useLength - smlen) : null,
              scoreMod: last ? scoreMod : 0,
            })[0],
          );
        });
        splitInfo = [scoreModSplit, ...partScores];
        score = scoreModSplit + partScores.reduce((a, b) => a + b, 0);
      }
    }
  }

  const info: Info = {
    posi,
    seqSet: ctrMode ? seqSet : [seq, ...conjOf],
    conj: conjData,
    common: commonP ? commonOf_ : null,
    scoreInfo: [propScore, kanjiBreak, useLengthBonus, splitInfo],
    kpcl: [kanjiP || katakanaP, primaryP, commonP, longP],
  };
  if (kanjiBreak)
    score = kanjiBreakPenalty(kanjiBreak, score, info, text, useLength, scoreMod);
  return [score, info];
}

export function genScore(segment: Segment, final: boolean, kanjiBreak: number[] | null): Segment {
  [segment.score, segment.info] = calcScore(segment.word, { final, kanjiBreak });
  return segment;
}

// ---------------------------------------------------------------------------
// Word lookup

export const MAX_WORD_LENGTH = 50;

export function findWord(word: string, rootOnly = false): SimpleText[] {
  if (word.length > MAX_WORD_LENGTH) return [];
  const st = S();
  const hashed = st.substringHash?.get(word);
  if (hashed !== undefined && !rootOnly) return hashed.map(makeWord);
  const rows = st.store.byText(word);
  return (rootOnly ? rows.filter((r) => entryRootP(r.seq)) : rows).map(makeWord);
}

function findSubstringWords(str: string, sticky: Set<number>): Map<string, ReadingRow[]> {
  const hash = new Map<string, ReadingRow[]>();
  for (let start = 0; start < str.length; start++) {
    if (sticky.has(start)) continue;
    for (let end = start + 1; end <= Math.min(str.length, start + MAX_WORD_LENGTH); end++) {
      if (sticky.has(end)) continue;
      const part = str.slice(start, end);
      if (!hash.has(part)) hash.set(part, []);
    }
  }
  for (const key of hash.keys()) {
    // rows are pushed onto the hash bucket in query order, i.e. reversed
    hash.set(key, [...S().store.byText(key)].reverse());
  }
  return hash;
}

export function findWordAsHiragana(
  str: string,
  exclude: (number | null)[] = [],
  finder?: (s: string) => SimpleLike[],
): ProxyText[] {
  const hira = asHiragana(str);
  if (str === hira) return [];
  const words = finder ? finder(hira) : findWord(hira, true);
  return words
    .filter((w) => !exclude.includes(seqOf(w)))
    .map((w) => makeProxy(w, str, str));
}

export function findWordFull(
  word: string,
  opts: { asHiragana?: boolean; counter?: "auto" | number | null } = {},
): Word[] {
  const simple = findWord(word);
  const out: Word[] = [...simple];
  out.push(...findWordSuffix(word, simple));
  if (opts.asHiragana) out.push(...findWordAsHiragana(word, simple.map(seqOf)));
  if (opts.counter !== undefined && opts.counter !== null) {
    if (opts.counter === "auto") {
      const groups = consecutiveCharGroups("number", word);
      if (groups.length)
        out.push(...findCounter(word.slice(groups[0][0], groups[0][1]), word.slice(groups[0][1])));
    } else
      out.push(...findCounter(word.slice(0, opts.counter), word.slice(opts.counter), !simple.length));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Segment lists and path search

export interface SegmentList {
  kind: "segment-list";
  segments: Segment[];
  start: number;
  end: number;
  top: TopArray | null;
  matches: number;
}
export function getSegmentScore(seg: Segment | SegmentList | Synergy): number {
  if ("kind" in seg && seg.kind === "segment-list") return seg.segments[0]?.score ?? 0;
  if ("kind" in seg && seg.kind === "synergy") return seg.score;
  return (seg as Segment).score ?? 0;
}

export const IDENTICAL_WORD_SCORE_CUTOFF = 1 / 2;
function cullSegments(segments: Segment[]): Segment[] {
  if (!segments.length) return [];
  let segs = stableSort(segments, (a, b) => compareCommon(a.info?.common ?? null, b.info?.common ?? null));
  segs = stableSort(segs, (a, b) => a.score! > b.score!);
  const cutoff = segs[0].score! * IDENTICAL_WORD_SCORE_CUTOFF;
  const out: Segment[] = [];
  for (const s of segs) {
    if (s.score! < cutoff) break;
    out.push(s);
  }
  return out;
}

export function joinSubstringWordsStar(str: string): {
  result: [number, number, Segment[]][];
  kanjiBreak: number[];
} {
  const sticky = new Set(findStickyPositions(str));
  const substringHash = findSubstringWords(str, sticky);
  const katakanaGroups = consecutiveCharGroups("katakana", str);
  const numberGroups = consecutiveCharGroups("number", str);
  let kanjiBreak: number[] = [];
  const ends: number[] = [];
  const suffixMap = getSuffixMap(str);
  const result: [number, number, Segment[]][] = [];
  return bind({ substringHash }, () => {
    for (let start = 0; start < str.length; start++) {
      const katakanaGroupEnd = katakanaGroups.find((g) => g[0] === start)?.[1];
      const numberGroupEnd = numberGroups.find((g) => g[0] === start)?.[1];
      if (sticky.has(start)) continue;
      for (let end = start + 1; end <= Math.min(str.length, start + MAX_WORD_LENGTH); end++) {
        if (sticky.has(end)) continue;
        const part = str.slice(start, end);
        const words = bind({ suffixMapTemp: suffixMap, suffixNextEnd: end }, () =>
          findWordFull(part, {
            asHiragana: katakanaGroupEnd !== undefined && end === katakanaGroupEnd,
            counter:
              numberGroupEnd !== undefined && numberGroupEnd <= end && numberGroupEnd - start <= 20
                ? numberGroupEnd - start
                : null,
          }),
        );
        const segments: Segment[] = words.map((word) => ({
          start,
          end,
          word,
          score: null,
          info: null,
          text: null,
        }));
        if (segments.length) {
          if (start === 0 || ends.includes(start)) {
            let add: number[];
            if (FORCE_KANJI_BREAK.has(part))
              add = Array.from({ length: part.length - 1 }, (_, i) => start + 1 + i);
            else if (NO_KANJI_BREAK.has(part)) add = [];
            else add = sequentialKanjiPositions(part, start);
            kanjiBreak = [...add, ...kanjiBreak];
          }
          if (!ends.includes(end)) ends.unshift(end);
          result.push([start, end, segments]);
        }
      }
    }
    return { result, kanjiBreak: [...new Set(kanjiBreak)] };
  });
}

export function joinSubstringWords(str: string): SegmentList[] {
  const { result, kanjiBreak } = joinSubstringWordsStar(str);
  const endsWithLw = str.endsWith("ー");
  const out: SegmentList[] = [];
  for (const [start, end, segments] of result) {
    const kb = [start, end].filter((n) => kanjiBreak.includes(n)).map((n) => n - start);
    const sl: Segment[] = [];
    for (const segment of segments) {
      genScore(
        segment,
        segment.end === str.length || (endsWithLw && segment.end === str.length - 1),
        kb,
      );
      if (segment.score! >= SCORE_CUTOFF) sl.push(segment);
    }
    if (sl.length)
      out.push({
        kind: "segment-list",
        segments: cullSegments(sl),
        start,
        end,
        top: null,
        matches: segments.length,
      });
  }
  return out;
}

export type PathItem = SegmentList | Synergy;
interface TopItem {
  score: number;
  payload: PathItem[];
}
export class TopArray {
  array: (TopItem | null)[];
  count = 0;
  constructor(limit = 5) {
    this.array = new Array(limit).fill(null);
  }
  register(score: number, payload: PathItem[]): void {
    const item = { score, payload };
    const len = this.array.length;
    for (let idx = Math.min(this.count, len); idx >= 0; idx--) {
      const prev = idx > 0 ? this.array[idx - 1] : null;
      const done = !prev || prev.score >= score;
      if (idx < len) this.array[idx] = done ? item : prev;
      if (done) break;
    }
    this.count++;
  }
  items(): TopItem[] {
    return (this.count >= this.array.length
      ? this.array
      : this.array.slice(0, this.count)) as TopItem[];
  }
}

export const GAP_PENALTY = -500;
const gapPenalty = (start: number, end: number) => (end - start) * GAP_PENALTY;

function getSegInitial(seg: SegmentList): SegmentList[] {
  return applySegfilters(null, seg).map((split) => split[1]);
}
function getSegSplits(left: SegmentList, right: SegmentList): PathItem[][] {
  const out: PathItem[][] = [];
  for (const [l, r] of applySegfilters(left, right)) {
    out.push(getPenalties(l!, r));
    out.push(...getSynergies(l!, r));
  }
  return out;
}
function expandSegmentList(sl: SegmentList): void {
  const segs: Segment[] = [];
  for (const segment of sl.segments) {
    segs.push(segment);
    const segsplit = getSegsplit(segment);
    if (segsplit) {
      segs.push(segsplit);
      sl.matches++;
    }
  }
  sl.segments = stableSort(segs, (a, b) => a.score! > b.score!);
}

export function findBestPath(
  segmentLists: SegmentList[],
  strLength: number,
  limit = 5,
): [PathItem[], number][] {
  const top = new TopArray(limit);
  top.register(gapPenalty(0, strLength), []);
  for (const sl of segmentLists) {
    expandSegmentList(sl);
    sl.top = new TopArray(limit);
  }
  for (let i = 0; i < segmentLists.length; i++) {
    const seg1 = segmentLists[i];
    const gapLeft = gapPenalty(0, seg1.start);
    const gapRight = gapPenalty(seg1.end, strLength);
    for (const seg of getSegInitial(seg1)) {
      const score1 = getSegmentScore(seg);
      seg1.top!.register(gapLeft + score1, [seg]);
      top.register(gapLeft + score1 + gapRight, [seg]);
    }
    for (let j = i + 1; j < segmentLists.length; j++) {
      const seg2 = segmentLists[j];
      const score2 = getSegmentScore(seg2);
      if (seg2.start < seg1.end) continue;
      const gl = gapPenalty(seg1.end, seg2.start);
      const gr = gapPenalty(seg2.end, strLength);
      for (const tai of seg1.top!.items()) {
        const [segLeft, ...tail] = tai.payload;
        const score3 = getSegmentScore(segLeft);
        const scoreTail = tai.score - score3;
        for (const split of getSegSplits(segLeft as SegmentList, seg2)) {
          const accum =
            gl +
            Math.max(
              split.reduce((a, s) => a + getSegmentScore(s), 0),
              score3 + 1,
              score2 + 1,
            ) +
            scoreTail;
          const path = [...split, ...tail];
          seg2.top!.register(accum, path);
          top.register(accum + gr, path);
        }
      }
    }
  }
  for (const sl of segmentLists) sl.top = null;
  return top.items().map((t) => [[...t.payload].reverse(), t.score]);
}

// ---------------------------------------------------------------------------
// Word info

export interface WordInfo {
  type: "kanji" | "kana" | "gap";
  text: string;
  trueText: string | null;
  kana: string | string[];
  seq: number | number[] | (number | number[] | null)[] | null;
  conjugations: Conjugations;
  score: number;
  components: WordInfo[];
  alternative: boolean;
  primary: boolean;
  start: number | null;
  end: number | null;
  counter: [string, boolean] | null;
  skipped: number;
  /** Not part of upstream word-info: the scored word object, for projection. */
  word?: Word;
}

export function wordInfoFromSegment(segment: Segment): WordInfo {
  const word = segment.word;
  return {
    type: wordType(word),
    text: segmentText(segment),
    kana: getKana(word),
    seq: seqList(word),
    conjugations: isSimple(word) ? wordConjugations(word) : null,
    trueText: isSimple(word) ? trueText(word) : null,
    components:
      word.kind === "compound"
        ? word.words.map((wrd) => ({
            type: wordType(wrd),
            text: textOf(wrd),
            trueText: trueText(wrd),
            kana: getKana(wrd),
            seq: seqOf(wrd),
            conjugations: wordConjugations(wrd),
            score: 0,
            components: [],
            alternative: false,
            primary: seqOf(wrd) === seqOf(word.primary),
            start: null,
            end: null,
            counter: null,
            skipped: 0,
            word: wrd,
          }))
        : [],
    counter: word.kind === "counter" ? [valueString(word), word.ordinalp] : null,
    score: segment.score!,
    start: segment.start,
    end: segment.end,
    alternative: false,
    primary: true,
    skipped: 0,
    word,
  };
}

export const SEGMENT_SCORE_CUTOFF = 2 / 3;
function wordInfoFromSegmentList(sl: SegmentList): WordInfo {
  const all = sl.segments.map(wordInfoFromSegment);
  const wi1 = all[0];
  const maxScore = wi1.score;
  const list = all.filter((wi) => !(wi.score < SEGMENT_SCORE_CUTOFF * maxScore));
  if (list.length === 1) {
    wi1.skipped = sl.matches - 1;
    return wi1;
  }
  const kana: string[] = [];
  for (const wi of list) {
    const k = wi.kana as string;
    if (!kana.includes(k)) kana.push(k);
  }
  return {
    type: wi1.type,
    text: wi1.text,
    trueText: null,
    kana,
    seq: list.map((wi) => wi.seq as number | number[] | null),
    conjugations: null,
    components: list,
    alternative: true,
    primary: true,
    score: wi1.score,
    start: sl.start,
    end: sl.end,
    counter: null,
    skipped: sl.matches - list.length,
  };
}

function processWordInfo(list: WordInfo[]): WordInfo[] {
  for (let i = 0; i + 1 < list.length; i++) {
    const wi = list[i];
    if (wi.text !== "何") continue;
    const next = list[i + 1];
    const kn = Array.isArray(next.kana) ? next.kana : [next.kana];
    let nani = false,
      nan = false;
    const NAN = new Set([
      "ba", "bi", "bu", "be", "bo", "pa", "pi", "pu", "pe", "po",
      "da", "dji", "dzu", "de", "do", "za", "ji", "zu", "ze", "zo",
      "ta", "chi", "tsu", "te", "to", "na", "nu", "ne", "no",
      "ra", "ri", "ru", "re", "ro",
    ]);
    for (const kana of kn) {
      if (!kana.length) continue;
      if (NAN.has(getCharClass(kana[0])!)) nan = true;
      else nani = true;
    }
    const k = nan && nani ? "なに" : nan ? "なん" : nani ? "なに" : null;
    if (k) wi.kana = k;
  }
  return list;
}

export function fillSegmentPath(str: string, path: PathItem[]): WordInfo[] {
  const gap = (start: number, end: number): WordInfo => {
    const t = str.slice(start, end);
    return {
      type: "gap",
      text: t,
      trueText: null,
      kana: t,
      seq: null,
      conjugations: null,
      score: 0,
      components: [],
      alternative: false,
      primary: true,
      start,
      end,
      counter: null,
      skipped: 0,
    };
  };
  const out: WordInfo[] = [];
  let idx = 0;
  for (const sl of path) {
    if (sl.kind !== "segment-list") continue;
    if (sl.start > idx) out.push(gap(idx, sl.start));
    out.push(wordInfoFromSegmentList(sl));
    idx = sl.end;
  }
  if (idx < str.length) out.push(gap(idx, str.length));
  return processWordInfo(out);
}

export function dictSegment(str: string, limit = 5): [WordInfo[], number][] {
  return findBestPath(joinSubstringWords(str), str.length, limit).map(([path, score]) => [
    fillSegmentPath(str, path),
    score,
  ]);
}
export function simpleSegment(str: string, limit = 5): WordInfo[] {
  return dictSegment(str, limit)[0]?.[0] ?? [];
}

/** find-word-info: all readings of `text` as a single word, best first. */
export function findWordInfo(text: string, opts: { reading?: string; rootOnly?: boolean } = {}): WordInfo[] {
  const end = text.length;
  const words = bind({ suffixMapTemp: getSuffixMap(text), suffixNextEnd: end }, () =>
    opts.rootOnly
      ? findWord(text, true)
      : findWordFull(text, { asHiragana: testWord(text, "katakana"), counter: "auto" }),
  );
  const segments = stableSort(
    words.map((word) => genScore({ start: 0, end, word, score: null, info: null, text }, false, null)),
    (a, b) => a.score! > b.score!,
  );
  let wis = segments.map(wordInfoFromSegment);
  if (opts.reading !== undefined) {
    const reading = opts.reading;
    wis = wis.flatMap((wi) => {
      if (wi.kana === reading) return [wi];
      const seq = typeof wi.seq === "number" ? wi.seq : null;
      if (seq !== null && (bundle(seq)?.readings ?? []).some((r) => r.table === "kana" && r.text === reading)) {
        wi.kana = reading;
        return [wi];
      }
      return [];
    });
  }
  return wis;
}
