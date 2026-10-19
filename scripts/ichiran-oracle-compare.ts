/** Compares the TypeScript Ichiran port with captured live Ichiran output.
 *
 * Input: JSONL produced by scripts/oracle/ichiran-batch.lisp (live oracle).
 * Data: an Ichiran-schema PostgreSQL database (ICHIRAN_DATABASE_URL) or, with
 * --yomichi, the active Yomichi dataset (DATABASE_URL).
 *
 *   node --import tsx scripts/ichiran-oracle-compare.ts oracle1.jsonl [...] [--limit N] [--out report.json]
 */
import { readFile, writeFile } from "node:fs/promises";
import pg from "pg";
import { IchiranStore, segment, type WordInfo } from "../packages/core/src/ichiran/index.js";
import { PgIchiranSource } from "../packages/dictionary/src/ichiran-source.js";

/** jsown-compatible serialization of word-info-json (nil and false -> []). */
export function wordInfoJson(wi: WordInfo): unknown {
  const nil = (v: unknown) => (v === null || v === undefined || v === false ? [] : v);
  return {
    type: wi.type.toUpperCase(),
    text: wi.text,
    truetext: nil(wi.trueText),
    kana: wi.kana,
    seq: nil(wi.seq),
    conjugations: wi.conjugations === "root" ? "ROOT" : nil(wi.conjugations),
    score: wi.score,
    components: wi.components.map(wordInfoJson),
    alternative: nil(wi.alternative),
    primary: nil(wi.primary),
    start: nil(wi.start),
    end: nil(wi.end),
    counter: wi.counter ? [wi.counter[0], nil(wi.counter[1])] : [],
    skipped: wi.skipped,
  };
}

const args = process.argv.slice(2);
const files = args.filter(
  (a, i) => !a.startsWith("--") && !["--limit", "--out"].includes(args[i - 1]),
);
const limitArg = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
const url = process.env.ICHIRAN_DATABASE_URL;
if (!url) throw new Error("ICHIRAN_DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: url, max: 4 });
const source = new PgIchiranSource(pool);
const store = new IchiranStore();

const stats = { cases: 0, oracleErrors: 0, topTextEqual: 0, topEqual: 0, allEqual: 0, scoreEqual: 0 };
const mismatches: unknown[] = [];
const started = performance.now();
try {
  for (const file of files) {
    for (const line of (await readFile(file, "utf8")).split("\n")) {
      if (!line.trim()) continue;
      if (stats.cases >= limitArg) break;
      const o = JSON.parse(line);
      if (o.error) {
        stats.oracleErrors++;
        continue;
      }
      stats.cases++;
      const chunks = await segment(store, source, o.text, 5);
      const mine = chunks.map((c) =>
        c.type === "misc"
          ? { type: "misc", text: c.text }
          : {
              type: "word",
              text: c.text,
              paths: c.paths.map((p) => ({ score: p.score, words: p.words.map(wordInfoJson) })),
            },
      );
      const theirs = o.chunks;
      const top = (cs: any[]) =>
        cs.map((c) => (c.type === "word" ? c.paths[0]?.words.map((w: any) => w.text) : c.text));
      const topFull = (cs: any[]) => cs.map((c) => (c.type === "word" ? c.paths[0] : c.text));
      const scores = (cs: any[]) => cs.map((c) => (c.type === "word" ? c.paths.map((p: any) => p.score) : null));
      const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
      const t1 = eq(top(mine), top(theirs));
      const t2 = eq(topFull(mine), topFull(theirs));
      const t3 = eq(mine, theirs);
      const t4 = eq(scores(mine), scores(theirs));
      if (t1) stats.topTextEqual++;
      if (t2) stats.topEqual++;
      if (t3) stats.allEqual++;
      if (t4) stats.scoreEqual++;
      if (!t3)
        mismatches.push({
          id: o.id,
          text: o.text,
          level: !t1 ? "top-segmentation" : !t2 ? "top-details" : !t4 ? "alternative-scores" : "alternative-details",
          ...(t2 ? {} : { mine: topFull(mine), theirs: topFull(theirs) }),
          ...(t2 && !t3 ? { mineAll: mine, theirsAll: theirs } : {}),
        });
    }
  }
} finally {
  await pool.end();
}
const report = { ...stats, ms: Math.round(performance.now() - started), store: store.size(), mismatches };
if (out) await writeFile(out, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ ...stats, ms: report.ms, mismatchLevels: countBy(mismatches.map((m: any) => m.level)) }, null, 1));
function countBy(xs: string[]) {
  const m: Record<string, number> = {};
  for (const x of xs) m[x] = (m[x] ?? 0) + 1;
  return m;
}
