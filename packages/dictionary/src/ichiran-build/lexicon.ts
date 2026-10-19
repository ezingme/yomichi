/** In-memory Ichiran data model and the build steps of Ichiran
 * dict-load.lisp (Timofei Shatrov, MIT), re-implemented for Yomichi.
 *
 * Tables mirror Ichiran's schema (entry, kanji_text, kana_text, sense, gloss,
 * sense_prop, restricted_readings, conjugation, conj_prop,
 * conj_source_reading). Large tables are columnar with interned strings, so
 * that the complete JMdict build (~25 million rows) fits in memory. */
import { testWord } from "../../../core/src/ichiran/chars.js";
import type { Node } from "../xml.js";
import { constructConjugation, CONJ_CAUSATIVE_SU, type ConjRule, type RuleTable } from "./conj-rules.js";

// ---------------------------------------------------------------------------
// Columnar storage helpers

class IntCol {
  data: Int32Array;
  length = 0;
  constructor(capacity = 1024) {
    this.data = new Int32Array(capacity);
  }
  push(v: number): number {
    if (this.length === this.data.length) {
      const next = new Int32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length] = v;
    return this.length++;
  }
  get(i: number): number {
    return this.data[i];
  }
  set(i: number, v: number): void {
    this.data[i] = v;
  }
}
export class StringPool {
  private ids = new Map<string, number>();
  strs: string[] = [];
  id(s: string): number {
    let i = this.ids.get(s);
    if (i === undefined) {
      i = this.strs.length;
      this.strs.push(s);
      this.ids.set(s, i);
    }
    return i;
  }
  find(s: string): number | undefined {
    return this.ids.get(s);
  }
  str(i: number): string {
    return this.strs[i];
  }
}
/** Multimap from integer key to a list of integer values. */
class Index {
  private m = new Map<number, number | number[]>();
  add(k: number, v: number): void {
    const cur = this.m.get(k);
    if (cur === undefined) this.m.set(k, v);
    else if (typeof cur === "number") this.m.set(k, [cur, v]);
    else cur.push(v);
  }
  get(k: number): number[] {
    const cur = this.m.get(k);
    return cur === undefined ? [] : typeof cur === "number" ? [cur] : cur;
  }
  remove(k: number, v: number): void {
    const cur = this.get(k).filter((x) => x !== v);
    if (!cur.length) this.m.delete(k);
    else this.m.set(k, cur.length === 1 ? cur[0] : cur);
  }
  keys(): IterableIterator<number> {
    return this.m.keys();
  }
}

export const NULL = -2147483648;
export type Table = "kanji" | "kana";

/** kanji_text or kana_text */
export class ReadingTable {
  seq = new IntCol(1 << 16);
  text = new IntCol(1 << 16);
  ord = new IntCol(1 << 16);
  common = new IntCol(1 << 16);
  commonTags = new IntCol(1 << 16);
  /** bit 0 conjugate_p, bit 1 nokanji, bit 2 deleted */
  flags = new IntCol(1 << 16);
  best = new IntCol(1 << 16);
  bySeq = new Index();
  byText = new Index();
  constructor(
    readonly name: Table,
    private pool: StringPool,
  ) {}
  get size(): number {
    return this.seq.length;
  }
  insert(seq: number, text: string, ord: number, common: number | null, opts: { tags?: string; conjugateP?: boolean; nokanji?: boolean } = {}): number {
    const t = this.pool.id(text);
    const id = this.seq.push(seq);
    this.text.push(t);
    this.ord.push(ord);
    this.common.push(common ?? NULL);
    this.commonTags.push(this.pool.id(opts.tags ?? ""));
    this.flags.push((opts.conjugateP ?? true ? 1 : 0) | (opts.nokanji ? 2 : 0));
    this.best.push(NULL);
    this.bySeq.add(seq, id);
    this.byText.add(t, id);
    return id;
  }
  live(id: number): boolean {
    return (this.flags.get(id) & 4) === 0;
  }
  delete(id: number): void {
    this.flags.set(id, this.flags.get(id) | 4);
    this.bySeq.remove(this.seq.get(id), id);
    this.byText.remove(this.text.get(id), id);
  }
  setText(id: number, text: string): void {
    this.byText.remove(this.text.get(id), id);
    const t = this.pool.id(text);
    this.text.set(id, t);
    this.byText.add(t, id);
  }
  textOf(id: number): string {
    return this.pool.str(this.text.get(id));
  }
  commonOf(id: number): number | null {
    const c = this.common.get(id);
    return c === NULL ? null : c;
  }
  bestOf(id: number): string | null {
    const b = this.best.get(id);
    return b === NULL ? null : this.pool.str(b);
  }
  setBest(id: number, text: string | null): void {
    this.best.set(id, text === null ? NULL : this.pool.id(text));
  }
  conjugateP(id: number): boolean {
    return (this.flags.get(id) & 1) !== 0;
  }
  nokanji(id: number): boolean {
    return (this.flags.get(id) & 2) !== 0;
  }
  setNokanji(id: number, v: boolean): void {
    this.flags.set(id, v ? this.flags.get(id) | 2 : this.flags.get(id) & ~2);
  }
  /** Live rows of a seq ordered by ord, then id. */
  ofSeq(seq: number): number[] {
    return this.bySeq
      .get(seq)
      .slice()
      .sort((a, b) => this.ord.get(a) - this.ord.get(b) || a - b);
  }
  withText(text: string): number[] {
    const t = this.pool.find(text);
    return t === undefined ? [] : this.byText.get(t);
  }
}

