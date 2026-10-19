/** Compares the TypeScript Ichiran port with captured live Ichiran output.
 *
 * Input: JSONL produced by scripts/oracle/ichiran-batch.lisp (live oracle).
 * Data: an Ichiran-schema PostgreSQL database (ICHIRAN_DATABASE_URL) or, with
 * --yomichi, the active Yomichi dataset (DATABASE_URL).
 *
 *   node --import tsx scripts/ichiran-oracle-compare.ts oracle1.jsonl [...] [--limit N] [--out report.json]
 */
import { readFile, writeFile } from "node:fs/promises";
import {
  IchiranStore,
  romanize,
  romanizeStar,
  segment,
  type WordInfo,
} from "../packages/core/src/ichiran/index.js";
import { sourceFromArgs } from "./ichiran-build/source.js";

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
/** With --normalize-generated, ids of generated (conjugated/custom) entries and
 * conjugation row ids are erased: they are build-specific, not linguistic. */
const normalizeGenerated = args.includes("--normalize-generated");
function norm(v: any, key?: string): any {
  if (!normalizeGenerated) return v;
  if (Array.isArray(v)) {
    if (key === "conjugations") return [];
    return v.map((x) => norm(x, key));
  }
  if (typeof v === "number" && key === "seq" && v >= 10000000) return 0;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x, k)]));
  return v;
}
const files = args.filter(
  (a, i) =>
    !a.startsWith("--") && !["--limit", "--out", "--build", "--ichiran-data", "--jmdictdb"].includes(args[i - 1]),
);
const limitArg = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
const { source, close } = await sourceFromArgs(args);
const store = new IchiranStore();

const stats = {
  cases: 0,
  oracleErrors: 0,
  topTextEqual: 0,
  topEqual: 0,
  allEqual: 0,
  scoreEqual: 0,
  fullCases: 0,
  fullEqual: 0,
  infoEqual: 0,
};
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
      const mine = norm(chunks.map((c) =>
        c.type === "misc"
          ? { type: "misc", text: c.text }
          : {
              type: "word",
              text: c.text,
              paths: c.paths.map((p) => ({ score: p.score, words: p.words.map(wordInfoJson) })),
            },
      ));
      const theirs = norm(o.chunks);
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
      if (o.full) {
        stats.fullCases++;
        const full = norm(await romanizeStar(store, source, o.text, { limit: 1 }));
        const info = await romanize(store, source, o.text, { withInfo: true });
        const fullOk = eq(full, norm(o.full));
        const infoOk = eq({ text: info.text, words: info.info }, o.info);
        if (fullOk) stats.fullEqual++;
        if (infoOk) stats.infoEqual++;
        if (!fullOk || !infoOk)
          mismatches.push({
            id: o.id,
            text: o.text,
            level: !fullOk ? "full-json" : "info-text",
            ...(fullOk ? {} : { mine: full, theirs: o.full }),
            ...(infoOk ? {} : { mineInfo: info, theirsInfo: o.info }),
          });
      }
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
  await close();
}
const report = { ...stats, ms: Math.round(performance.now() - started), store: store.size(), mismatches };
if (out) await writeFile(out, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ ...stats, ms: report.ms, mismatchLevels: countBy(mismatches.map((m: any) => m.level)) }, null, 1));
function countBy(xs: string[]) {
  const m: Record<string, number> = {};
  for (const x of xs) m[x] = (m[x] ?? 0) + 1;
  return m;
}
