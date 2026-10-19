/** Chooses the data source for parity scripts.
 *   --build JMDICT.xml[.gz]  build the Ichiran model in memory from JMdict
 *   (default)                read an Ichiran-schema database at ICHIRAN_DATABASE_URL
 * Options: --ichiran-data DIR (custom sources), --jmdictdb DIR (upstream rules),
 *          --kanji-db (KANJIDIC readings from ICHIRAN_DATABASE_URL). */
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import pg from "pg";
import type { IchiranSource } from "../../packages/core/src/ichiran/store.js";
import { PgIchiranSource } from "../../packages/dictionary/src/ichiran-source.js";
import { YOMICHI_ICHIRAN_TABLES } from "../../packages/dictionary/src/ichiran-pg.js";
import { buildLexicon, loadJmdictdbRules, readCustomSources } from "../../packages/dictionary/src/ichiran-build/build.js";
import { MemoryIchiranSource } from "../../packages/dictionary/src/ichiran-build/memory-source.js";
import { parseNodes } from "../../packages/dictionary/src/xml.js";

export async function sourceFromArgs(args: string[]): Promise<{ source: IchiranSource; close: () => Promise<void>; label: string }> {
  const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const url = process.env.ICHIRAN_DATABASE_URL;
  const build = opt("--build");
  if (args.includes("--yomichi")) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
    const active = await pool.query("SELECT dataset_id FROM yomichi_active WHERE kind='ichiran'");
    if (!active.rows[0]) throw new Error("No active ichiran dataset");
    return {
      source: new PgIchiranSource(pool, YOMICHI_ICHIRAN_TABLES, active.rows[0].dataset_id),
      close: () => pool.end(),
      label: `yomichi:${active.rows[0].dataset_id}`,
    };
  }
  if (!build) {
    if (!url) throw new Error("ICHIRAN_DATABASE_URL or --build is required");
    const pool = new pg.Pool({ connectionString: url, max: 4 });
    return { source: new PgIchiranSource(pool), close: () => pool.end(), label: "ichiran-database" };
  }
  const started = performance.now();
  const stream = createReadStream(build);
  const input = build.endsWith(".gz") ? stream.pipe(createGunzip()) : stream;
  const dataDir = opt("--ichiran-data");
  const rulesDir = opt("--jmdictdb");
  const lex = await buildLexicon(parseNodes(input, "jmdict"), {
    custom: dataDir ? await readCustomSources(dataDir) : undefined,
    rules: rulesDir ? await loadJmdictdbRules(rulesDir) : undefined,
    onProgress: (phase, detail) => console.error(JSON.stringify({ phase, detail, ms: Math.round(performance.now() - started) })),
  });
  let kanji = new Map();
  let close = async () => {};
  if (args.includes("--kanji-db") && url) {
    const pool = new pg.Pool({ connectionString: url, max: 2 });
    const r = await pool.query("SELECT k.text AS kanji, r.text, r.type FROM kanji k JOIN reading r ON r.kanji_id = k.id ORDER BY r.ctid");
    for (const row of r.rows) {
      const list = kanji.get(row.kanji) ?? [];
      list.push({ text: row.text, type: row.type });
      kanji.set(row.kanji, list);
    }
    close = () => pool.end();
  }
  return { source: new MemoryIchiranSource(lex, kanji, "memory-build"), close, label: `build:${build}` };
}
