import { readFile } from "node:fs/promises";
import { YomichiClient } from "../packages/client/src/index.js";
// Feed independently obtained human/Ichiran/Himotoki boundaries. Never invent a reference run.
const path = process.argv[2];
if (!path)
  throw new Error("Usage: node --import tsx scripts/compare.ts corpus.json");
const corpus = JSON.parse(await readFile(path, "utf8")) as {
  text: string;
  tokens: string[];
  source: string;
}[];
const api = new YomichiClient(
  process.env.YOMICHI_API_URL ?? "http://localhost:3000",
  { apiKey: process.env.YOMICHI_API_KEY },
);
let exact = 0;
for (const item of corpus) {
  if (!item.source || item.tokens.join("") !== item.text)
    throw new Error(
      "Reference must identify source and reconstruct original text",
    );
  const r = await api.analyze({ text: item.text });
  const actual = r.candidates[0].tokens.map((t) => t.surface);
  const match = JSON.stringify(actual) === JSON.stringify(item.tokens);
  if (match) exact++;
  else
    console.log(
      JSON.stringify({
        text: item.text,
        source: item.source,
        expected: item.tokens,
        actual,
      }),
    );
}
console.log(
  JSON.stringify({
    sentences: corpus.length,
    exactMatches: exact,
    exactRate: corpus.length ? exact / corpus.length : null,
    notes:
      "Boundary comparison only; a mismatch is not automatically a bug. No reading/gloss accuracy claim.",
  }),
);