export interface Sense {
  id: number;
  ord: number;
  glosses: { id: number; text: string; ord: number }[];
  props: { id: number; tag: string; text: string; ord: number }[];
}
export interface EntryRec {
  rootP: boolean;
  nKanji: number;
  nKana: number;
  primaryNokanji: boolean;
  content: boolean;
}

export class Lexicon {
  pool = new StringPool();
  entries = new Map<number, EntryRec>();
  kanji = new ReadingTable("kanji", this.pool);
  kana = new ReadingTable("kana", this.pool);
  senses = new Map<number, Sense[]>();
  restricted = new Map<number, { id: number; reading: string; text: string }[]>();
  // conjugation
  conjSeq = new IntCol(1 << 16);
  conjFrom = new IntCol(1 << 16);
  conjVia = new IntCol(1 << 16);
  conjDeleted = new Set<number>();
  conjBySeq = new Index();
  conjByFrom = new Index();
  // conj_prop: type, pos (string id), neg/fml (0 false, 1 true, 2 null)
  propConj = new IntCol(1 << 16);
  propType = new IntCol(1 << 16);
  propPos = new IntCol(1 << 16);
  propNeg = new IntCol(1 << 16);
  propFml = new IntCol(1 << 16);
  propDeleted = new Set<number>();
  propByConj = new Index();
  // conj_source_reading
  csrConj = new IntCol(1 << 16);
  csrText = new IntCol(1 << 16);
  csrSource = new IntCol(1 << 16);
  csrDeleted = new Set<number>();
  csrByConj = new Index();
  nextIds = { sense: 0, gloss: 0, prop: 0, restricted: 0 };
  /** next-seq: generated entries start after the largest JMdict seq */
  maxSeq = 0;

  table(t: Table): ReadingTable {
    return t === "kanji" ? this.kanji : this.kana;
  }
  nextSeq(): number {
    return this.maxSeq + 1;
  }
  addEntry(seq: number, rec: Partial<EntryRec> = {}): EntryRec {
    const e: EntryRec = { rootP: false, nKanji: 0, nKana: 0, primaryNokanji: false, content: false, ...rec };
    this.entries.set(seq, e);
    if (seq > this.maxSeq) this.maxSeq = seq;
    return e;
  }
  deleteEntry(seq: number): void {
    for (const t of [this.kanji, this.kana]) for (const id of t.bySeq.get(seq)) t.delete(id);
    this.entries.delete(seq);
    this.senses.delete(seq);
    this.restricted.delete(seq);
    for (const c of [...this.conjBySeq.get(seq)]) this.deleteConj(c);
  }

