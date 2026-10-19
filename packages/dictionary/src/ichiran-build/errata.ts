/** Applies Ichiran's add-errata operations (dict-errata.lisp, Timofei
 * Shatrov, MIT) to the in-memory model. Each helper mirrors the upstream
 * function of the same name, including its documented quirks. */
import { asHiragana, testWord } from "../../../core/src/ichiran/chars.js";
import { ICHIRAN_ERRATA, type ErrataOp } from "./errata-data.js";
import { NULL, type Lexicon, type ReadingTable, type Sense, type Table } from "./lexicon.js";
import type { RuleTable } from "./conj-rules.js";

const tableOf = (text: string): Table => (testWord(text, "kana") ? "kana" : "kanji");

export class Errata {
  constructor(
    private lex: Lexicon,
    private rules: RuleTable,
    private loadCustom: (keys: string[]) => void,
  ) {}

  applyAll(ops: ErrataOp[] = ICHIRAN_ERRATA): void {
    for (const op of ops) this.apply(op);
  }

  apply([name, ...a]: ErrataOp): void {
    const n = a as any[];
    switch (name) {
      case "conjugate-da":
        return this.conjugateDa();
      case "add-deha-ja-readings":
        return this.addDehaJaReadings();
      case "remove-hiragana-nokanji":
        return this.removeHiraganaNokanji();
      case "add-gozaimasu-conjs":
        return this.addGozaimasuConjs();
      case "set-primary-nokanji":
        return this.setPrimaryNokanji(n[0], n[1]);
      case "add-primary-nokanji":
        return this.addPrimaryNokanji(n[0], n[1]);
      case "delete-reading":
        return this.deleteReading(n[0], n[1], n[2]?.table);
      case "add-reading":
        return this.addReading(n[0], n[1], n[2] ?? {});
      case "set-common":
        return this.setCommon(n[0], n[1], n[2], n[3]);
      case "delete-sense-prop":
        return this.deleteSenseProp(n[0], n[1], n[2]);
      case "add-sense-prop":
        return this.addSenseProp(n[0], n[1], n[2], n[3]);
      case "add-new-sense*":
        return this.addNewSense(n[0], [n[1]], n.slice(2));
      case "add-conj-reading":
        return this.addConjReading(n[0], n[1]);
      case "rearrange-readings-conj":
        return this.rearrangeReadingsConj(n[0], n[1], n[2]);
      case "delete-conjugation":
        return this.deleteConjugation(n[0], n[1], n[2] ?? null);
      case "replace-reading":
        return this.replaceReading(n[0], n[1], n[2]);
      case "replace-reading-conj":
        return this.replaceReadingConj(n[0], n[1], n[2], n[3]);
      case "add-gloss":
        return this.addGloss(n[0], n[1], n.slice(2));
      case "delete-senses":
        return this.deleteSenses(n[0], n[1], n[2]);
      case "set-root-p": {
        const e = this.lex.entries.get(n[0]);
        if (e) e.rootP = n[1];
        return;
      }
      case "set-reading-kanji":
        for (const id of this.lex.kanji.bySeq.get(n[0])) this.lex.setReading("kanji", id);
        return;
      case "load-custom-data":
        return this.loadCustom(n[0]);
      default:
        throw new Error(`Unknown errata operation ${name}`);
    }
  }

  private t(table: Table): ReadingTable {
    return this.lex.table(table);
  }
  private sensesOf(seq: number): Sense[] {
    return this.lex.senses.get(seq) ?? [];
  }
  private conjSeqsFrom(seq: number): number[] {
    return [...new Set(this.lex.conjByFrom.get(seq).map((c) => this.lex.conjSeq.get(c)))];
  }

  resetReadings(...seqs: number[]): void {
    for (const seq of seqs) {
      for (const id of this.lex.kana.bySeq.get(seq)) this.lex.setReading("kana", id);
      for (const id of this.lex.kanji.bySeq.get(seq)) this.lex.setReading("kanji", id);
    }
  }

