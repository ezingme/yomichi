/** Port of Ichiran kanji.lisp loading and statistics (Timofei Shatrov, MIT):
 * KANJIDIC2 characters, readings (on/kun merged by text, nanori), okurigana,
 * English meanings and per-reading usage statistics over common words. */
import { asHiragana } from "../../../core/src/ichiran/chars.js";
import { children, text, type Lexicon } from "./lexicon.js";
import type { Node } from "../xml.js";

export interface KanjiRow {
  id: number;
  text: string;
  radicalC: number | null;
  radicalN: number | null;
  grade: number | null;
  strokes: number | null;
  freq: number | null;
  statCommon: number;
  statIrregular: number;
}
export interface KanjiReadingFull {
  id: number;
  kanjiId: number;
  type: string;
  text: string;
  suffixp: boolean;
  prefixp: boolean;
  statCommon: number;
  okurigana: string[];
}
export class KanjiTables {
  kanji: KanjiRow[] = [];
  readings: KanjiReadingFull[] = [];
  meanings: { id: number; kanjiId: number; text: string }[] = [];
  byChar = new Map<string, KanjiRow>();
  readingsByKanji = new Map<number, KanjiReadingFull[]>();
  private nextReading = 0;
  private nextMeaning = 0;

  /** load-kanji */
  load(n: Node): void {
    const first = (name: string) => {
      const nodes = descendants(n, name);
      return nodes.length ? text(nodes[0]) : null;
    };
    let radicalC: number | null = null,
      radicalN: number | null = null;
    for (const r of descendants(n, "rad_value")) {
      const v = Number.parseInt(text(r), 10);
      if (r.attrs.rad_type === "classical" && radicalC === null) radicalC = v;
      else if (r.attrs.rad_type === "nelson_c" && radicalN === null) radicalN = v;
    }
    if (radicalN === null) radicalN = radicalC;
    const int = (s: string | null) => (s === null ? null : Number.parseInt(s, 10));
    const k: KanjiRow = {
      id: this.kanji.length,
      text: first("literal")!,
      radicalC,
      radicalN,
      grade: int(first("grade")),
      strokes: int(first("stroke_count")),
      freq: int(first("freq")),
      statCommon: 0,
      statIrregular: 0,
    };
    this.kanji.push(k);
    this.byChar.set(k.text, k);
    // load-readings: on/kun merged by reading text in first-seen order
    const merged = new Map<string, { okuri: string[]; type: string; suffixp: boolean; prefixp: boolean }>();
    for (const r of descendants(n, "reading")) {
      const type = r.attrs.r_type;
      if (type !== "ja_on" && type !== "ja_kun") continue;
      let t = asHiragana(text(r));
      let suffixp = false,
        prefixp = false;
      if (t[0] === "-") {
        suffixp = true;
        t = t.slice(1);
      }
      if (t.at(-1) === "-") {
        prefixp = true;
        t = t.slice(0, -1);
      }
      const dot = t.indexOf(".");
      const reading = dot >= 0 ? t.slice(0, dot) : t;
      const okuri = dot >= 0 ? t.slice(dot + 1) : null;
      const old = merged.get(reading);
      if (old) {
        if (old.type !== type) old.type = "ja_onkun";
        // "" is a true value in Lisp: an empty okurigana is recorded too
        if (okuri !== null) old.okuri.unshift(okuri);
        if (suffixp) old.suffixp = true;
        if (prefixp) old.prefixp = true;
      } else merged.set(reading, { okuri: okuri !== null ? [okuri] : [], type, suffixp, prefixp });
    }
    const list: KanjiReadingFull[] = [];
    for (const [t, info] of merged)
      list.push({ id: this.nextReading++, kanjiId: k.id, type: info.type, text: t, suffixp: info.suffixp, prefixp: info.prefixp, statCommon: 0, okurigana: info.okuri });
    for (const nr of descendants(n, "nanori"))
      list.push({ id: this.nextReading++, kanjiId: k.id, type: "ja_na", text: asHiragana(text(nr)), suffixp: false, prefixp: false, statCommon: 0, okurigana: [] });
    this.readings.push(...list);
    this.readingsByKanji.set(k.id, list);
    for (const m of descendants(n, "meaning")) {
      const lang = m.attrs.m_lang ?? "";
      if (lang === "" || lang === "en") this.meanings.push({ id: this.nextMeaning++, kanjiId: k.id, text: text(m) });
    }
  }

