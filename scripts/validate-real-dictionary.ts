import { createReadStream } from "node:fs";
import { createGunzip, gunzipSync } from "node:zlib";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { parseEntries } from "../packages/dictionary/src/xml.js";
import type { Entry } from "../packages/core/src/types.js";
const wanted = new Set([
  "駅",
  "前",
  "で",
  "会う",
  "猫",
  "魚",
  "を",
  "食べる",
  "は",
  "の",
  "私",
  "学生",
  "明日",
  "行く",
  "学校",
  "答える",
  "にくい",
  "質問",
  "あなた",
  "です",
  "日本語",
  "勉強",
  "する",
]);
const selected: Entry[] = [];
let count = 0;
for await (const item of parseEntries(
  createReadStream("data/JMdict_e.gz").pipe(createGunzip()),
  "jmdict",
)) {
  const e = item as Entry;
  count++;
  if (
    e.spellings.some((s) => wanted.has(s)) ||
    e.readings.some((r) => wanted.has(r.text))
  )
    selected.push(e);
}
await mkdir("data", { recursive: true });
await writeFile("data/real-sample.json", JSON.stringify(selected));
console.log(
  JSON.stringify({
    parsedEntries: count,
    selectedRealEntries: selected.length,
    source: "EDRDG JMdict_e.gz",
    note: "Actual dictionary subset for smoke verification, not production full-dictionary benchmark",
  }),
);

// Reconstruct the selected original XML without rewriting dictionary content.
const xml = gunzipSync(await readFile("data/JMdict_e.gz")).toString("utf8");
const ids = new Set(selected.map((e) => e.id));
const originalEntries = [...xml.matchAll(/<entry>[\s\S]*?<\/entry>/g)]
  .filter((m) => ids.has(/<ent_seq>(\d+)<\/ent_seq>/.exec(m[0])?.[1] ?? ""))
  .map((m) => m[0]);
await writeFile(
  "data/real-sample.xml",
  xml.slice(0, xml.indexOf("<JMdict>") + 8) +
    "\n" +
    originalEntries.join("\n") +
    "\n</JMdict>",
);
