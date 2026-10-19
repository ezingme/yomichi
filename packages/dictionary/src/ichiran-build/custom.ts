/** Port of Ichiran dict-custom.lisp (Timofei Shatrov, MIT): extra XML entries
 * and Japanese municipality/ward names, loaded into the in-memory model. */
import { asHiragana, normalize, testWord } from "../../../core/src/ichiran/chars.js";
import { romanizeWordGeo } from "../../../core/src/ichiran/romanize.js";
import type { Node } from "../xml.js";
import { children, text, type Lexicon } from "./lexicon.js";
import type { Errata } from "./errata.js";
import { POS_WITH_CONJ_RULES } from "./lexicon.js";
import type { RuleTable } from "./conj-rules.js";

export interface CustomSources {
  /** Parsed <entry> nodes of Ichiran's data/sources/extra.xml */
  extra: Node[];
  /** Rows of jichitai.csv: id, prefecture, municipality, prefecture reading, municipality reading */
  municipalities: string[][];
  /** Rows of gyoseiku.csv: id, name, reading */
  wards: string[][];
}

export class CustomLoader {
  constructor(
    private lex: Lexicon,
    private rules: RuleTable,
    private sources: CustomSources,
    private errata: () => Errata,
  ) {}

  load(keys?: string[]): void {
    if (!keys || keys.includes("extra")) this.loadExtra();
    if (!keys || keys.includes("municipality")) this.insertGeo(this.municipalities());
    if (!keys || keys.includes("ward")) this.insertGeo(this.wards());
  }

  /** find-word: seq of the first reading row with this text, if any */
  private findWordSeq(word: string): number | undefined {
    const t = this.lex.table(testWord(word, "kana") ? "kana" : "kanji");
    const ids = [...t.withText(word)].sort((a, b) => a - b);
    return ids.length ? t.seq.get(ids[0]) : undefined;
  }

