/** Port of Ichiran's word-info presentation (dict.lisp word-info-gloss-json,
 * get-senses-json, conj-info-json, word-info-str) and romanize/romanize*
 * (Timofei Shatrov, MIT). */
import { testWord } from "./chars.js";
import { S } from "./state.js";
import {
  bundle,
  getConjData,
  getKana,
  getKanji,
  makeWord,
  nokanjiOf,
  readingsByOrd,
  wordType,
  type ConjData,
  type SimpleText,
  type WordInfo,
} from "./dict.js";
import { getSuffixDescription } from "./grammar.js";
import { DEFAULT_METHOD, METHODS, romanizeWord, stripHints, type RomanizationMethod } from "./romanize.js";
import { matchReadings } from "./kanji.js";
import { unrendaku } from "./chars.js";
import type { ConjPropRow, ReadingRow } from "./store.js";

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
/** jsown encodes nil (and false) as an empty list. */
const nil = (v: Json | undefined): Json => (v === null || v === undefined || v === false ? [] : v);

export const CONJ_DESCRIPTIONS: Record<number, string> = {
  1: "Non-past",
  2: "Past (~ta)",
  3: "Conjunctive (~te)",
  4: "Provisional (~eba)",
  5: "Potential",
  6: "Passive",
  7: "Causative",
  8: "Causative-Passive",
  9: "Volitional",
  10: "Imperative",
  11: "Conditional (~tara)",
  12: "Alternative (~tari)",
  13: "Continuative (~i)",
  50: "Adverbial",
  51: "Adjective Stem",
  52: "Negative Stem",
  53: "Causative (~su)",
  54: "Old/literary form",
};

// ---------------------------------------------------------------------------
// Senses

type Props = [string, string[]][];
interface RawSense {
  ord: number;
  gloss: string;
  props: Props;
}
const SENSE_TAGS = ["pos", "s_inf", "stagk", "stagr", "field"];

export function getSensesRaw(seq: number): RawSense[] {
  const b = bundle(seq);
  if (!b) return [];
  const senses = [...b.senses].sort((x, y) => x.ord - y.ord);
  const list: RawSense[] = senses.map((s) => ({
    ord: s.ord,
    gloss: (b.glosses ?? [])
      .filter((g) => g.senseId === s.id)
      .sort((x, y) => x.ord - y.ord)
      .map((g) => g.text)
      .join("; "),
    props: [],
  }));
  const senseOrd = new Map(senses.map((s) => [s.id, s.ord]));
  const props = b.props
    .filter((p) => SENSE_TAGS.includes(p.tag) && senseOrd.has(p.senseId))
    .map((p) => ({ sord: senseOrd.get(p.senseId)!, tag: p.tag, text: p.text, ord: p.ord, id: p.id }))
    .sort((x, y) => x.sord - y.sord || (x.tag < y.tag ? -1 : x.tag > y.tag ? 1 : 0) || x.ord - y.ord || x.id - y.id);
  let cur: RawSense | undefined,
    curOrd: number | null = null,
    curTag: string | null = null,
    bag: string[] = [];
  for (const p of props) {
    if (p.sord !== curOrd || p.tag !== curTag) {
      if (cur) cur.props.unshift([curTag!, [...bag].reverse()]);
      curOrd = p.sord;
      curTag = p.tag;
      bag = [];
      cur = list.find((s) => s.ord === p.sord);
    }
    bag.unshift(p.text);
  }
  // upstream does not reverse the last group
  if (cur) cur.props.unshift([curTag!, bag]);
  return list;
}
const assoc = (props: Props, tag: string) => props.find(([t]) => t === tag)?.[1];
export function getSenses(seq: number): [string, string, Props][] {
  return getSensesRaw(seq).map((s) => [`[${(assoc(s.props, "pos") ?? []).join(",")}]`, s.gloss, s.props]);
}
export function getSensesStr(seq: number): string {
  let out = "";
  let rpos = "";
  getSenses(seq).forEach(([pos, gloss, props], i) => {
    rpos = i === 0 ? pos : pos === "[]" ? rpos : pos;
    const inf = assoc(props, "s_inf");
    const field = assoc(props, "field");
    if (i > 0) out += "\n";
    out += `${i + 1}. ${rpos} ${field ? `{${field.join(",")}} ` : ""}${inf ? `《${inf.join("; ")}》 ` : ""}${gloss}`;
  });
  return out;
}

