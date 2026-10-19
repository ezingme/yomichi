/** PostgreSQL storage of Ichiran-model datasets (kind "ichiran").
 *
 * Tables mirror Ichiran's schema with a dataset_id column, so a dataset is an
 * immutable snapshot that is activated atomically like the other datasets.
 * `phys` records the tie order of rows (Ichiran relies on heap order). */
import { randomUUID } from "node:crypto";
import type { Sql } from "./schema.js";
import type { IchiranTables } from "./ichiran-source.js";
import type { Lexicon } from "./ichiran-build/lexicon.js";
import type { KanjiTables } from "./ichiran-build/kanji.js";

export const YOMICHI_ICHIRAN_TABLES: IchiranTables = {
  entry: "yomichi_ij_entry",
  kanji: "yomichi_ij_kanji_text",
  kana: "yomichi_ij_kana_text",
  sense: "yomichi_ij_sense",
  senseProp: "yomichi_ij_sense_prop",
  gloss: "yomichi_ij_gloss",
  conjugation: "yomichi_ij_conjugation",
  conjProp: "yomichi_ij_conj_prop",
  conjSource: "yomichi_ij_conj_source_reading",
  restricted: "yomichi_ij_restricted_readings",
  kanjiChar: "yomichi_ij_kanji",
  kanjiReading: "yomichi_ij_reading",
};

