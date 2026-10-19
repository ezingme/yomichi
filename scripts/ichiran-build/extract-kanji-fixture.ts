/** Extracts verbatim KANJIDIC2 characters for tests (EDRDG, CC BY-SA 4.0).
 *   tsx scripts/ichiran-build/extract-kanji-fixture.ts kanjidic2.xml.gz OUT.xml CHARS */
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const [input, out, chars] = process.argv.slice(2);
const raw = readFileSync(input);
const xml = (input.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
const header = xml.slice(0, xml.indexOf("<kanjidic2>")).replace(/<!--[\s\S]*?-->\n?/g, "");
const wanted = new Set(chars);
const kept = [...xml.matchAll(/<character>[\s\S]*?<\/character>/g)]
  .map((m) => m[0])
  .filter((c) => wanted.has(/<literal>([^<]*)<\/literal>/.exec(c)![1]));
writeFileSync(
  out,
  `${header}<!-- Verbatim subset of KANJIDIC2 (EDRDG, CC BY-SA 4.0), ${kept.length} characters; see NOTICE.md. -->\n<kanjidic2>\n${kept.join("\n")}\n</kanjidic2>\n`,
);
console.log(kept.length, "characters");
