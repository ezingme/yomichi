/** IchiranSource over PostgreSQL tables with Ichiran's schema. `tables`
 * selects the physical table names; `dataset` adds a dataset_id filter for
 * Yomichi-managed snapshots (null for a plain Ichiran database). */
import type { KanjiInfo } from "../../core/src/ichiran/output.js";
import type {
  IchiranSource,
  KanjiReadingRow,
  ReadingRow,
  SeqBundle,
} from "../../core/src/ichiran/store.js";
import type { Sql } from "./schema.js";

export interface IchiranTables {
  entry: string;
  kanji: string;
  kana: string;
  sense: string;
  senseProp: string;
  gloss: string;
  conjugation: string;
  conjProp: string;
  conjSource: string;
  restricted: string;
  kanjiChar: string;
  kanjiReading: string;
  okurigana: string;
  meaning: string;
}
export const ICHIRAN_UPSTREAM_TABLES: IchiranTables = {
  entry: "entry",
  kanji: "kanji_text",
  kana: "kana_text",
  sense: "sense",
  senseProp: "sense_prop",
  gloss: "gloss",
  conjugation: "conjugation",
  conjProp: "conj_prop",
  conjSource: "conj_source_reading",
  restricted: "restricted_readings",
  kanjiChar: "kanji",
  kanjiReading: "reading",
  okurigana: "okurigana",
  meaning: "meaning",
};

/** "(block,offset)" -> sortable number mirroring heap scan order. */
function ctidOrder(ctid: string): number {
  const m = /\((\d+),(\d+)\)/.exec(ctid);
  return m ? Number(m[1]) * 65536 + Number(m[2]) : 0;
}