const DS = "dataset_id text NOT NULL REFERENCES yomichi_datasets(id) ON DELETE CASCADE";
export const ICHIRAN_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS yomichi_ij_entry(${DS},seq integer NOT NULL,root_p boolean NOT NULL,n_kanji integer NOT NULL,n_kana integer NOT NULL,primary_nokanji boolean NOT NULL,PRIMARY KEY(dataset_id,seq))`,
  ...(["kanji", "kana"] as const).flatMap((t) => [
    `CREATE TABLE IF NOT EXISTS yomichi_ij_${t}_text(${DS},id integer NOT NULL,seq integer NOT NULL,text text NOT NULL,ord integer NOT NULL,common integer,common_tags text NOT NULL,conjugate_p boolean NOT NULL,nokanji boolean NOT NULL,${t === "kanji" ? "best_kana" : "best_kanji"} text,phys integer NOT NULL,PRIMARY KEY(dataset_id,id))`,
    `CREATE INDEX IF NOT EXISTS yomichi_ij_${t}_text_text ON yomichi_ij_${t}_text(dataset_id,text)`,
    `CREATE INDEX IF NOT EXISTS yomichi_ij_${t}_text_seq ON yomichi_ij_${t}_text(dataset_id,seq)`,
  ]),
  `CREATE TABLE IF NOT EXISTS yomichi_ij_sense(${DS},id integer NOT NULL,seq integer NOT NULL,ord integer NOT NULL,PRIMARY KEY(dataset_id,id))`,
  `CREATE INDEX IF NOT EXISTS yomichi_ij_sense_seq ON yomichi_ij_sense(dataset_id,seq)`,
  `CREATE TABLE IF NOT EXISTS yomichi_ij_gloss(${DS},id integer NOT NULL,sense_id integer NOT NULL,text text NOT NULL,ord integer NOT NULL,PRIMARY KEY(dataset_id,id))`,
  `CREATE INDEX IF NOT EXISTS yomichi_ij_gloss_sense ON yomichi_ij_gloss(dataset_id,sense_id)`,
  `CREATE TABLE IF NOT EXISTS yomichi_ij_sense_prop(${DS},id integer NOT NULL,tag text NOT NULL,sense_id integer NOT NULL,text text NOT NULL,ord integer NOT NULL,seq integer NOT NULL,PRIMARY KEY(dataset_id,id))`,
  `CREATE INDEX IF NOT EXISTS yomichi_ij_sense_prop_seq ON yomichi_ij_sense_prop(dataset_id,seq)`,
  `CREATE INDEX IF NOT EXISTS yomichi_ij_sense_prop_tag ON yomichi_ij_sense_prop(dataset_id,tag,text)`,
  `CREATE TABLE IF NOT EXISTS yomichi_ij_restricted_readings(${DS},id integer NOT NULL,seq integer NOT NULL,reading text NOT NULL,text text NOT NULL,PRIMARY KEY(dataset_id,id))`,
  `CREATE INDEX IF NOT EXISTS yomichi_ij_restricted_seq ON yomichi_ij_restricted_readings(dataset_id,seq)`,
  `CREATE TABLE IF NOT EXISTS yomichi_ij_conjugation(${DS},id integer NOT NULL,seq integer NOT NULL,"from" integer NOT NULL,via integer,PRIMARY KEY(dataset_id,id))`,
  `CREATE INDEX IF NOT EXISTS yomichi_ij_conjugation_seq ON yomichi_ij_conjugation(dataset_id,seq)`,
  `CREATE INDEX IF NOT EXISTS yomichi_ij_conjugation_from ON yomichi_ij_conjugation(dataset_id,"from")`,
  `CREATE TABLE IF NOT EXISTS yomichi_ij_conj_prop(${DS},id integer NOT NULL,conj_id integer NOT NULL,conj_type integer NOT NULL,pos text NOT NULL,neg boolean,fml boolean,PRIMARY KEY(dataset_id,id))`,
  `CREATE INDEX IF NOT EXISTS yomichi_ij_conj_prop_conj ON yomichi_ij_conj_prop(dataset_id,conj_id)`,
  `CREATE TABLE IF NOT EXISTS yomichi_ij_conj_source_reading(${DS},id integer NOT NULL,conj_id integer NOT NULL,text text NOT NULL,source_text text NOT NULL,PRIMARY KEY(dataset_id,id))`,
  `CREATE INDEX IF NOT EXISTS yomichi_ij_csr_conj ON yomichi_ij_conj_source_reading(dataset_id,conj_id)`,
  `CREATE TABLE IF NOT EXISTS yomichi_ij_kanji(${DS},id integer NOT NULL,text text NOT NULL,radical_c integer,radical_n integer,grade integer,strokes integer,freq integer,stat_common integer NOT NULL,stat_irregular integer NOT NULL,PRIMARY KEY(dataset_id,id))`,
  `CREATE INDEX IF NOT EXISTS yomichi_ij_kanji_text ON yomichi_ij_kanji(dataset_id,text)`,
  `CREATE TABLE IF NOT EXISTS yomichi_ij_reading(${DS},id integer NOT NULL,kanji_id integer NOT NULL,type text NOT NULL,text text NOT NULL,suffixp boolean NOT NULL,prefixp boolean NOT NULL,stat_common integer NOT NULL,phys integer NOT NULL,PRIMARY KEY(dataset_id,id))`,
  `CREATE INDEX IF NOT EXISTS yomichi_ij_reading_kanji ON yomichi_ij_reading(dataset_id,kanji_id)`,
  `CREATE TABLE IF NOT EXISTS yomichi_ij_okurigana(${DS},id integer NOT NULL,reading_id integer NOT NULL,text text NOT NULL,PRIMARY KEY(dataset_id,id))`,
  `CREATE INDEX IF NOT EXISTS yomichi_ij_okurigana_reading ON yomichi_ij_okurigana(dataset_id,reading_id)`,
  `CREATE TABLE IF NOT EXISTS yomichi_ij_meaning(${DS},id integer NOT NULL,kanji_id integer NOT NULL,text text NOT NULL,PRIMARY KEY(dataset_id,id))`,
  `CREATE INDEX IF NOT EXISTS yomichi_ij_meaning_kanji ON yomichi_ij_meaning(dataset_id,kanji_id)`,
];

type ColType = "int" | "text" | "bool";
/** Batched INSERT ... SELECT FROM unnest(...) writer. */
class TableWriter {
  private cols: unknown[][];
  private n = 0;
  constructor(
    private db: Sql,
    private table: string,
    private columns: [string, ColType][],
    private dataset: string,
    private batch = 20000,
  ) {
    this.cols = columns.map(() => []);
  }
  async add(...values: unknown[]): Promise<void> {
    values.forEach((v, i) => this.cols[i].push(v));
    if (++this.n >= this.batch) await this.flush();
  }
  async flush(): Promise<void> {
    if (!this.n) return;
    const names = this.columns.map(([c]) => (c === "from" ? '"from"' : c)).join(",");
    const unnest = this.columns.map(([, t], i) => `$${i + 2}::${t === "int" ? "integer" : t === "bool" ? "boolean" : "text"}[]`).join(",");
    await this.db.query(`INSERT INTO ${this.table}(dataset_id,${names}) SELECT $1,* FROM unnest(${unnest})`, [this.dataset, ...this.cols]);
    this.cols = this.columns.map(() => []);
    this.n = 0;
  }
}

/** Writes a built lexicon (and optional kanji tables) into dataset `id`. */
export async function writeIchiranDataset(
  db: Sql,
  id: string,
  lex: Lexicon,
  kanji: KanjiTables | null,
  onProgress?: (table: string, rows: number) => void,
): Promise<number> {
  const w = (table: string, cols: [string, ColType][]) => new TableWriter(db, table, cols, id);
  const entries = w("yomichi_ij_entry", [["seq", "int"], ["root_p", "bool"], ["n_kanji", "int"], ["n_kana", "int"], ["primary_nokanji", "bool"]]);
  for (const [seq, e] of lex.entries) await entries.add(seq, e.rootP, e.nKanji, e.nKana, e.primaryNokanji);
  await entries.flush();
  onProgress?.("entry", lex.entries.size);
  for (const t of [lex.kanji, lex.kana]) {
    const best = t.name === "kanji" ? "best_kana" : "best_kanji";
    const tw = w(`yomichi_ij_${t.name}_text`, [
      ["id", "int"], ["seq", "int"], ["text", "text"], ["ord", "int"], ["common", "int"], ["common_tags", "text"],
      ["conjugate_p", "bool"], ["nokanji", "bool"], [best, "text"], ["phys", "int"],
    ]);
    for (let i = 0; i < t.size; i++)
      if (t.live(i))
        await tw.add(i, t.seq.get(i), t.textOf(i), t.ord.get(i), t.commonOf(i), lex.pool.str(t.commonTags.get(i)), t.conjugateP(i), t.nokanji(i), t.bestOf(i), i);
    await tw.flush();
    onProgress?.(t.name, t.size);
  }
  const senses = w("yomichi_ij_sense", [["id", "int"], ["seq", "int"], ["ord", "int"]]);
  const glosses = w("yomichi_ij_gloss", [["id", "int"], ["sense_id", "int"], ["text", "text"], ["ord", "int"]]);
  const props = w("yomichi_ij_sense_prop", [["id", "int"], ["tag", "text"], ["sense_id", "int"], ["text", "text"], ["ord", "int"], ["seq", "int"]]);
  for (const [seq, list] of lex.senses)
    for (const s of list) {
      await senses.add(s.id, seq, s.ord);
      for (const g of s.glosses) await glosses.add(g.id, s.id, g.text, g.ord);
      for (const p of s.props) await props.add(p.id, p.tag, s.id, p.text, p.ord, seq);
    }
  await senses.flush();
  await glosses.flush();
  await props.flush();
  onProgress?.("sense", lex.senses.size);
  const restricted = w("yomichi_ij_restricted_readings", [["id", "int"], ["seq", "int"], ["reading", "text"], ["text", "text"]]);
  for (const [seq, list] of lex.restricted) for (const r of list) await restricted.add(r.id, seq, r.reading, r.text);
  await restricted.flush();
  const conj = w("yomichi_ij_conjugation", [["id", "int"], ["seq", "int"], ["from", "int"], ["via", "int"]]);
  for (let c = 0; c < lex.conjSeq.length; c++)
    if (!lex.conjDeleted.has(c)) await conj.add(c, lex.conjSeq.get(c), lex.conjFrom.get(c), lex.conjViaOf(c));
  await conj.flush();
  onProgress?.("conjugation", lex.conjSeq.length);
  const tri = (v: number) => (v === 2 ? null : v === 1);
  const cp = w("yomichi_ij_conj_prop", [["id", "int"], ["conj_id", "int"], ["conj_type", "int"], ["pos", "text"], ["neg", "bool"], ["fml", "bool"]]);
  for (let p = 0; p < lex.propConj.length; p++)
    if (!lex.propDeleted.has(p))
      await cp.add(p, lex.propConj.get(p), lex.propType.get(p), lex.pool.str(lex.propPos.get(p)), tri(lex.propNeg.get(p)), tri(lex.propFml.get(p)));
  await cp.flush();
  const csr = w("yomichi_ij_conj_source_reading", [["id", "int"], ["conj_id", "int"], ["text", "text"], ["source_text", "text"]]);
  for (let i = 0; i < lex.csrConj.length; i++)
    if (!lex.csrDeleted.has(i)) await csr.add(i, lex.csrConj.get(i), lex.pool.str(lex.csrText.get(i)), lex.pool.str(lex.csrSource.get(i)));
  await csr.flush();
  onProgress?.("conj_source_reading", lex.csrConj.length);
  if (kanji) {
    const kw = w("yomichi_ij_kanji", [
      ["id", "int"], ["text", "text"], ["radical_c", "int"], ["radical_n", "int"], ["grade", "int"], ["strokes", "int"], ["freq", "int"], ["stat_common", "int"], ["stat_irregular", "int"],
    ]);
    for (const k of kanji.kanji) await kw.add(k.id, k.text, k.radicalC, k.radicalN, k.grade, k.strokes, k.freq, k.statCommon, k.statIrregular);
    await kw.flush();
    const rw = w("yomichi_ij_reading", [["id", "int"], ["kanji_id", "int"], ["type", "text"], ["text", "text"], ["suffixp", "bool"], ["prefixp", "bool"], ["stat_common", "int"], ["phys", "int"]]);
    const ow = w("yomichi_ij_okurigana", [["id", "int"], ["reading_id", "int"], ["text", "text"]]);
    let okuriId = 0;
    for (const r of kanji.readings) {
      await rw.add(r.id, r.kanjiId, r.type, r.text, r.suffixp, r.prefixp, r.statCommon, r.id);
      for (const o of r.okurigana) await ow.add(okuriId++, r.id, o);
    }
    await rw.flush();
    await ow.flush();
    const mw = w("yomichi_ij_meaning", [["id", "int"], ["kanji_id", "int"], ["text", "text"]]);
    for (const m of kanji.meanings) await mw.add(m.id, m.kanjiId, m.text);
    await mw.flush();
    onProgress?.("kanji", kanji.kanji.length);
  }
  return lex.entries.size;
}

export interface IchiranImportResult {
  id: string;
  entries: number;
}
/** Atomically writes and activates a new "ichiran" dataset. `fill` receives
 * the dataset id and must return the number of entries written. */
export async function importIchiranDataset(
  db: Sql,
  meta: { version: string; source: string; sha256?: string },
  fill: (id: string) => Promise<number>,
): Promise<IchiranImportResult> {
  const id = randomUUID();
  await db.query("BEGIN");
  try {
    await db.query("INSERT INTO yomichi_datasets(id,kind,version,source,sha256) VALUES($1,'ichiran',$2,$3,$4)", [
      id,
      meta.version,
      meta.source,
      meta.sha256 ?? "",
    ]);
    const entries = await fill(id);
    if (!entries) throw new Error("Refusing to activate an empty Ichiran dataset");
    await db.query("UPDATE yomichi_datasets SET entry_count=$2 WHERE id=$1", [id, entries]);
    await db.query(
      "INSERT INTO yomichi_active(kind,dataset_id) VALUES('ichiran',$1) ON CONFLICT(kind) DO UPDATE SET dataset_id=excluded.dataset_id",
      [id],
    );
    await db.query("COMMIT");
    return { id, entries };
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  }
}

/** Copies an existing Ichiran database (e.g. a restored upstream release)
 * into dataset `id`, recording heap order as `phys`. */
export async function copyIchiranDatabase(
  db: Sql,
  source: Sql,
  id: string,
  onProgress?: (table: string, rows: number) => void,
): Promise<number> {
  const copy = async (from: string, to: string, cols: [string, ColType][], opts: { phys?: boolean } = {}) => {
    const all: [string, ColType][] = opts.phys ? [...cols, ["phys", "int"]] : cols;
    const writer = new TableWriter(db, to, all, id);
    const names = cols.map(([c]) => (c === "from" ? '"from"' : c)).join(",");
    const key = from === "entry" ? "seq" : "id";
    // heap order (ctid) is recorded as `phys` for tables whose order matters
    const phys = new Map<number, number>();
    if (opts.phys)
      (await source.query(`SELECT id FROM ${from} ORDER BY ctid`)).rows.forEach((r: any, i: number) => phys.set(r.id, i));
    let last = -1,
      total = 0;
    for (;;) {
      const page = await source.query(`SELECT ${names} FROM ${from} WHERE ${key} > $1 ORDER BY ${key} LIMIT 50000`, [last]);
      if (!page.rows.length) break;
      for (const r of page.rows as any[]) {
        const values = cols.map(([c]) => r[c]);
        if (opts.phys) values.push(phys.get(r.id));
        await writer.add(...values);
      }
      last = (page.rows.at(-1) as any)[key];
      total += page.rows.length;
    }
    await writer.flush();
    onProgress?.(to, total);
    return total;
  };
  const entries = await copy("entry", "yomichi_ij_entry", [["seq", "int"], ["root_p", "bool"], ["n_kanji", "int"], ["n_kana", "int"], ["primary_nokanji", "bool"]]);
  for (const t of ["kanji", "kana"] as const)
    await copy(`${t}_text`, `yomichi_ij_${t}_text`, [
      ["id", "int"], ["seq", "int"], ["text", "text"], ["ord", "int"], ["common", "int"], ["common_tags", "text"],
      ["conjugate_p", "bool"], ["nokanji", "bool"], [t === "kanji" ? "best_kana" : "best_kanji", "text"],
    ], { phys: true });
  await copy("sense", "yomichi_ij_sense", [["id", "int"], ["seq", "int"], ["ord", "int"]]);
  await copy("gloss", "yomichi_ij_gloss", [["id", "int"], ["sense_id", "int"], ["text", "text"], ["ord", "int"]]);
  await copy("sense_prop", "yomichi_ij_sense_prop", [["id", "int"], ["tag", "text"], ["sense_id", "int"], ["text", "text"], ["ord", "int"], ["seq", "int"]]);
  await copy("restricted_readings", "yomichi_ij_restricted_readings", [["id", "int"], ["seq", "int"], ["reading", "text"], ["text", "text"]]);
  await copy("conjugation", "yomichi_ij_conjugation", [["id", "int"], ["seq", "int"], ["from", "int"], ["via", "int"]]);
  await copy("conj_prop", "yomichi_ij_conj_prop", [["id", "int"], ["conj_id", "int"], ["conj_type", "int"], ["pos", "text"], ["neg", "bool"], ["fml", "bool"]]);
  await copy("conj_source_reading", "yomichi_ij_conj_source_reading", [["id", "int"], ["conj_id", "int"], ["text", "text"], ["source_text", "text"]]);
  await copy("kanji", "yomichi_ij_kanji", [
    ["id", "int"], ["text", "text"], ["radical_c", "int"], ["radical_n", "int"], ["grade", "int"], ["strokes", "int"], ["freq", "int"], ["stat_common", "int"], ["stat_irregular", "int"],
  ]);
  await copy("reading", "yomichi_ij_reading", [["id", "int"], ["kanji_id", "int"], ["type", "text"], ["text", "text"], ["suffixp", "bool"], ["prefixp", "bool"], ["stat_common", "int"]], { phys: true });
  await copy("okurigana", "yomichi_ij_okurigana", [["id", "int"], ["reading_id", "int"], ["text", "text"]]);
  await copy("meaning", "yomichi_ij_meaning", [["id", "int"], ["kanji_id", "int"], ["text", "text"]]);
  return entries;
}

export function newDatasetId(): string {
  return randomUUID();
}