  private loadExtra(): void {
    for (const node of this.sources.extra) {
      const raw = text(children(node, "ent_seq")[0]);
      const seq = /^\d+$/.test(raw) ? Number(raw) : (this.findWordSeq(raw) ?? this.lex.nextSeq());
      if (this.lex.entries.has(seq)) continue;
      this.lex.loadEntry(node, { seq });
      const posi = this.lex.posOf(seq).filter((p) => POS_WITH_CONJ_RULES.includes(p));
      if (posi.length) {
        this.lex.conjugateEntry(seq, this.rules, { asPosi: posi });
        this.lex.loadSecondaryConjugations(this.rules, [seq]);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Municipalities and wards

  private municipalities(): Geo[] {
    const out: Geo[] = [];
    for (const [, pref, muni, rpref, rmuni] of this.sources.municipalities) {
      const prefectureP = !muni;
      const t = prefectureP ? pref : muni;
      const type = t.at(-1)!;
      const reading = prefectureP ? rpref : rmuni;
      const short = municipalityShort(t, reading);
      const prefecture = prefectureP ? null : romanizeMunicipality(pref, rpref);
      const definition = `${romanizeMunicipality(t, reading)}${prefecture ? `, ${prefecture}` : ""}`;
      out.push({ kind: "muni", text: t, type, reading: asHiragana(normalize(reading)), definition, prefecture });
      if (type !== "道")
        out.push({
          kind: "muni",
          text: short[0],
          type,
          reading: asHiragana(normalize(short[1] ?? "")),
          definition,
          prefecture,
        });
    }
    const order = "都道府県市区町村";
    return out
      .map((e, i) => [e, i] as const)
      .sort(([a, i], [b, j]) => order.indexOf(a.type!) - order.indexOf(b.type!) || i - j)
      .map(([e]) => e);
  }
  private wards(): Geo[] {
    const out: Geo[] = [];
    let cityText = "",
      cityReading = "",
      cityRomanized = "";
    for (const [, t, reading] of this.sources.wards) {
      if (t.endsWith("区")) {
        const wardText = t.slice(cityText.length);
        const wardReading = reading.slice(cityReading.length);
        out.push({
          kind: "ward",
          text: wardText,
          reading: wardReading,
          definition: `${romanizeMunicipality(wardText, wardReading)}, ${cityRomanized}`,
          city: cityRomanized,
        });
      } else {
        cityText = t;
        cityReading = reading;
        cityRomanized = romanizeMunicipality(t, reading, false);
      }
    }
    return out;
  }

  private insertGeo(entries: Geo[]): void {
    let cur = this.lex.nextSeq();
    for (const e of entries) {
      const [ok, seq] = this.testEntry(e);
      if (!ok) continue;
      if (Array.isArray(seq)) this.updateGloss(seq[0], seq[1], e.definition);
      else if (seq !== null) this.errata().addNewSense(seq, ["n"], [e.definition]);
      else {
        this.lex.loadEntry(asXmlSimple(e.text, e.reading, e.definition), { seq: cur });
        cur++;
      }
    }
  }
  private updateGloss(seq: number, gloss: string, newGloss: string): void {
    for (const s of this.lex.senses.get(seq) ?? []) for (const g of s.glosses) if (g.text === gloss) g.text = newGloss;
  }
  private testEntry(e: Geo): [boolean, number | [number, string] | null] {
    const words = getWords(e);
    let updateGloss: RegExp | null = null;
    if (e.kind === "muni" && e.type === "市") {
      const pref = (e.prefecture ?? "").split(" ")[0];
      updateGloss = new RegExp(`^${escape(words[0])} \\(city(?:| in ${escape(pref)})\\)$`, "i");
    } else if (e.kind === "muni" && e.type === "県")
      updateGloss = new RegExp(`^${escape(words[0])} \\((?:|city, )prefecture\\)$`, "i");
    const [seq, matchP] = this.matchGlosses(e.text, e.reading, words, updateGloss);
    if (seq === null) return [true, null];
    if (Array.isArray(seq)) return [true, seq];
    if (matchP) return [false, seq];
    return [true, seq];
  }
  private getCandidates(t: string, reading: string): number[] {
    const out: number[] = [];
    if (testWord(t, "kana")) {
      for (const id of this.lex.kana.withText(t)) {
        const seq = this.lex.kana.seq.get(id);
        if (this.lex.kana.ord.get(id) === 0 && this.lex.entries.get(seq)?.rootP && !this.lex.kanji.bySeq.get(seq).length)
          out.push(seq);
      }
    } else {
      for (const id of this.lex.kanji.withText(t)) {
        const seq = this.lex.kanji.seq.get(id);
        if (this.lex.kanji.ord.get(id) !== 0) continue;
        if (this.lex.kana.bySeq.get(seq).some((r) => this.lex.kana.ord.get(r) === 0 && this.lex.kana.textOf(r) === reading))
          out.push(seq);
      }
    }
    return out.sort((a, b) => a - b);
  }
  private matchGlosses(
    t: string,
    reading: string,
    words: string[],
    updateGloss: RegExp | null,
  ): [number | [number, string] | null, boolean] {
    const candidates = this.getCandidates(t, reading);
    if (!candidates.length) return [null, false];
    const nwords = words.map(normalizeGeo);
    for (const seq of candidates) {
      const glosses = (this.lex.senses.get(seq) ?? []).flatMap((s) => s.glosses).sort((a, b) => a.id - b.id);
      for (const g of glosses) {
        const ng = normalizeGeo(g.text);
        if (updateGloss && updateGloss.test(ng)) return [[seq, g.text], true];
        if (nwords.every((w) => ng.includes(w))) return [seq, true];
      }
    }
    return [candidates[0], false];
  }
}

interface Geo {
  kind: "muni" | "ward";
  text: string;
  type?: string;
  reading: string;
  definition: string;
  prefecture?: string | null;
  city?: string;
}
const TYPES: Record<string, string[]> = {
  都: ["ﾄ", "と"],
  道: ["ﾄﾞｳ", "どう"],
  府: ["ﾌ", "ふ"],
  県: ["ｹﾝ", "けん"],
  市: ["ｼ", "し"],
  町: ["ﾁｮｳ", "ﾏﾁ", "ちょう", "まち"],
  村: ["ｿﾝ", "ﾑﾗ", "そん", "むら"],
  区: ["ｸ", "く"],
};
const TYPE_DESCRIPTION: Record<string, string | null> = {
  都: "Metropolis",
  道: null,
  府: "Prefecture",
  県: "Prefecture",
  市: "(city)",
  町: "(town)",
  村: "(village)",
  区: "Ward",
};
function municipalityShort(t: string, reading: string): [string, string | null] {
  if (t.endsWith("道")) return [t, reading];
  const type = t.at(-1)!;
  const shortReading = (TYPES[type] ?? []).find((tp) => reading.endsWith(tp));
  return [t.slice(0, -1), shortReading === undefined ? null : reading.slice(0, reading.length - shortReading.length)];
}
function romanizeMunicipality(t: string, reading: string, includeType = true): string {
  const short = municipalityShort(t, reading)[1] ?? "";
  const desc = includeType ? TYPE_DESCRIPTION[t.at(-1)!] : null;
  return `${romanizeWordGeo(short)}${desc ? ` ${desc}` : ""}`;
}
function getWords(e: Geo): string[] {
  const name = e.definition.split(" ")[0];
  if (e.kind === "ward") return [name, "Ward", e.city!];
  let typeword = TYPE_DESCRIPTION[e.type!] ?? null;
  if (typeword?.endsWith(")")) typeword = typeword.slice(0, -1);
  return [name, typeword, e.prefecture ?? null].filter((x): x is string => x !== null);
}
function normalizeGeo(word: string): string {
  return word.toLowerCase().replaceAll("ū", "u").replaceAll("ō", "o");
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** as-xml-simple */
function asXmlSimple(t: string, reading: string, definition: string): Node {
  const el = (name: string, value: string, kids: Node[] = []): Node => ({ name, text: value, attrs: {}, children: kids });
  const kids: Node[] = [el("ent_seq", "")];
  if (testWord(t, "kana")) kids.push(el("r_ele", "", [el("reb", t)]));
  else kids.push(el("k_ele", "", [el("keb", t)]), el("r_ele", "", [el("reb", reading)]));
  kids.push(el("sense", "", [el("pos", "n"), el("gloss", definition)]));
  return el("entry", "", kids);
}