  addReading(seq: number, reading: string, o: { common?: number | null; "conjugate-p"?: boolean; table?: Table }): void {
    const table = o.table ?? tableOf(reading);
    const t = this.t(table);
    const entry = this.lex.entries.get(seq);
    if (t.bySeq.get(seq).some((id) => t.textOf(id) === reading)) return;
    const ords = t.bySeq.get(seq).map((id) => t.ord.get(id));
    const ord = ords.length ? Math.max(...ords) + 1 : 0;
    t.insert(seq, reading, ord, o.common ?? null, { conjugateP: o["conjugate-p"] ?? true });
    if (entry) {
      if (table === "kana") entry.nKana++;
      else entry.nKanji++;
    }
  }
  replaceReading(seq: number, from: string, to: string): void {
    const t = this.t(tableOf(from));
    const rows = t.bySeq.get(seq).filter((id) => t.textOf(id) === from);
    for (const id of rows) t.setText(id, to);
    if (rows.length) this.resetReadings(seq);
  }
  /** Upstream's query compares the seq argument with itself, so the prefix is
   * replaced in every row of the table, not only in `seq` and its forms. */
  replaceReadingConj(_seq: number, table: Table, prefixFrom: string, prefixTo: string): void {
    const t = this.t(table);
    const touched = new Set<number>();
    for (let id = 0; id < t.size; id++) {
      if (!t.live(id)) continue;
      const text = t.textOf(id);
      if (!text.startsWith(prefixFrom)) continue;
      t.setText(id, prefixTo + text.slice(prefixFrom.length));
      touched.add(t.seq.get(id));
    }
    if (touched.size) this.resetReadings(...touched);
  }
  deleteReading(seq: number, reading: string, table?: Table): void {
    const tbl = table ?? tableOf(reading);
    const t = this.t(tbl);
    const rows = t.bySeq.get(seq).filter((id) => t.textOf(id) === reading);
    if (!rows.length) return;
    for (const id of rows) t.delete(id);
    const entry = this.lex.entries.get(seq);
    if (entry) {
      if (tbl === "kana") entry.nKana -= rows.length;
      else entry.nKanji -= rows.length;
    }
    t.ofSeq(seq).forEach((id, ord) => t.ord.set(id, ord));
    this.resetReadings(seq);
  }
  addConjReading(seq: number, reading: string): void {
    const table = tableOf(reading);
    const t = this.t(table);
    const base = t.bySeq.get(seq).find((id) => t.ord.get(id) === 0);
    if (base === undefined) return;
    const baseText = t.textOf(base);
    const diff = rootDiffFn(baseText, reading);
    for (const conj of [...this.lex.conjByFrom.get(seq)].sort((x, y) => x - y)) {
      const cseq = this.lex.conjSeq.get(conj);
      const entry = this.lex.entries.get(cseq);
      const b = t.bySeq.get(cseq).find((id) => t.ord.get(id) === 0);
      if (b === undefined) continue;
      const bText = t.textOf(b);
      const newText = diff(bText);
      if (t.bySeq.get(cseq).some((id) => t.textOf(id) === newText)) continue;
      const maxord = Math.max(...t.bySeq.get(cseq).map((id) => t.ord.get(id)));
      const src = this.lex.csrPairs(conj).find(([txt]) => txt === bText)?.[1];
      // upstream uses the current maximum, so the new row shares an ord
      t.insert(cseq, newText, maxord, null, { conjugateP: t.conjugateP(b) });
      if (src !== undefined) this.lex.addCsr(conj, newText, diff(src));
      if (entry) {
        if (table === "kana") entry.nKana++;
        else entry.nKanji++;
      }
    }
  }
  deleteSenses(seq: number, tag: string | null, text: string | null): void {
    const senses = this.sensesOf(seq);
    const ids = new Set(
      senses.filter((s) => s.props.some((p) => tag === null || (p.tag === tag && p.text === text))).map((s) => s.id),
    );
    this.lex.senses.set(
      seq,
      senses.filter((s) => !ids.has(s.id)),
    );
  }
  deleteSenseProp(seq: number, tag: string, text: string): void {
    for (const s of this.sensesOf(seq)) s.props = s.props.filter((p) => !(p.tag === tag && p.text === text));
  }
  addSenseProp(seq: number, senseOrd: number, tag: string, text: string): void {
    const sense = this.sensesOf(seq).find((s) => s.ord === senseOrd);
    if (!sense || sense.props.some((p) => p.tag === tag && p.text === text)) return;
    sense.props.push({ id: this.lex.nextIds.prop++, tag, text, ord: 0 });
  }
  /** add-new-sense, using get-senses-raw semantics for the existence check. */
  addNewSense(seq: number, positions: string[], glosses: string[]): void {
    const raw = sensesRaw(this.sensesOf(seq));
    const glossStr = glosses.join("; ");
    let rpos: string[] | undefined;
    for (const s of raw) {
      rpos = s.pos ?? rpos;
      if (JSON.stringify(rpos) === JSON.stringify(positions) && glossStr === s.gloss) return;
    }
    const senses = this.sensesOf(seq);
    const last = raw.at(-1);
    const ord = (last?.ord ?? -1) + 1;
    const lastPos = [...raw].reverse().find((s) => s.pos)?.pos;
    const sense: Sense = { id: this.lex.nextIds.sense++, ord, glosses: [], props: [] };
    glosses.forEach((g, gord) => sense.glosses.push({ id: this.lex.nextIds.gloss++, text: g, ord: gord }));
    if (JSON.stringify(lastPos) !== JSON.stringify(positions))
      positions.forEach((p, sord) => sense.props.push({ id: this.lex.nextIds.prop++, tag: "pos", text: p, ord: sord }));
    senses.push(sense);
    this.lex.senses.set(seq, senses);
  }
  addGloss(seq: number, ord: number, texts: string[]): void {
    const sense = this.sensesOf(seq).find((s) => s.ord === ord);
    if (!sense) return;
    let max = sense.glosses.length ? Math.max(...sense.glosses.map((g) => g.ord)) + 1 : 0;
    for (const t of texts)
      if (!sense.glosses.some((g) => g.text === t)) sense.glosses.push({ id: this.lex.nextIds.gloss++, text: t, ord: max++ });
  }
  setCommon(table: Table, seq: number, text: string, common: number | null): void {
    const t = this.t(table);
    for (const id of t.bySeq.get(seq)) if (t.textOf(id) === text) t.common.set(id, common ?? NULL);
  }
  addDehaJaReadings(): void {
    const kana = this.lex.kana;
    const pairs = new Map<string, [number, string]>();
    for (const c of this.lex.conjByFrom.get(2089020)) {
      const cseq = this.lex.conjSeq.get(c);
      for (const id of kana.bySeq.get(cseq)) {
        const t = kana.textOf(id);
        if (t.startsWith("では")) pairs.set(`${cseq}\u0000${t}`, [cseq, t]);
      }
    }
    for (const [cseq, deha] of pairs.values()) this.addReading(cseq, "じゃ" + deha.slice(2), {});
    for (const c of this.lex.conjByFrom.get(2089020))
      for (const [text, source] of this.lex.csrPairs(c)) {
        if (!text.startsWith("では")) continue;
        const ja = "じゃ" + text.slice(2);
        if (this.lex.csrPairs(c).some(([t, s]) => t === ja && s === source)) continue;
        this.lex.addCsr(c, ja, source.startsWith("では") ? "じゃ" + source.slice(2) : source);
      }
  }
  deleteConjugation(seq: number, from: number, via: number | null): void {
    const conjs = this.lex.conjBySeq.get(seq).filter((c) => this.lex.conjFrom.get(c) === from && this.lex.conjViaOf(c) === via);
    if (!conjs.length) return;
    const entry = this.lex.entries.get(seq);
    const others = this.lex.conjBySeq.get(seq).filter((c) => !conjs.includes(c));
    const deleteEntry = !(entry?.rootP || others.length);
    for (const c of conjs) this.lex.deleteConj(c);
    if (deleteEntry) this.lex.deleteEntry(seq);
  }
  removeHiraganaNokanji(): void {
    const kana = this.lex.kana;
    for (let id = 0; id < kana.size; id++)
      if (kana.live(id) && kana.nokanji(id) && testWord(kana.textOf(id), "hiragana")) {
        const e = this.lex.entries.get(kana.seq.get(id));
        if (e?.primaryNokanji) e.primaryNokanji = false;
      }
  }
  setPrimaryNokanji(seq: number, value: boolean): void {
    const e = this.lex.entries.get(seq);
    if (e) e.primaryNokanji = value;
  }
  addPrimaryNokanji(seq: number, reading: string): void {
    this.setPrimaryNokanji(seq, true);
    for (const id of this.lex.kana.bySeq.get(seq)) if (this.lex.kana.textOf(id) === reading) this.lex.kana.setNokanji(id, true);
  }
  rearrangeReadings(seq: number, table: Table, prefix: string): void {
    const t = this.t(table);
    const rows = t.ofSeq(seq);
    const offset = rows.filter((id) => t.textOf(id).startsWith(prefix)).length;
    let c1 = -1,
      c2 = offset - 1;
    for (const id of rows) t.ord.set(id, t.textOf(id).startsWith(prefix) ? ++c1 : ++c2);
  }
  rearrangeReadingsConj(seq: number, table: Table, prefix: string): void {
    this.rearrangeReadings(seq, table, prefix);
    for (const s of this.conjSeqsFrom(seq)) this.rearrangeReadings(s, table, prefix);
  }
  addGozaimasuConjs(): void {
    for (const seq of [1612690, 2253080]) {
      const readings = [...new Set(this.lex.allReadings(seq))];
      const pos = seq === 2253080 ? "cop" : "exp";
      const forms: [[number, boolean | null, boolean | null], string][] = [
        [[1, true, null], "せん"],
        [[2, null, null], "した"],
        [[3, null, null], "して"],
        [[9, null, null], "しょう"],
        [[11, null, null], "したら"],
        [[12, null, null], "したり"],
      ];
      for (const [[conj, neg, fml], suf] of forms)
        this.addConj(seq, conj, pos, neg, fml, readings.map((r) => [r, r.slice(0, -1) + suf] as [string, string]));
    }
  }
  private addConj(from: number, type: number, pos: string, neg: boolean | null, fml: boolean | null, map: [string, string][]): void {
    const exists = this.lex.conjByFrom.get(from).some((c) =>
      this.lex.propByConj.get(c).some(
        (p) =>
          this.lex.propType.get(p) === type &&
          this.lex.pool.str(this.lex.propPos.get(p)) === pos &&
          this.lex.propNeg.get(p) === (neg === null ? 2 : neg ? 1 : 0) &&
          this.lex.propFml.get(p) === (fml === null ? 2 : fml ? 1 : 0),
      ),
    );
    if (exists) return;
    const seq = this.lex.nextSeq();
    this.lex.addEntry(seq);
    let ordR = 0,
      ordK = 0;
    for (const [, reading] of map) {
      const isKana = testWord(reading, "kana");
      this.t(isKana ? "kana" : "kanji").insert(seq, reading, isKana ? ordR++ : ordK++, null);
    }
    const conj = this.lex.addConj(seq, from, null);
    this.lex.addProp(conj, type, pos, neg, fml);
    for (const [src, reading] of map) this.lex.addCsr(conj, reading, src);
  }
  conjugateDa(seq = 2089020): void {
    const senses = this.sensesOf(seq);
    if (senses.some((s) => s.props.some((p) => p.tag === "pos" && p.text === "cop-da"))) return;
    this.addSenseProp(seq, 0, "pos", "cop-da");
    this.lex.conjugateEntry(seq, this.rules);
  }
}