  /** Readings as used by the reading matcher (table order). */
  matcherReadings(): Map<string, { text: string; type: string }[]> {
    const out = new Map<string, { text: string; type: string }[]>();
    for (const k of this.kanji)
      out.set(k.text, (this.readingsByKanji.get(k.id) ?? []).map((r) => ({ text: r.text, type: r.type })));
    return out;
  }
}

function descendants(n: Node, name: string): Node[] {
  const out: Node[] = [];
  const walk = (x: Node) => {
    for (const c of x.children) {
      if (c.name === name) out.push(c);
      walk(c);
    }
  };
  walk(n);
  return out;
}

/** get-kanji-words: common root entries whose kanji spelling contains the
 * character, paired with that spelling's best kana. */
export function getKanjiWords(lex: Lexicon, char: string): [number, string, string, number][] {
  const out: [number, string, string, number][] = [];
  for (let id = 0; id < lex.kanji.size; id++) {
    if (!lex.kanji.live(id)) continue;
    const t = lex.kanji.textOf(id);
    if (!t.includes(char)) continue;
    const seq = lex.kanji.seq.get(id);
    if (!lex.entries.get(seq)?.rootP) continue;
    const common = lex.kanji.commonOf(id);
    const best = lex.kanji.bestOf(id);
    if (common === null || best === null) continue;
    if (!lex.kana.bySeq.get(seq).some((r) => lex.kana.textOf(r) === best)) continue;
    out.push([seq, t, best, common]);
  }
  return out;
}

/** load-kanji-stats, using a reading matcher bound to these tables. */
export function loadKanjiStats(
  lex: Lexicon,
  tables: KanjiTables,
  matchReadings: (str: string, reading: string) => (string | [string, string, ...unknown[]])[] | null,
  originalReading: (rtext: string, rendaku: boolean, gem: string | null) => string,
): void {
  // index words by kanji character once
  const words = new Map<string, [number, string, string, number][]>();
  for (let id = 0; id < lex.kanji.size; id++) {
    if (!lex.kanji.live(id)) continue;
    const seq = lex.kanji.seq.get(id);
    if (!lex.entries.get(seq)?.rootP) continue;
    const common = lex.kanji.commonOf(id);
    const best = lex.kanji.bestOf(id);
    if (common === null || best === null) continue;
    const t = lex.kanji.textOf(id);
    for (const c of new Set(t)) {
      const list = words.get(c) ?? [];
      list.push([seq, t, best, common]);
      words.set(c, list);
    }
  }
  for (const k of tables.kanji) {
    k.statCommon = 0;
    k.statIrregular = 0;
    for (const r of tables.readingsByKanji.get(k.id) ?? []) r.statCommon = 0;
  }
  for (const k of tables.kanji) {
    if (k.grade === null || k.grade > 8) continue;
    const list = words.get(k.text) ?? [];
    const stats = new Map<string, number>();
    let irregular = 0;
    for (const [, kt, rt] of list) {
      const match = matchReadings(kt, rt);
      const reading = match?.find((m): m is [string, string, ...unknown[]] => Array.isArray(m) && m[0] === k.text);
      if (!reading) {
        irregular++;
        continue;
      }
      const [, rtext, rtype, rendaku, gem] = reading as [string, string, string, boolean?, (string | null)?];
      if (rtype === "irr") irregular++;
      else {
        const key = `${originalReading(rtext, !!rendaku, gem ?? null)}\u0000${rtype}`;
        stats.set(key, (stats.get(key) ?? 0) + 1);
      }
    }
    k.statCommon = list.length;
    k.statIrregular = irregular;
    const readings = tables.readingsByKanji.get(k.id) ?? [];
    for (const [key, count] of stats) {
      const [rtext, rtype] = key.split("\u0000");
      const r = readings.find((x) => x.text === rtext && x.type === rtype);
      if (r) r.statCommon = count;
    }
  }
}