  // conjugation rows
  addConj(seq: number, from: number, via: number | null): number {
    const id = this.conjSeq.push(seq);
    this.conjFrom.push(from);
    this.conjVia.push(via ?? NULL);
    this.conjBySeq.add(seq, id);
    this.conjByFrom.add(from, id);
    return id;
  }
  conjViaOf(id: number): number | null {
    const v = this.conjVia.get(id);
    return v === NULL ? null : v;
  }
  deleteConj(id: number): void {
    if (this.conjDeleted.has(id)) return;
    this.conjDeleted.add(id);
    this.conjBySeq.remove(this.conjSeq.get(id), id);
    this.conjByFrom.remove(this.conjFrom.get(id), id);
    for (const p of [...this.propByConj.get(id)]) {
      this.propDeleted.add(p);
      this.propByConj.remove(id, p);
    }
    for (const c of [...this.csrByConj.get(id)]) {
      this.csrDeleted.add(c);
      this.csrByConj.remove(id, c);
    }
  }
  addProp(conjId: number, type: number, pos: string, neg: boolean | null, fml: boolean | null): number {
    const id = this.propConj.push(conjId);
    this.propType.push(type);
    this.propPos.push(this.pool.id(pos));
    this.propNeg.push(neg === null ? 2 : neg ? 1 : 0);
    this.propFml.push(fml === null ? 2 : fml ? 1 : 0);
    this.propByConj.add(conjId, id);
    return id;
  }
  addCsr(conjId: number, text: string, source: string): number {
    const id = this.csrConj.push(conjId);
    this.csrText.push(this.pool.id(text));
    this.csrSource.push(this.pool.id(source));
    this.csrByConj.add(conjId, id);
    return id;
  }
  csrPairs(conjId: number): [string, string][] {
    return this.csrByConj.get(conjId).map((i) => [this.pool.str(this.csrText.get(i)), this.pool.str(this.csrSource.get(i))]);
  }
  posOf(seq: number): string[] {
    const out: string[] = [];
    for (const s of this.senses.get(seq) ?? [])
      for (const p of s.props) if (p.tag === "pos" && !out.includes(p.text)) out.push(p.text);
    return out;
  }
  /** get-all-readings */
  allReadings(seq: number): string[] {
    return [...this.kanji.bySeq.get(seq).map((i) => this.kanji.textOf(i)), ...this.kana.bySeq.get(seq).map((i) => this.kana.textOf(i))];
  }

  // -------------------------------------------------------------------------
  // load-entry (insert-readings, insert-senses)

  loadEntry(node: Node, opts: { seq?: number; rootP?: boolean } = {}): number {
    const seq = opts.seq ?? Number(text(child(node, "ent_seq")));
    this.addEntry(seq, { rootP: opts.rootP ?? true, content: true });
    this.insertReadings(seq, children(node, "k_ele"), "keb", "kanji", "ke_pri");
    this.insertReadings(seq, children(node, "r_ele"), "reb", "kana", "re_pri");
    const senses: Sense[] = [];
    children(node, "sense").forEach((sn, ord) => {
      const sense: Sense = { id: this.nextIds.sense++, ord, glosses: [], props: [] };
      children(sn, "gloss").forEach((g, gord) => sense.glosses.push({ id: this.nextIds.gloss++, text: text(g), ord: gord }));
      for (const tag of ["pos", "misc", "dial", "field", "s_inf", "stagk", "stagr"])
        children(sn, tag).forEach((p, pord) =>
          sense.props.push({ id: this.nextIds.prop++, tag, text: text(p), ord: pord }),
        );
      senses.push(sense);
    });
    this.senses.set(seq, senses);
    return seq;
  }
  private insertReadings(seq: number, nodes: Node[], tag: string, table: Table, pri: string): void {
    const toAdd: [string, number | null, boolean, string][] = [];
    let primaryNokanji = false;
    for (const n of nodes) {
      const readingText = text(child(n, tag));
      // upstream looks for re_inf in both element types
      if (children(n, "re_inf").some((x) => text(x) === "ok")) continue;
      const nokanji = children(n, "re_nokanji").length > 0;
      for (const r of children(n, "re_restr")) {
        const list = this.restricted.get(seq) ?? [];
        list.push({ id: this.nextIds.restricted++, reading: readingText, text: text(r) });
        this.restricted.set(seq, list);
      }
      let common: number | null = null;
      const tags: string[] = [];
      for (const p of children(n, pri)) {
        const t = text(p);
        tags.push(t);
        if (common === null) common = 0;
        if (t.startsWith("nf")) common = Number.parseInt(t.slice(2), 10);
      }
      toAdd.push([readingText, common, nokanji, tags.map((t) => `[${t}]`).join("")]);
    }
    toAdd.forEach(([t, common, nokanji, tags], ord) => {
      if (nokanji) primaryNokanji = true;
      this.table(table).insert(seq, t, ord, common, { nokanji, tags });
    });
    const e = this.entries.get(seq)!;
    e.primaryNokanji = primaryNokanji;
    if (table === "kana") e.nKana = toAdd.length;
    else e.nKanji = toAdd.length;
  }