export class PgIchiranSource implements IchiranSource {
  /** Row order column: heap order of an upstream database, or `phys`. */
  private order: string;
  constructor(
    private db: Sql,
    private tables: IchiranTables = ICHIRAN_UPSTREAM_TABLES,
    private dataset: string | null = null,
    private label = "ichiran-database",
  ) {
    this.order = dataset === null ? "ctid" : "phys";
  }
  private ds(alias = ""): string {
    return this.dataset === null ? "TRUE" : `${alias}dataset_id=$2`;
  }
  private params(first: unknown): unknown[] {
    return this.dataset === null ? [first] : [first, this.dataset];
  }
  async version(): Promise<string> {
    return this.label + (this.dataset ? ":" + this.dataset : "");
  }
  async fetchTexts(texts: string[]): Promise<ReadingRow[]> {
    if (!texts.length) return [];
    const t = this.tables;
    const q = (table: string, kind: string, best: string) =>
      `SELECT '${kind}' AS kind, id, seq, text, ord, common, common_tags, conjugate_p, nokanji, ${best} AS best, ${this.order === "ctid" ? "ctid::text" : "phys"} AS ctid FROM ${table} WHERE text = ANY($1::text[]) AND ${this.ds()}`;
    const r = await this.db.query(
      `${q(t.kana, "kana", "best_kanji")} UNION ALL ${q(t.kanji, "kanji", "best_kana")}`,
      this.params(texts),
    );
    return r.rows.map(toReading);
  }
  async fetchSeqs(seqs: number[]): Promise<SeqBundle[]> {
    if (!seqs.length) return [];
    const t = this.tables;
    const p = this.params(seqs);
    const ds = this.ds();
    const [entries, kana, kanji, senses, props, conjs, derived, restricted, glosses] = await Promise.all([
      this.db.query(`SELECT seq, root_p, n_kanji, n_kana, primary_nokanji FROM ${t.entry} WHERE seq = ANY($1::int[]) AND ${ds}`, p),
      this.db.query(`SELECT 'kana' AS kind, id, seq, text, ord, common, common_tags, conjugate_p, nokanji, best_kanji AS best, ${this.order === "ctid" ? "ctid::text" : "phys"} AS ctid FROM ${t.kana} WHERE seq = ANY($1::int[]) AND ${ds}`, p),
      this.db.query(`SELECT 'kanji' AS kind, id, seq, text, ord, common, common_tags, conjugate_p, nokanji, best_kana AS best, ${this.order === "ctid" ? "ctid::text" : "phys"} AS ctid FROM ${t.kanji} WHERE seq = ANY($1::int[]) AND ${ds}`, p),
      this.db.query(`SELECT id, seq, ord FROM ${t.sense} WHERE seq = ANY($1::int[]) AND ${ds} ORDER BY id`, p),
      this.db.query(`SELECT id, sense_id, seq, tag, text, ord FROM ${t.senseProp} WHERE seq = ANY($1::int[]) AND ${ds} ORDER BY id`, p),
      this.db.query(`SELECT id, seq, "from", via FROM ${t.conjugation} WHERE seq = ANY($1::int[]) AND ${ds} ORDER BY id`, p),
      this.db.query(`SELECT DISTINCT "from", seq FROM ${t.conjugation} WHERE "from" = ANY($1::int[]) AND ${ds}`, p),
      this.db.query(`SELECT seq, reading, text FROM ${t.restricted} WHERE seq = ANY($1::int[]) AND ${ds} ORDER BY id`, p),
      this.db.query(
        `SELECT s.seq, g.sense_id, g.text, g.ord FROM ${t.gloss} g JOIN ${t.sense} s ON s.id = g.sense_id${this.dataset === null ? "" : " AND s.dataset_id = g.dataset_id"} WHERE s.seq = ANY($1::int[]) AND ${this.ds("g.")} ORDER BY g.id`,
        p,
      ),
    ]);
    const conjIds = conjs.rows.map((c: any) => c.id);
    const cp = this.params(conjIds);
    const [conjProps, conjSources] = conjIds.length
      ? await Promise.all([
          this.db.query(`SELECT id, conj_id, conj_type, pos, neg, fml FROM ${t.conjProp} WHERE conj_id = ANY($1::int[]) AND ${ds} ORDER BY id`, cp),
          this.db.query(`SELECT id, conj_id, text, source_text FROM ${t.conjSource} WHERE conj_id = ANY($1::int[]) AND ${ds} ORDER BY id`, cp),
        ])
      : [{ rows: [] }, { rows: [] }];
    const by = <T>(rows: T[], key: (r: T) => number) => {
      const m = new Map<number, T[]>();
      for (const r of rows) {
        const k = key(r);
        const b = m.get(k);
        if (b) b.push(r);
        else m.set(k, [r]);
      }
      return m;
    };
    const readings = by([...kana.rows, ...kanji.rows].map(toReading), (r) => r.seq);
    const senseBy = by(senses.rows as any[], (r) => r.seq);
    const propBy = by(props.rows as any[], (r) => r.seq);
    const conjBy = by(conjs.rows as any[], (r) => r.seq);
    const conjSeq = new Map<number, number>(conjs.rows.map((c: any) => [c.id, c.seq]));
    const cpBy = by(conjProps.rows as any[], (r) => conjSeq.get(r.conj_id)!);
    const csBy = by(conjSources.rows as any[], (r) => conjSeq.get(r.conj_id)!);
    const derivedBy = by(derived.rows as any[], (r) => r.from);
    const restrictedBy = by(restricted.rows as any[], (r) => r.seq);
    const glossBy = by(glosses.rows as any[], (r) => r.seq);
    return entries.rows.map((e: any): SeqBundle => ({
      entry: {
        seq: e.seq,
        rootP: e.root_p,
        nKanji: e.n_kanji,
        nKana: e.n_kana,
        primaryNokanji: e.primary_nokanji,
      },
      readings: readings.get(e.seq) ?? [],
      senses: (senseBy.get(e.seq) ?? []).map((s: any) => ({ id: s.id, seq: s.seq, ord: s.ord })),
      props: (propBy.get(e.seq) ?? []).map((s: any) => ({
        id: s.id,
        senseId: s.sense_id,
        seq: s.seq,
        tag: s.tag,
        text: s.text,
        ord: s.ord,
      })),
      conjugations: (conjBy.get(e.seq) ?? []).map((c: any) => ({ id: c.id, seq: c.seq, from: c.from, via: c.via })),
      conjProps: (cpBy.get(e.seq) ?? []).map((c: any) => ({
        id: c.id,
        conjId: c.conj_id,
        conjType: c.conj_type,
        pos: c.pos,
        neg: c.neg,
        fml: c.fml,
      })),
      conjSources: (csBy.get(e.seq) ?? []).map((c: any) => ({
        id: c.id,
        conjId: c.conj_id,
        text: c.text,
        sourceText: c.source_text,
      })),
      restricted: (restrictedBy.get(e.seq) ?? []).map((r: any) => ({ reading: r.reading, text: r.text })),
      glosses: (glossBy.get(e.seq) ?? []).map((g: any) => ({ senseId: g.sense_id, text: g.text, ord: g.ord })),
      derived: (derivedBy.get(e.seq) ?? []).map((d: any) => d.seq).sort((a: number, b: number) => a - b),
    }));
  }
  async fetchKanjiReadings(chars: string[]): Promise<Map<string, KanjiReadingRow[]>> {
    const out = new Map<string, KanjiReadingRow[]>();
    if (!chars.length) return out;
    const r = await this.db.query(
      `SELECT k.text AS kanji, r.text, r.type FROM ${this.tables.kanjiChar} k JOIN ${this.tables.kanjiReading} r ON r.kanji_id = k.id WHERE k.text = ANY($1::text[]) AND ${this.dataset === null ? "TRUE" : "k.dataset_id=$2 AND r.dataset_id=$2"} ORDER BY r.${this.order}`,
      this.params(chars),
    );
    for (const row of r.rows as any[]) {
      const list = out.get(row.kanji) ?? [];
      list.push({ text: row.text, type: row.type });
      out.set(row.kanji, list);
    }
    return out;
  }
  /** One KANJIDIC character with readings, okurigana and meanings (kanji.lisp). */
  async fetchKanjiInfo(char: string): Promise<KanjiInfo | null> {
    const t = this.tables;
    const ds = (a: string) => (this.dataset === null ? "TRUE" : `${a}.dataset_id=$2`);
    const k = (
      await this.db.query(
        `SELECT id, text, radical_c, radical_n, grade, strokes, freq, stat_common, stat_irregular FROM ${t.kanjiChar} k WHERE text=$1 AND ${ds("k")} LIMIT 1`,
        this.params(char),
      )
    ).rows[0] as any;
    if (!k) return null;
    const p = this.params(k.id);
    // physical order for upstream tables, id order for Yomichi snapshots
    const ord = (col: string) => (this.dataset === null ? "ctid" : col);
    const [readings, okuri, meanings] = await Promise.all([
      this.db.query(`SELECT id, type, text, suffixp, prefixp, stat_common FROM ${t.kanjiReading} r WHERE kanji_id=$1 AND ${ds("r")} ORDER BY ${ord("phys")}`, p),
      this.db.query(
        `SELECT o.reading_id, o.text FROM ${t.okurigana} o JOIN ${t.kanjiReading} r ON r.id=o.reading_id${this.dataset === null ? "" : " AND r.dataset_id=o.dataset_id"} WHERE r.kanji_id=$1 AND ${ds("o")} ORDER BY o.${ord("id")}`,
        p,
      ),
      this.db.query(`SELECT text FROM ${t.meaning} m WHERE kanji_id=$1 AND ${ds("m")} ORDER BY ${ord("id")}`, p),
    ]);
    return {
      text: k.text,
      radicalC: k.radical_c,
      radicalN: k.radical_n,
      grade: k.grade,
      strokes: k.strokes,
      freq: k.freq,
      statCommon: k.stat_common,
      statIrregular: k.stat_irregular,
      readings: readings.rows.map((r: any) => ({
        type: r.type,
        text: r.text,
        suffixp: r.suffixp,
        prefixp: r.prefixp,
        statCommon: r.stat_common,
        okurigana: okuri.rows.filter((o: any) => o.reading_id === r.id).map((o: any) => o.text),
      })),
      meanings: meanings.rows.map((m: any) => m.text),
    };
  }
  async fetchCounterSeqs(): Promise<number[]> {
    const r = await this.db.query(
      `SELECT DISTINCT seq FROM ${this.tables.senseProp} WHERE tag='pos' AND text='ctr' AND ${this.dataset === null ? "TRUE" : "dataset_id=$1"}`,
      this.dataset === null ? [] : [this.dataset],
    );
    return r.rows.map((x: any) => x.seq);
  }
}

function toReading(r: any): ReadingRow {
  return {
    table: r.kind,
    id: r.id,
    seq: r.seq,
    text: r.text,
    ord: r.ord,
    common: r.common,
    commonTags: r.common_tags ?? "",
    conjugateP: r.conjugate_p,
    nokanji: r.nokanji,
    best: r.best,
    phys: typeof r.ctid === "number" ? r.ctid : r.ctid ? ctidOrder(r.ctid) : r.id,
  };
}
