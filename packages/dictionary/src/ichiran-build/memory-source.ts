/** IchiranSource over an in-memory Lexicon (tests, evaluation, export). */
import type {
  IchiranSource,
  KanjiReadingRow,
  ReadingRow,
  SeqBundle,
} from "../../../core/src/ichiran/store.js";
import type { Lexicon, ReadingTable } from "./lexicon.js";

export class MemoryIchiranSource implements IchiranSource {
  constructor(
    readonly lex: Lexicon,
    private kanji: Map<string, KanjiReadingRow[]> = new Map(),
    private label = "memory",
  ) {}
  async version(): Promise<string> {
    return this.label;
  }
  row(t: ReadingTable, id: number): ReadingRow {
    return {
      table: t.name,
      id,
      seq: t.seq.get(id),
      text: t.textOf(id),
      ord: t.ord.get(id),
      common: t.commonOf(id),
      commonTags: this.lex.pool.str(t.commonTags.get(id)),
      conjugateP: t.conjugateP(id),
      nokanji: t.nokanji(id),
      best: t.bestOf(id),
      phys: id,
    };
  }
  async fetchTexts(texts: string[]): Promise<ReadingRow[]> {
    const out: ReadingRow[] = [];
    for (const t of texts)
      for (const table of [this.lex.kana, this.lex.kanji]) for (const id of table.withText(t)) out.push(this.row(table, id));
    return out;
  }
  bundle(seq: number): SeqBundle | null {
    const lex = this.lex;
    const e = lex.entries.get(seq);
    if (!e) return null;
    const senses = lex.senses.get(seq) ?? [];
    const conjIds = lex.conjBySeq.get(seq);
    return {
      entry: { seq, rootP: e.rootP, nKanji: e.nKanji, nKana: e.nKana, primaryNokanji: e.primaryNokanji },
      readings: [
        ...lex.kana.bySeq.get(seq).map((id) => this.row(lex.kana, id)),
        ...lex.kanji.bySeq.get(seq).map((id) => this.row(lex.kanji, id)),
      ],
      senses: senses.map((s) => ({ id: s.id, seq, ord: s.ord })),
      props: senses.flatMap((s) => s.props.map((p) => ({ id: p.id, senseId: s.id, seq, tag: p.tag, text: p.text, ord: p.ord }))),
      glosses: senses.flatMap((s) => s.glosses.map((g) => ({ senseId: s.id, text: g.text, ord: g.ord }))),
      conjugations: conjIds.map((c) => ({ id: c, seq, from: lex.conjFrom.get(c), via: lex.conjViaOf(c) })),
      conjProps: conjIds.flatMap((c) =>
        lex.propByConj.get(c).map((p) => {
          const tri = (v: number) => (v === 2 ? null : v === 1);
          return {
            id: p,
            conjId: c,
            conjType: lex.propType.get(p),
            pos: lex.pool.str(lex.propPos.get(p)),
            neg: tri(lex.propNeg.get(p)),
            fml: tri(lex.propFml.get(p)),
          };
        }),
      ),
      conjSources: conjIds.flatMap((c) =>
        lex.csrByConj.get(c).map((i) => ({
          id: i,
          conjId: c,
          text: lex.pool.str(lex.csrText.get(i)),
          sourceText: lex.pool.str(lex.csrSource.get(i)),
        })),
      ),
      restricted: (lex.restricted.get(seq) ?? []).map((r) => ({ reading: r.reading, text: r.text })),
      derived: [...new Set(lex.conjByFrom.get(seq).map((c) => lex.conjSeq.get(c)))].sort((a, b) => a - b),
    };
  }
  async fetchSeqs(seqs: number[]): Promise<SeqBundle[]> {
    return seqs.flatMap((s) => {
      const b = this.bundle(s);
      return b ? [b] : [];
    });
  }
  async fetchKanjiReadings(chars: string[]): Promise<Map<string, KanjiReadingRow[]>> {
    return new Map(chars.map((c) => [c, this.kanji.get(c) ?? []]));
  }
  async fetchCounterSeqs(): Promise<number[]> {
    const out: number[] = [];
    for (const [seq, senses] of this.lex.senses)
      if (senses.some((s) => s.props.some((p) => p.tag === "pos" && p.text === "ctr"))) out.push(seq);
    return out;
  }
}