  // -------------------------------------------------------------------------
  // Conjugations

  /** conjugate-entry-inner: (pos, conj) -> 2x2 matrix of candidate forms */
  private conjugateInner(seq: number, rules: RuleTable, opts: { conjTypes?: number[]; asPosi?: string[] }) {
    // upstream's SELECT DISTINCT over the (seq, tag, text) index yields sorted pos
    const posi = opts.asPosi ?? this.posOf(seq).sort();
    const matrix = new Map<string, { pos: string; conj: number; cells: [string, number, string, number, number][][] }>();
    const readings: [string, number, number][] = [];
    for (const id of this.kanji.bySeq.get(seq)) if (this.kanji.conjugateP(id)) readings.push([this.kanji.textOf(id), this.kanji.ord.get(id), 1]);
    for (const id of this.kana.bySeq.get(seq)) if (this.kana.conjugateP(id)) readings.push([this.kana.textOf(id), this.kana.ord.get(id), 0]);
    for (const pos of posi) {
      const posRules = rules.get(pos);
      if (!posRules || DO_NOT_CONJUGATE.includes(pos)) continue;
      for (const [reading, ord, kanjiFlag] of readings)
        for (const rule of posRules) {
          if (opts.conjTypes && !opts.conjTypes.includes(rule.conj)) continue;
          const key = `${pos}\u0000${rule.conj}`;
          let m = matrix.get(key);
          if (!m) {
            m = { pos, conj: rule.conj, cells: [[], [], [], []] };
            matrix.set(key, m);
          }
          m.cells[(rule.neg ? 2 : 0) + (rule.fml ? 1 : 0)].unshift([
            constructConjugation(reading, rule),
            kanjiFlag,
            reading,
            ord,
            rule.onum,
          ]);
        }
    }
    return matrix;
  }

  /** conjugate-entry-outer */
  conjugateEntry(seqStar: number, rules: RuleTable, opts: { via?: number; conjTypes?: number[]; asPosi?: string[] } = {}): void {
    const seq = opts.via ?? seqStar;
    const matrix = this.conjugateInner(seq, rules, opts);
    const original = new Set(this.allReadings(seq));
    for (const { pos, conj, cells } of matrix.values()) {
      const ignoreNeg = !cells[2].length && !cells[3].length;
      const ignoreFml = !cells[1].length && !cells[3].length;
      for (let ii = 0; ii < 4; ii++) {
        const neg = ii >= 2,
          fml = ii % 2 === 1;
        const readings = cells[ii].filter((r) => !original.has(r[0]));
        if (!readings.length) continue;
        this.insertConjugation(readings, {
          seq: this.nextSeq(),
          via: opts.via ?? null,
          from: seqStar,
          pos,
          conjType: conj,
          neg: ignoreNeg ? null : neg,
          fml: ignoreFml ? null : fml,
        });
      }
    }
  }

