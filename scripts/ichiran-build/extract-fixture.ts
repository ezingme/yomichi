/** Extracts a verbatim subset of JMdict for tests: every entry with a
 * spelling or reading in WORDS, plus the entries Ichiran's grammar and errata
 * refer to by seq. Entries are copied unchanged (EDRDG, CC BY-SA 4.0).
 *   tsx scripts/ichiran-build/extract-fixture.ts JMdict_e OUT.xml WORD...  */
import { readFileSync, writeFileSync } from "node:fs";

const [input, out, ...words] = process.argv.slice(2);
const xml = readFileSync(input, "utf8");
const seqs = new Set<string>();
for (const f of ["grammar", "errata"])
  for (const m of readFileSync(new URL(`../../packages/core/src/ichiran/${f}.ts`, import.meta.url), "utf8").matchAll(/\b[12]\d{6}\b/g))
    seqs.add(m[0]);
const wanted = new Set(words);
const header = xml.slice(0, xml.indexOf("<JMdict>"));
const kept: string[] = [];
for (const m of xml.matchAll(/<entry>[\s\S]*?<\/entry>/g)) {
  const e = m[0];
  const seq = /<ent_seq>(\d+)<\/ent_seq>/.exec(e)![1];
  const texts = [...e.matchAll(/<(?:keb|reb)>([^<]*)<\/(?:keb|reb)>/g)].map((x) => x[1]);
  if (seqs.has(seq) || texts.some((t) => wanted.has(t))) kept.push(e);
}
writeFileSync(
  out,
  `${header.replace(/<!--[\s\S]*?-->\n?/g, "")}<!-- Verbatim subset of JMdict (EDRDG, CC BY-SA 4.0), ${kept.length} entries; see NOTICE.md. -->\n<JMdict>\n${kept.join("\n")}\n</JMdict>\n`,
);
console.log(kept.length, "entries");