/** get-senses-raw reduced to what add-new-sense inspects. */
function sensesRaw(senses: Sense[]): { ord: number; gloss: string; pos?: string[] }[] {
  const list = [...senses].sort((a, b) => a.ord - b.ord);
  // reproduce the final-group reversal of get-senses-raw for pos lists
  const groups: { ord: number; tag: string; texts: string[] }[] = [];
  for (const s of list)
    for (const tag of ["field", "pos", "s_inf", "stagk", "stagr"]) {
      const ps = s.props.filter((p) => p.tag === tag).sort((a, b) => a.ord - b.ord || a.id - b.id);
      if (ps.length) groups.push({ ord: s.ord, tag, texts: ps.map((p) => p.text) });
    }
  if (groups.length) groups[groups.length - 1].texts.reverse();
  return list.map((s) => ({
    ord: s.ord,
    gloss: [...s.glosses].sort((a, b) => a.ord - b.ord).map((g) => g.text).join("; "),
    pos: groups.find((g) => g.ord === s.ord && g.tag === "pos")?.texts,
  }));
}

/** root-diff / root-diff-fn */
function rootDiffFn(baseText: string, reading: string): (text: string) => string {
  const lb = baseText.length,
    lr = reading.length;
  let b: number, r: number;
  let ib = lb - 1,
    ir = lr - 1;
  for (;;) {
    if (ib < 0 || ir < 0) {
      [b, r] = lr >= lb ? [0, lr - lb] : [lb - lr, 0];
      break;
    }
    if (baseText[ib] !== reading[ir]) {
      [b, r] = [ib + 1, ir + 1];
      break;
    }
    ib--;
    ir--;
  }
  return (text) => reading.slice(0, r) + text.slice(b);
}
export { asHiragana };