  /** insert-conjugation: returns true when a new entry was created */
  private insertConjugation(
    readings: [string, number, string, number, number][],
    o: { seq: number; via: number | null; from: number; pos: string; conjType: number; neg: boolean | null; fml: boolean | null },
  ): boolean {
    const sorted = readings
      .map((r, i) => [r, i] as const)
      .sort(([a, i], [b, j]) => a[3] - b[3] || a[4] - b[4] || i - j)
      .map(([r]) => r);
    const sourceReadings = sorted.map(([reading, , orig]) => [reading, orig] as [string, string]);
    // remove-duplicates keeps the last occurrence
    const dedupe = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x, i + 1) < 0);
    const kanjiReadings = dedupe(sorted.filter((r) => r[1] === 1).map((r) => r[0]));
    const kanaReadings = dedupe(sorted.filter((r) => r[1] === 0).map((r) => r[0]));
    if (!kanaReadings.length) return false;
    const candidates = this.seqCandidates(kanjiReadings, kanaReadings);
    if (candidates.includes(o.from) || (o.via !== null && candidates.includes(o.via))) return false;
    let seq = o.seq;
    if (candidates.length) seq = candidates[0];
    else {
      this.addEntry(seq);
      const conjugateP = SECONDARY_CONJUGATION_TYPES_FROM.includes(o.conjType);
      kanjiReadings.forEach((t, ord) => this.kanji.insert(seq, t, ord, null, { conjugateP }));
      kanaReadings.forEach((t, ord) => this.kana.insert(seq, t, ord, null, { conjugateP }));
    }
    const old = this.conjBySeq
      .get(seq)
      .find((c) => this.conjFrom.get(c) === o.from && this.conjViaOf(c) === o.via);
    const conjId = old ?? this.addConj(seq, o.from, o.via);
    const negV = o.neg === null ? 2 : o.neg ? 1 : 0,
      fmlV = o.fml === null ? 2 : o.fml ? 1 : 0;
    const pos = this.pool.id(o.pos);
    if (
      !this.propByConj
        .get(conjId)
        .some((p) => this.propType.get(p) === o.conjType && this.propPos.get(p) === pos && this.propNeg.get(p) === negV && this.propFml.get(p) === fmlV)
    )
      this.addProp(conjId, o.conjType, o.pos, o.neg, o.fml);
    const existing = new Set(this.csrPairs(conjId).map((p) => p.join("\u0000")));
    const added = new Set<string>();
    for (const [t, src] of sourceReadings) {
      const k = t + "\u0000" + src;
      if (existing.has(k) || added.has(k)) continue;
      added.add(k);
      this.addCsr(conjId, t, src);
    }
    return !candidates.length;
  }

  /** Entries containing all of the given readings (as upstream's SQL). */
  seqCandidates(kanjiReadings: string[], kanaReadings: string[]): number[] {
    const hasAll = (table: ReadingTable, seq: number, texts: string[]) => {
      const own = new Set(table.bySeq.get(seq).map((i) => table.textOf(i)));
      return texts.every((t) => own.has(t));
    };
    let seqs: Set<number>;
    if (kanjiReadings.length) {
      seqs = new Set(this.kanji.withText(kanjiReadings[0]).map((i) => this.kanji.seq.get(i)));
      seqs = new Set([...seqs].filter((s) => hasAll(this.kanji, s, kanjiReadings) && hasAll(this.kana, s, kanaReadings)));
    } else {
      seqs = new Set(this.kana.withText(kanaReadings[0]).map((i) => this.kana.seq.get(i)));
      seqs = new Set([...seqs].filter((s) => this.kanji.bySeq.get(s).length === 0 && hasAll(this.kana, s, kanaReadings)));
    }
    return [...seqs].sort((a, b) => a - b);
  }

  /** load-conjugations. Upstream iterates in database hash order; entries
   * are processed in ascending seq unless `order` (a ranking of seqs) is
   * given, which only matters where two entries generate identical forms. */
  loadConjugations(rules: RuleTable, order?: Map<number, number>): void {
    const seqs = [...this.senses.keys()]
      .filter((s) => !DO_NOT_CONJUGATE_SEQ.includes(s) && this.posOf(s).some((p) => POS_WITH_CONJ_RULES.includes(p)))
      .sort((a, b) => (order ? (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity) : 0) || a - b);
    for (const seq of seqs) this.conjugateEntry(seq, rules);
  }

  /** load-secondary-conjugations */
  loadSecondaryConjugations(rules: RuleTable, from?: number[]): void {
    const pairs = new Map<string, [number, number, number]>();
    for (let c = 0; c < this.conjSeq.length; c++) {
      if (this.conjDeleted.has(c) || this.conjViaOf(c) !== null) continue;
      const f = this.conjFrom.get(c);
      if (from && !from.includes(f)) continue;
      for (const p of this.propByConj.get(c)) {
        const type = this.propType.get(p);
        const pos = this.pool.str(this.propPos.get(p));
        if (!SECONDARY_CONJUGATION_TYPES_FROM.includes(type) || pos === "vs-i" || pos === "vs-s") continue;
        if (this.propNeg.get(p) === 1 || this.propFml.get(p) === 1) continue;
        const key = `${f}:${this.conjSeq.get(c)}`;
        if (!pairs.has(key)) pairs.set(key, [f, this.conjSeq.get(c), type]);
      }
    }
    const list = [...pairs.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [seqFrom, seq, type] of list)
      this.conjugateEntry(seqFrom, rules, {
        via: seq,
        asPosi: [type === CONJ_CAUSATIVE_SU ? "v5s" : "v1"],
        conjTypes: SECONDARY_CONJUGATION_TYPES,
      });
  }

  // -------------------------------------------------------------------------
  // Statistics and best readings

  recalcEntryStatsAll(): void {
    for (const [seq, e] of this.entries) {
      e.nKanji = this.kanji.bySeq.get(seq).length;
      e.nKana = this.kana.bySeq.get(seq).length;
    }
  }
  /** set-reading for one row */
  setReading(table: Table, id: number): void {
    const seq = (table === "kanji" ? this.kanji : this.kana).seq.get(id);
    const restricted = this.restricted.get(seq) ?? [];
    if (table === "kanji") {
      const ktext = this.kanji.textOf(id);
      for (const r of this.kana.ofSeq(seq)) {
        const rtext = this.kana.textOf(r);
        const restr = restricted.filter((x) => x.reading === rtext).map((x) => x.text);
        if (!this.kana.nokanji(r) && (!restr.length || restr.includes(ktext))) {
          this.kanji.setBest(id, rtext);
          return;
        }
      }
      this.kanji.setBest(id, null);
    } else {
      if (this.kana.nokanji(id)) return;
      const rtext = this.kana.textOf(id);
      const restr = restricted.filter((x) => x.reading === rtext).map((x) => x.text);
      const kanjiList = this.kanji.ofSeq(seq).filter((k) => !restr.length || restr.includes(this.kanji.textOf(k)));
      this.kana.setBest(id, kanjiList.length ? this.kanji.textOf(kanjiList[0]) : null);
    }
  }
  /** load-best-readings :reset t */
  loadBestReadings(): void {
    for (const t of [this.kanji, this.kana]) for (let i = 0; i < t.size; i++) t.best.set(i, NULL);
    for (const [seq, e] of this.entries) {
      if (!e.rootP) continue;
      for (const id of this.kanji.bySeq.get(seq)) this.setReading("kanji", id);
      for (const id of this.kana.bySeq.get(seq)) this.setReading("kana", id);
    }
  }
}

