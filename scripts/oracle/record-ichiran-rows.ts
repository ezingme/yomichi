/** Records the Ichiran database rows that analysing some sentences reads, so
 * tests can replay them without a database (tests/helpers-ichiran.ts).
 *
 *   ICHIRAN_DATABASE_URL=postgres://.../ichiran \
 *   node --import tsx scripts/oracle/record-ichiran-rows.ts OUT.json SENTENCE...
 *
 * The rows are verbatim database content: JMdict-derived dictionary data
 * (EDRDG, CC BY-SA 4.0) processed by Ichiran (MIT). */
import { writeFile } from "node:fs/promises";
import pg from "pg";
import { ichiranResult, IchiranStore, type IchiranSource, type KanjiReadingRow, type ReadingRow, type SeqBundle } from "../../packages/core/src/ichiran/index.js";
import { PgIchiranSource } from "../../packages/dictionary/src/ichiran-source.js";

const [out, ...sentences] = process.argv.slice(2);
if (!out || !sentences.length || !process.env.ICHIRAN_DATABASE_URL) {
  console.error("Usage: ICHIRAN_DATABASE_URL=... record-ichiran-rows.ts OUT.json SENTENCE...");
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: process.env.ICHIRAN_DATABASE_URL });
const db = new PgIchiranSource(pool);
const texts: Record<string, ReadingRow[]> = {};
const seqs: Record<number, SeqBundle> = {};
const kanji: Record<string, KanjiReadingRow[]> = {};
let counters: number[] = [];
const recorder: IchiranSource = {
  version: () => db.version(),
  async fetchTexts(list) {
    const rows = await db.fetchTexts(list);
    for (const t of list) texts[t] = rows.filter((r) => r.text === t);
    return rows;
  },
  async fetchSeqs(list) {
    const bundles = await db.fetchSeqs(list);
    for (const b of bundles) seqs[b.entry.seq] = b;
    return bundles;
  },
  async fetchKanjiReadings(chars) {
    const m = await db.fetchKanjiReadings(chars);
    for (const c of chars) kanji[c] = m.get(c) ?? [];
    return m;
  },
  async fetchCounterSeqs() {
    return (counters = await db.fetchCounterSeqs());
  },
};
const engine = { store: new IchiranStore(), source: recorder, dictionary: { version: "", source: "", entryCount: 0, capabilities: [] } };
for (const s of sentences) await ichiranResult(engine, s, { limit: 5 });
await pool.end();
await writeFile(
  out,
  JSON.stringify({
    source: "Ichiran release database ichiran-260118 (rows read while analysing the sentences)",
    sentences,
    counters,
    texts,
    seqs,
    kanji,
  }) + "\n",
);
console.log(`${Object.keys(texts).length} texts, ${Object.keys(seqs).length} entries, ${counters.length} counter seqs`);