function matchKanaKanji(kana: SimpleText, kanji: SimpleText, restricted: { reading: string; text: string }[]): boolean {
  if (nokanjiOf(kana)) return false;
  const restr = restricted.filter((r) => r.reading === kana.row.text).map((r) => r.text);
  return restr.length ? restr.includes(kanji.row.text) : true;
}
function matchSenseRestrictions(seq: number, props: Props, reading: SimpleText): boolean {
  const stagk = assoc(props, "stagk");
  const stagr = assoc(props, "stagr");
  const wtype = wordType(reading);
  if (!stagk && !stagr) return true;
  if (stagk?.includes(reading.row.text) || stagr?.includes(reading.row.text)) return true;
  if (!stagr && wtype === "kanji") return false;
  if (!stagk && wtype === "kana") return false;
  const restricted = bundle(seq)?.restricted ?? [];
  const readings = bundle(seq)?.readings ?? [];
  if (wtype === "kanji")
    return readings
      .filter((r) => r.table === "kana" && stagr!.includes(r.text))
      .some((rk) => matchKanaKanji(makeWord(rk), reading, restricted));
  return readings
    .filter((r) => r.table === "kanji" && stagk!.includes(r.text))
    .some((rk) => matchKanaKanji(reading, makeWord(rk), restricted));
}