export const DO_NOT_CONJUGATE = ["n", "vs", "adj-na"];
export const DO_NOT_CONJUGATE_SEQ = [2765070, 2835284];
export const POS_WITH_CONJ_RULES = [
  "adj-i", "adj-ix", "cop-da", "v1", "v1-s", "v5aru",
  "v5b", "v5g", "v5k", "v5k-s", "v5m", "v5n", "v5r", "v5r-i", "v5s",
  "v5t", "v5u", "v5u-s", "vk", "vs-s", "vs-i",
];
export const SECONDARY_CONJUGATION_TYPES_FROM = [5, 6, 7, 8, CONJ_CAUSATIVE_SU];
export const SECONDARY_CONJUGATION_TYPES = [2, 3, 4, 9, 10, 11, 12, 13];

// ---------------------------------------------------------------------------
// XML helpers (node-text semantics)

export function children(n: Node, name: string): Node[] {
  return n.children.filter((c) => c.name === name);
}
export function child(n: Node, name: string): Node {
  const c = children(n, name)[0];
  if (!c) throw new Error(`missing <${name}>`);
  return c;
}
/** node-text: text content including descendants. */
export function text(n: Node): string {
  return n.text + n.children.map(text).join("");
}
export type { ConjRule };
export const isKanaText = (s: string) => testWord(s, "kana");
