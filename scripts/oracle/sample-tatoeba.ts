/** Deterministic Tatoeba sample for oracle comparisons: the N Japanese
 * sentences whose SHA-256(id) sorts first.
 *   tsx scripts/oracle/sample-tatoeba.ts jpn_sentences.tsv 5000 > sample.jsonl
 * Source: https://downloads.tatoeba.org/exports/per_language/jpn/jpn_sentences.tsv.bz2 (CC BY 2.0 FR). */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const [file, count = "5000", limit = "5"] = process.argv.slice(2);
const rows = readFileSync(file, "utf8")
  .trim()
  .split("\n")
  .map((l) => l.split("\t"))
  .map(([id, , text]) => [createHash("sha256").update(id).digest("hex"), id, text] as const)
  .sort((a, b) => (a[0] < b[0] ? -1 : 1));
for (const [, id, text] of rows.slice(0, Number(count)))
  console.log(JSON.stringify({ id: `tatoeba-${id}`, text, limit: Number(limit) }));