export function getSensesJson(
  seq: number,
  opts: { posList?: string[]; reading?: SimpleText | null; readingGetter?: () => SimpleText | null } = {},
): Json[] {
  const out: Json[] = [];
  let reading = opts.reading ?? null;
  let readp = false;
  let rpos = "",
    lpos: string[] = [];
  getSenses(seq).forEach(([pos, gloss, props], i) => {
    const empty = pos === "[]";
    rpos = i === 0 ? pos : empty ? rpos : pos;
    lpos = i === 0 || !empty ? pos.slice(1, -1).split(",") : lpos;
    const inf = assoc(props, "s_inf");
    const field = assoc(props, "field");
    const posOk = !opts.posList?.length || lpos.some((p) => opts.posList!.includes(p));
    let restrOk = true;
    if (posOk && (opts.reading || opts.readingGetter) && (assoc(props, "stagk") || assoc(props, "stagr"))) {
      let rr = reading;
      if (!rr && !readp) {
        readp = true;
        reading = rr = opts.readingGetter ? opts.readingGetter() : null;
      }
      restrOk = rr ? matchSenseRestrictions(seq, props, rr) : true;
    }
    if (posOk && restrOk) {
      const js: { [k: string]: Json } = { pos: rpos, gloss };
      if (field) js.field = `{${field.join(",")}}`;
      if (inf) js.info = inf.join("; ");
      out.push(js);
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Readings

export function readingStrStar(kanji: string | null, kana: string | string[]): string {
  const k = Array.isArray(kana) ? `(${kana.join(" ")})` : kana;
  return kanji ? `${kanji} 【${k}】` : k;
}
export function readingStrSeq(seq: number): string {
  const kanji = readingsByOrd(seq, "kanji").find((r) => r.ord === 0)?.text ?? null;
  const kana = readingsByOrd(seq, "kana").find((r) => r.ord === 0)?.text ?? "";
  return readingStrStar(kanji, kana);
}
function readingStrWord(w: SimpleText): string {
  return readingStrStar(getKanji(w), getKana(w));
}
export function wordInfoReadingStr(wi: WordInfo): string {
  if (wi.type === "kanji" || (wi.counter && wi.seq !== null)) return readingStrStar(wi.text, wi.kana);
  return readingStrStar(null, wi.text);
}
function wordInfoReading(wi: WordInfo): SimpleText | null {
  if (wi.type === "gap" || !wi.trueText) return null;
  const row = S()
    .store.byTextAnyTable(wi.trueText)
    .find((r) => r.table === wi.type);
  return row ? makeWord(row) : null;
}
function findWordsSeqs(words: string[], seq: number): SimpleText[] {
  const kanji: ReadingRow[] = [],
    kana: ReadingRow[] = [];
  for (const w of words)
    for (const r of S().store.byTextAnyTable(w))
      if (r.seq === seq && r.table === (testWord(w, "kana") ? "kana" : "kanji"))
        (r.table === "kanji" ? kanji : kana).push(r);
  const byPhys = (a: ReadingRow, b: ReadingRow) => (a.phys ?? a.id) - (b.phys ?? b.id);
  return [...kanji.sort(byPhys), ...kana.sort(byPhys)].map(makeWord);
}

// ---------------------------------------------------------------------------
// Conjugation info

function conjPropJson(p: ConjPropRow): Json {
  const js: { [k: string]: Json } = { pos: p.pos, type: CONJ_DESCRIPTIONS[p.conjType] ?? String(p.conjType) };
  if (p.neg) js.neg = true;
  if (p.fml) js.fml = true;
  return js;
}
const conjTypeOrder = (t: number) => (t === 10 ? 13 : t === 13 ? 10 : t);
const isRareru = (t: string) => ["られる", "られます", "られない", "られません"].some((s) => t.endsWith(s));
function filterProps(props: ConjPropRow[], text: string | string[] | null): ConjPropRow[] {
  return props.filter(
    (p) =>
      !(
        text &&
        p.conjType === 6 &&
        ["v1", "v1s", "vk"].includes(p.pos) &&
        !(Array.isArray(text) ? text.some(isRareru) : isRareru(text))
      ),
  );
}
function selectConjs(seq: number, conjIds: WordInfo["conjugations"]) {
  const conjs = bundle(seq)?.conjugations ?? [];
  if (conjIds) return conjIds === "root" ? [] : conjs.filter((c) => conjIds.includes(c.id));
  const root = conjs.filter((c) => c.via === null);
  return root.length ? root : conjs;
}
function selectConjsAndProps(seq: number, conjIds: WordInfo["conjugations"], text: string | string[] | null) {
  const b = bundle(seq);
  const rows = selectConjs(seq, conjIds).map((conj) => {
    const props = (b?.conjProps ?? []).filter((p) => p.conjId === conj.id);
    const val = Math.min(...props.map((p) => conjTypeOrder(p.conjType)));
    return { conj, props: filterProps(props, text), key: [conj.via === null ? 0 : 1, val] };
  });
  return rows
    .map((r, i) => [r, i] as const)
    .sort(([a, i], [b2, j]) => a.key[0] - b2.key[0] || a.key[1] - b2.key[1] || i - j)
    .map(([r]) => r);
}
function getOriginalTextOnce(conjDatas: ConjData[], texts: string | string[] | null): string[] {
  const list = texts === null ? [] : Array.isArray(texts) ? texts : [texts];
  const out: string[] = [];
  for (const cd of conjDatas) for (const [txt, src] of cd.srcMap) if (list.includes(txt)) out.push(src);
  return out;
}
function conjInfoJsonStar(
  seq: number,
  conjugations: WordInfo["conjugations"],
  text: string | string[] | null,
  hasGloss: boolean,
): { [k: string]: Json }[] {
  const out: { [k: string]: Json }[] = [];
  const viaUsed: number[] = [];
  for (const { conj, props } of selectConjsAndProps(seq, conjugations, text)) {
    const via = conj.via;
    if (via !== null && viaUsed.includes(via)) continue;
    const conjPos: string[] = [];
    const origText = getOriginalTextOnce(getConjData(seq, [conj.id]), text);
    const js: { [k: string]: Json } = {
      prop: props.map((p) => {
        conjPos.unshift(p.pos);
        return conjPropJson(p);
      }),
    };
    if (via === null) {
      const origReading = origText.length ? (findWordsSeqs(origText, conj.from)[0] ?? null) : null;
      if (hasGloss && !origReading) continue;
      js.reading = origReading ? readingStrWord(origReading) : readingStrSeq(conj.from);
      js.gloss = getSensesJson(conj.from, { posList: conjPos, readingGetter: () => origReading });
      js.readok = origReading ? true : [];
    } else {
      if (!origText.length) continue;
      const cij = conjInfoJson(via, null, origText, hasGloss);
      if (!cij.length) continue;
      js.via = cij;
      js.readok = (cij[0] as { readok: Json }).readok;
      viaUsed.push(via);
    }
    out.push(js);
  }
  return out;
}
export function conjInfoJson(
  seq: number,
  conjugations: WordInfo["conjugations"],
  text: string | string[] | null,
  hasGloss = false,
): Json[] {
  const cij = conjInfoJsonStar(seq, conjugations, text, hasGloss);
  const f = cij.filter((c) => c.readok === true);
  return f.length ? f : cij;
}

// ---------------------------------------------------------------------------
// word-info-gloss-json

export function wordInfoGlossJson(wi: WordInfo, rootOnly = false): Json {
  const inner = (wi: WordInfo, suffix = false): Json => {
    const js: { [k: string]: Json } = {
      reading: wordInfoReadingStr(wi),
      text: wi.text,
      kana: wi.kana,
    };
    js.score = wi.score;
    if (wi.components.length) {
      js.compound = wi.components.map((c) => c.text);
      js.components = wi.components.map((c) => inner(c, !c.primary));
    } else if (wi.counter) {
      js.counter = { value: wi.counter[0], ordinal: nil(wi.counter[1]) };
      const seq = wi.seq as number | null;
      if (seq !== null) {
        js.seq = seq;
        const gloss = getSensesJson(seq, { posList: ["ctr"], readingGetter: () => wordInfoReading(wi) });
        if (gloss.length) js.gloss = gloss;
      }
    } else {
      const seq = wi.seq as number | null;
      const conjs = wi.conjugations;
      let hasGloss = false;
      if (seq !== null) js.seq = seq;
      let desc: string | undefined;
      if (rootOnly) {
        js.gloss = getSensesJson(seq!, { readingGetter: () => wordInfoReading(wi) });
        return js;
      } else if (suffix && seq !== null && (desc = getSuffixDescription(seq))) js.suffix = desc;
      else if (seq !== null && (!conjs || conjs === "root")) {
        const gloss = getSensesJson(seq, { readingGetter: () => wordInfoReading(wi) });
        if (gloss.length) {
          hasGloss = true;
          js.gloss = gloss;
        }
      }
      if (seq !== null) js.conj = conjInfoJson(seq, wi.conjugations, wi.trueText, hasGloss);
    }
    return js;
  };
  if (wi.alternative) return { alternative: wi.components.map((c) => inner(c)) };
  return inner(wi);
}

// ---------------------------------------------------------------------------
// Romanization of word-infos

function simplifyReadingList(list: string[]): string[] {
  const acc: [string, number, number[]][] = [];
  for (const reading of list) {
    let off = 0,
      can = "";
    const spos: number[] = [];
    [...reading].forEach((c, i) => {
      if (c === " ") {
        if (!spos.includes(i - off)) spos.push(i - off);
        off++;
      } else can += c;
    });
    const a = acc.find((x) => x[0] === can);
    if (a) {
      a[2] = [...spos, ...a[2]];
      a[1]++;
    } else acc.push([can, 1, spos]);
  }
  return acc.map(([can, cnt, spos]) => {
    const sspos = [...new Set(spos)].sort((x, y) => x - y);
    let out = "";
    [...can].forEach((c, i) => {
      if (sspos[0] === i) {
        out += spos.filter((p) => p === sspos[0]).length === cnt ? " " : "·";
        sspos.shift();
      }
      out += c;
    });
    return out;
  });
}
export function mapWordInfoKana(fn: (k: string) => string, wi: WordInfo, separator = "/"): string {
  return Array.isArray(wi.kana) ? simplifyReadingList(wi.kana.map(fn)).join(separator) : fn(wi.kana);
}
export function romanizeWordInfo(wi: WordInfo, method: RomanizationMethod | "kana" | "text" = DEFAULT_METHOD): string {
  if (method === "text") return wi.text;
  return mapWordInfoKana(
    method === "kana"
      ? (wk) => stripHints(wk)
      : (wk) => romanizeWord(wk, { method, originalSpelling: wi.text, normalize: false }),
    wi,
  );
}
/** join-parts: insert a space before alphanumeric parts not preceded by whitespace. */
export function joinParts(parts: string[]): string {
  let out = "",
    lastSpace = true;
  for (const part of parts) {
    if (part.length && !lastSpace && /^[\p{L}\p{N}]/u.test(part)) out += " ";
    out += part;
    if (part.length) lastSpace = /\s/u.test(part[part.length - 1]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// word-info-str (text info, as `ichiran-cli -i`)

function shortSenseStr(seq: number, withPos?: string): string | null {
  const b = bundle(seq);
  if (!b) return null;
  const senses = [...b.senses]
    .filter(
      (s) => !withPos || b.props.some((p) => p.senseId === s.id && p.tag === "pos" && p.text === withPos),
    )
    .sort((x, y) => x.ord - y.ord);
  const s = senses[0];
  if (!s) return null;
  return (b.glosses ?? [])
    .filter((g) => g.senseId === s.id)
    .sort((x, y) => x.ord - y.ord)
    .map((g) => g.text)
    .join("; ");
}
function entryInfoShort(seq: number, withPos?: string): string {
  const sense = shortSenseStr(seq, withPos);
  return `${readingStrSeq(seq)} : ${sense ?? ""}`;
}
function conjInfoShort(p: ConjPropRow): string {
  return `[${p.pos}] ${CONJ_DESCRIPTIONS[p.conjType] ?? p.conjType}${p.neg === true ? " Negative" : p.neg === false ? " Affirmative" : ""}${p.fml === true ? " Formal" : p.fml === false ? " Plain" : ""}`;
}
function printConjInfo(seq: number, conjugations: WordInfo["conjugations"]): string {
  let out = "";
  const viaUsed: number[] = [];
  for (const { conj, props } of selectConjsAndProps(seq, conjugations, null)) {
    const via = conj.via;
    if (via !== null && viaUsed.includes(via)) continue;
    props.forEach((p, i) => {
      out += `\n${i === 0 ? "[" : " "} Conjugation: ${conjInfoShort(p)}`;
    });
    if (via === null) out += `\n  ${entryInfoShort(conj.from)}`;
    else {
      out += "\n --(via)--";
      out += printConjInfo(via, null);
      viaUsed.push(via);
    }
    out += " ]";
  }
  return out;
}
export function wordInfoStr(wi: WordInfo): string {
  let s = "";
  const inner = (wi: WordInfo, suffix = false, marker = false) => {
    if (marker) s += " * ";
    s += wordInfoReadingStr(wi);
    if (wi.components.length) {
      s += ` Compound word: ${wi.components.map((c) => c.text).join(" + ")}`;
      for (const comp of wi.components) {
        s += "\n";
        inner(comp, !comp.primary, true);
      }
    } else if (wi.counter) {
      s += "\n" + wi.counter[0];
      const seq = wi.seq as number | null;
      if (seq !== null) s += "\n" + getSensesStr(seq);
    } else {
      const seq = wi.seq as number | null;
      const conjs = wi.conjugations;
      let desc: string | undefined;
      if (suffix && seq !== null && (desc = getSuffixDescription(seq))) s += `  [suffix]: ${desc} `;
      else if (!conjs || conjs === "root") s += "\n" + (seq !== null ? getSensesStr(seq) : "???");
      if (seq !== null) s += printConjInfo(seq, conjs);
    }
  };
  if (wi.alternative)
    wi.components.forEach((c, i) => {
      if (i > 0) s += "\n";
      s += `<${i + 1}>. `;
      inner(c);
    });
  else inner(wi);
  return s;
}

// ---------------------------------------------------------------------------
// Kanji (kanji.lisp to-json, match-readings-json)

export interface KanjiInfo {
  text: string;
  radicalC: number | null;
  radicalN: number | null;
  grade: number | null;
  strokes: number | null;
  freq: number | null;
  statCommon: number;
  statIrregular: number;
  readings: { type: string; text: string; suffixp: boolean; prefixp: boolean; statCommon: number; okurigana: string[] }[];
  meanings: string[];
}
/** calculate-perc: "~,2,,,'0F%" of sample/total */
export function calculatePerc(sample: number, total: number): string {
  if (total === 0) return "--.--%";
  return `${((100 * sample) / total).toFixed(2)}%`;
}
export function kanjiInfoJson(k: KanjiInfo): Json {
  const total = k.statCommon;
  const readings = k.readings
    .map((r, i) => [r, i] as const)
    .filter(([r]) => r.type !== "ja_na")
    .sort(([a, i], [b, j]) => (a.type < b.type ? 1 : a.type > b.type ? -1 : 0) || b.statCommon - a.statCommon || i - j)
    .map(([r]) => {
      const js: { [key: string]: Json } = {
        text: r.text,
        rtext: romanizeWord(r.text, { method: METHODS["hepburn-basic"], originalSpelling: "" }),
        type: r.type,
        okuri: [...new Set(r.okurigana)].sort(),
        sample: r.statCommon,
        perc: calculatePerc(r.statCommon, total),
      };
      if (r.prefixp) js.prefixp = true;
      if (r.suffixp) js.suffixp = true;
      return js;
    });
  const js: { [key: string]: Json } = {
    text: k.text,
    rc: k.radicalC,
    rn: k.radicalN,
    strokes: k.strokes,
    total: k.statCommon,
    irr: k.statIrregular,
    irr_perc: calculatePerc(k.statIrregular, total),
    readings,
    meanings: k.meanings,
  };
  if (k.freq !== null) js.freq = k.freq;
  if (k.grade !== null) js.grade = k.grade;
  return js;
}
const KANJI_CHAR = /[一-龯]/;
/** match-readings-json; `stats(kanji, reading, type)` returns usage statistics. */
export function matchReadingsJson(
  str: string,
  reading: string,
  stats: (kanji: string, reading: string, type: string) => { sample: number; total: number; grade: number | null } | null,
): Json {
  if (!/[々ヶ〆一-龯]/.test(str)) return [];
  const match = matchReadings(str, reading);
  if (!match) return [];
  const result: Json[] = [];
  let irr: [string, string][] = [];
  const flush = () => {
    const js: { [k: string]: Json } = {
      kanji: irr.map((x) => x[0]).join(""),
      reading: irr.map((x) => x[1]).join(""),
      type: "irr",
    };
    if (KANJI_CHAR.test(js.kanji as string)) js.link = true;
    result.push(js);
    irr = [];
  };
  for (const item of match) {
    if (typeof item === "string") {
      if (irr.length) flush();
      result.push({ text: item });
      continue;
    }
    const [kanji, rtext, type, rendaku, gem] = item as [string, string, string, boolean?, (string | null)?];
    if (type === "irr") {
      irr.push([kanji, rtext]);
      continue;
    }
    if (irr.length) flush();
    const js: { [k: string]: Json } = { kanji, reading: rtext, type };
    if (KANJI_CHAR.test(kanji)) js.link = true;
    if (rendaku) js.rendaku = "rendaku";
    if (gem) js.geminated = gem;
    let orig = rendaku ? unrendaku(rtext) : rtext;
    if (gem) orig = orig.slice(0, -1) + gem[0];
    const st = stats(kanji, orig, type);
    if (st) {
      js.stats = true;
      js.sample = st.sample;
      js.total = st.total;
      js.perc = calculatePerc(st.sample, st.total);
      if (st.grade !== null) js.grade = st.grade;
    }
    result.push(js);
  }
  if (irr.length) flush();
  return result;
}
