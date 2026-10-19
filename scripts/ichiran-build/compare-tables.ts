/** Row-level comparison of an in-memory build with an Ichiran database.
 * Generated entries are matched by content (their seq numbers differ). */
import pg from "pg";
import { createReadStream } from "node:fs";
import { buildLexicon, loadJmdictdbRules, readCustomSources } from "../../packages/dictionary/src/ichiran-build/build.js";
import { parseNodes } from "../../packages/dictionary/src/xml.js";
const args = process.argv.slice(2);
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
let conjugationOrder: Map<number, number> | undefined;
if (args.includes("--replay-order")) {
  const p = new pg.Pool({ connectionString: process.env.ICHIRAN_DATABASE_URL });
  // creator of a generated entry = "from" of its earliest conjugation row
  const r = await p.query(`with creators as (select distinct on (seq) seq, "from" from conjugation where seq >= 10000000 and seq < 12294525 and via is null order by seq, id) select "from", min(seq) s from creators group by "from" order by 2, 1`);
  conjugationOrder = new Map(r.rows.map((x: any, i: number) => [x.from, i]));
  await p.end();
}
const lex = await buildLexicon(parseNodes(createReadStream(args[0]), "jmdict"), {
  conjugationOrder,
  custom: opt("--ichiran-data") ? await readCustomSources(opt("--ichiran-data")!) : undefined,
  rules: opt("--jmdictdb") ? await loadJmdictdbRules(opt("--jmdictdb")!) : undefined,
});
const pool = new pg.Pool({ connectionString: process.env.ICHIRAN_DATABASE_URL });
// Root/custom entries: compare readings exactly by seq (seq < 10M or entries with content)
const report: Record<string, number> = {};
const inc = (k: string, n = 1) => (report[k] = (report[k] ?? 0) + n);
const samples: Record<string, unknown[]> = {};
const sample = (k: string, v: unknown) => ((samples[k] ??= []).length < 8 ? samples[k].push(v) : 0);
const rootSeqs = (await pool.query("select seq, root_p, n_kanji, n_kana, primary_nokanji from entry where content <> '' and seq < 10000000")).rows;
for (const e of rootSeqs) {
  const mine = lex.entries.get(e.seq);
  if (!mine) { inc("root-missing"); sample("root-missing", e.seq); continue; }
  for (const k of ["rootP", "nKanji", "nKana", "primaryNokanji"] as const) {
    const theirs = { rootP: e.root_p, nKanji: e.n_kanji, nKana: e.n_kana, primaryNokanji: e.primary_nokanji }[k];
    if (mine[k] !== theirs) { inc("entry-" + k); sample("entry-" + k, [e.seq, mine[k], theirs]); }
  }
}
for (const [table, mt] of [["kanji_text", lex.kanji], ["kana_text", lex.kana]] as const) {
  const best = table === "kanji_text" ? "best_kana" : "best_kanji";
  const rows = (await pool.query(`select t.seq, t.text, t.ord, t.common, t.common_tags, t.conjugate_p, t.nokanji, t.${best} as best from ${table} t join entry e on e.seq=t.seq where e.content <> '' and e.seq < 10000000`)).rows;
  for (const r of rows) {
    const ids = mt.bySeq.get(r.seq).filter((id) => mt.textOf(id) === r.text);
    if (!ids.length) { inc(table + "-missing"); sample(table + "-missing", [r.seq, r.text]); continue; }
    const id = ids[0];
    const diffs: string[] = [];
    if (mt.ord.get(id) !== r.ord) diffs.push("ord");
    if (mt.commonOf(id) !== r.common) diffs.push("common");
    if (lex.pool.str(mt.commonTags.get(id)) !== r.common_tags) diffs.push("tags");
    if (mt.conjugateP(id) !== r.conjugate_p) diffs.push("conjugate_p");
    if (mt.nokanji(id) !== r.nokanji) diffs.push("nokanji");
    if (mt.bestOf(id) !== r.best) diffs.push("best");
    for (const d of diffs) { inc(`${table}-${d}`); sample(`${table}-${d}`, [r.seq, r.text]); }
  }
  let mineCount = 0;
  for (const [seq, e] of lex.entries) if (e.content && seq < 10000000) mineCount += mt.bySeq.get(seq).length;
  report[`${table}-root-rows-mine`] = mineCount;
  report[`${table}-root-rows-theirs`] = rows.length;
}
// Custom entries (Ichiran data/sources) are matched by content.
{
  const theirs = (await pool.query(`select e.seq, e.root_p, (select string_agg(text, ',' order by ord) from kanji_text k where k.seq=e.seq) k, (select string_agg(text, ',' order by ord) from kana_text r where r.seq=e.seq) r, (select string_agg(g.text, ';' order by s.ord, g.ord) from sense s join gloss g on g.sense_id=s.id where s.seq=e.seq) g from entry e where e.content <> '' and e.seq >= 10000000`)).rows;
  const sigT = new Map<string, number>();
  for (const e of theirs) { const k = `${e.root_p}|${e.k ?? ""}|${e.r ?? ""}|${e.g ?? ""}`; sigT.set(k, (sigT.get(k) ?? 0) + 1); }
  let equal = 0, mineN = 0;
  for (const [seq, e] of lex.entries) {
    if (!e.content || seq < 10000000 && seq < 3000000 || (seq >= 5000000 && seq < 6000000)) continue;
    mineN++;
    const k = `${e.rootP}|${lex.kanji.ofSeq(seq).map((i) => lex.kanji.textOf(i)).join(",")}|${lex.kana.ofSeq(seq).map((i) => lex.kana.textOf(i)).join(",")}|${(lex.senses.get(seq) ?? []).slice().sort((a, b) => a.ord - b.ord).flatMap((s) => s.glosses.slice().sort((a, b) => a.ord - b.ord).map((g) => g.text)).join(";")}`;
    const n = sigT.get(k) ?? 0;
    if (n) { equal++; sigT.set(k, n - 1); } else sample("custom-only-mine", k.slice(0, 200));
  }
  for (const [k, n] of sigT) if (n) sample("custom-only-theirs", k.slice(0, 200));
  report["custom-theirs"] = theirs.length;
  report["custom-mine"] = mineN;
  report["custom-equal"] = equal;
}
// Conjugations: signature = from|via-signature|props|sorted (text,source) pairs
const sig = (from: number, via: string, props: string[], pairs: string[]) => `${from}|${via}|${props.sort().join(",")}|${pairs.sort().join(",")}`;
const theirConj = (await pool.query(`select c.id, c.seq, c."from", c.via, (select string_agg(p.conj_type||':'||p.pos||':'||coalesce(p.neg::text,'n')||':'||coalesce(p.fml::text,'n'), ',') from conj_prop p where p.conj_id=c.id) props, (select string_agg(r.text||'<'||r.source_text, '\t') from conj_source_reading r where r.conj_id=c.id) pairs from conjugation c`)).rows;
const theirViaKey = new Map<number, string>();
const kanaOf = async () => {};
void kanaOf;
const theirSet = new Map<string, number>();
for (const c of theirConj) {
  const k = sig(c.from, c.via === null ? "-" : "v", (c.props ?? "").split(","), (c.pairs ?? "").split("\t"));
  theirSet.set(k, (theirSet.get(k) ?? 0) + 1);
}
const mineSet = new Map<string, number>();
const tf = (v: number) => (v === 2 ? "n" : v === 1 ? "true" : "false");
for (let c = 0; c < lex.conjSeq.length; c++) {
  if (lex.conjDeleted.has(c)) continue;
  const props = lex.propByConj.get(c).map((p) => `${lex.propType.get(p)}:${lex.pool.str(lex.propPos.get(p))}:${tf(lex.propNeg.get(p))}:${tf(lex.propFml.get(p))}`);
  const pairs = lex.csrPairs(c).map(([t, s]) => `${t}<${s}`);
  const k = sig(lex.conjFrom.get(c), lex.conjViaOf(c) === null ? "-" : "v", props, pairs);
  mineSet.set(k, (mineSet.get(k) ?? 0) + 1);
}
let same = 0;
for (const [k, n] of theirSet) {
  const m = mineSet.get(k) ?? 0;
  same += Math.min(m, n);
  if (m < n) { inc("conj-only-theirs", n - m); sample("conj-only-theirs", k.slice(0, 300)); }
}
for (const [k, n] of mineSet) {
  const t = theirSet.get(k) ?? 0;
  if (n > t) { inc("conj-only-mine", n - t); sample("conj-only-mine", k.slice(0, 300)); }
}
report["conj-equal"] = same;
report["conj-theirs"] = theirConj.length;
void theirViaKey;
console.log(JSON.stringify({ report, samples }, null, 1));
await pool.end();
