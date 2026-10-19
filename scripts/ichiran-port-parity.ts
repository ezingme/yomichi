/** Runs the TypeScript Ichiran port over the published Ichiran test cases.
 * Data comes from an Ichiran-schema PostgreSQL database (ICHIRAN_DATABASE_URL),
 * for example a restored upstream release dump, so that algorithm parity can be
 * measured independently of dictionary-building differences.
 *
 *   ICHIRAN_DATABASE_URL=postgres://postgres@localhost:5433/ichiran \
 *     node --import tsx scripts/ichiran-port-parity.ts [--only N] [--verbose]
 */
import { readFile } from "node:fs/promises";
import { IchiranStore, simpleSegmentText } from "../packages/core/src/ichiran/index.js";
import { sourceFromArgs } from "./ichiran-build/source.js";
import type { ReferenceCase } from "./extract-ichiran-tests.js";

const { source, close } = await sourceFromArgs(process.argv.slice(2));
const store = new IchiranStore();
const corpus = JSON.parse(await readFile("tests/fixtures/upstream/ichiran-tests.json", "utf8")) as {
  cases: ReferenceCase[];
};
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const verbose = args.includes("--verbose");
let pass = 0,
  total = 0;
const failures: unknown[] = [];
const started = performance.now();
try {
  for (const c of corpus.cases) {
    if (c.kind !== "segmentation") continue;
    if (only && !c.text.includes(only) && c.id !== only) continue;
    total++;
    let actual: (string | null)[];
    try {
      const words = await simpleSegmentText(store, source, c.text);
      actual = words.map((w) => (w.type === "gap" ? null : w.text));
    } catch (e) {
      actual = [`ERROR: ${(e as Error).stack}`];
    }
    const expected = (c.tokens ?? []).map((t: string | null) => (t === ":gap" ? null : t));
    const ok = JSON.stringify(actual) === JSON.stringify(c.gap ? (c as any).rawTokens ?? expected : expected);
    if (ok) pass++;
    else failures.push({ id: c.id, line: c.line, text: c.text, expected, actual });
    if (verbose && !ok) console.error(JSON.stringify(failures.at(-1)));
  }
} finally {
  await close();
}
console.log(
  JSON.stringify(
    { total, pass, rate: pass / total, ms: Math.round(performance.now() - started), store: store.size(), failures },
    null,
    1,
  ),
);
