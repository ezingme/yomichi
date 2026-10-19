/** Compares built kanji tables/statistics with an Ichiran database. */
import pg from "pg";
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { buildKanji, buildLexicon, loadJmdictdbRules, readCustomSources } from "../../packages/dictionary/src/ichiran-build/build.js";
import { parseNodes } from "../../packages/dictionary/src/xml.js";
const args = process.argv.slice(2);
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const lex = await buildLexicon(parseNodes(createReadStream(args[0]), "jmdict"), {
  custom: opt("--ichiran-data") ? await readCustomSources(opt("--ichiran-data")!) : undefined,
  rules: opt("--jmdictdb") ? await loadJmdictdbRules(opt("--jmdictdb")!) : undefined,
});
const kd = createReadStream(args[1]);
const tables = await buildKanji(lex, parseNodes(args[1].endsWith(".gz") ? kd.pipe(createGunzip()) : kd, "kanji"));
const pool = new pg.Pool({ connectionString: process.env.ICHIRAN_DATABASE_URL });
const theirsK = (await pool.query("select id, text, radical_c, radical_n, grade, strokes, freq, stat_common, stat_irregular from kanji")).rows;
const theirsR = (await pool.query("select k.text kanji, r.type, r.text, r.suffixp, r.prefixp, r.stat_common from reading r join kanji k on k.id=r.kanji_id order by r.id")).rows;
const report: Record<string, number> = {};
const inc = (k: string) => (report[k] = (report[k] ?? 0) + 1);
const samples: Record<string, unknown[]> = {};
const sample = (k: string, v: unknown) => ((samples[k] ??= []).length < 6 ? samples[k].push(v) : 0);
for (const t of theirsK) {
  const m = tables.byChar.get(t.text);
  if (!m) { inc("kanji-missing"); continue; }
  for (const [a, b, name] of [[m.grade, t.grade, "grade"], [m.strokes, t.strokes, "strokes"], [m.radicalC, t.radical_c, "radical_c"], [m.statCommon, t.stat_common, "stat_common"], [m.statIrregular, t.stat_irregular, "stat_irregular"]] as const)
    if (a !== b) { inc("kanji-" + name); sample("kanji-" + name, [t.text, a, b]); }
}
const mineR = new Map(tables.readings.map((r) => [`${tables.kanji[r.kanjiId].text}|${r.type}|${r.text}`, r]));
for (const r of theirsR) {
  const m = mineR.get(`${r.kanji}|${r.type}|${r.text}`);
  if (!m) { inc("reading-missing"); sample("reading-missing", [r.kanji, r.type, r.text]); continue; }
  if (m.statCommon !== r.stat_common) { inc("reading-stat"); sample("reading-stat", [r.kanji, r.text, m.statCommon, r.stat_common]); }
}
report.kanjiTheirs = theirsK.length;
report.kanjiMine = tables.kanji.length;
report.readingsTheirs = theirsR.length;
report.readingsMine = tables.readings.length;
console.log(JSON.stringify({ report, samples }, null, 1));
await pool.end();
