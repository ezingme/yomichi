/** Full-source scan; this is deliberately not a PostgreSQL deployment benchmark. */
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { createGunzip } from "node:zlib";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { parseEntries } from "../packages/dictionary/src/xml.js";
import { generateForms } from "../packages/core/src/conjugation.js";
import { normalizeJapanese } from "../packages/core/src/characters.js";
import type {
  DictionaryRepository,
  Entry,
  Lexeme,
} from "../packages/core/src/types.js";
import type { ReferenceCase } from "./extract-ichiran-tests.js";
import { compareBoundaries } from "./parity.js";
const sourcePath = "data/JMdict_e.gz";
const cachePath = "data/parity-query-index.json";
const corpusRaw = await readFile(
  "tests/fixtures/upstream/ichiran-tests.json",
  "utf8",
);
const corpus = JSON.parse(corpusRaw) as {
  provenance: unknown;
  cases: ReferenceCase[];
};
const corpusHash = createHash("sha256").update(corpusRaw).digest("hex");
const compressedHash = createHash("sha256");
for await (const chunk of createReadStream(sourcePath))
  compressedHash.update(chunk);
const sha256Compressed = compressedHash.digest("hex");
const morphologyFiles = [
  "packages/core/src/conjugation.ts",
  "packages/core/src/kana.ts",
  "packages/core/src/characters.ts",
  "package-lock.json",
  ...(await readdir("packages/core/src/morphology"))
    .filter((f) => f.endsWith(".ts"))
    .sort()
    .map((f) => "packages/core/src/morphology/" + f),
];
const morphologyHash = createHash("sha256");
for (const path of morphologyFiles) {
  morphologyHash.update(path);
  morphologyHash.update(await readFile(path));
}
const morphologySha256 = morphologyHash.digest("hex");

const cases = corpus.cases.filter((c) => c.kind === "segmentation" && !c.gap);
const requested = new Set<string>();
for (const c of cases) {
  const chars = Array.from(c.text);
  for (let i = 0; i < chars.length; i++)
    for (let j = i + 1; j <= chars.length; j++) {
      const value = chars.slice(i, j).join("");
      for (const form of [value, normalizeJapanese(value)])
        for (const suffix of ["", "て", "で"]) requested.add(form + suffix);
    }
}
type Scan = {
  source: string;
  sourcePath: string;
  sha256Compressed: string;
  morphologySha256: string;
  sha256Uncompressed: string;
  entriesScanned: number;
  generatedFormsScanned: number;
  retainedEntries: number;
  retainedForms: number;
  requestedForms: number;
  scanMs: number;
  corpusHash: string;
};
let scan: Scan;
const forms = new Map<string, Lexeme[]>(),
  entries = new Map<string, Entry>();
if (process.argv.includes("--reuse-index")) {
  const cache = JSON.parse(await readFile(cachePath, "utf8")) as {
    scan: Scan;
    entries: Entry[];
    forms: Lexeme[];
  };
  if (cache.scan.corpusHash !== corpusHash)
    throw new Error("Index corpus differs; rescan required");
  if (
    cache.scan.sha256Compressed !== sha256Compressed ||
    cache.scan.morphologySha256 !== morphologySha256
  )
    throw new Error("Dictionary or morphology changed; rescan required");
  scan = cache.scan;
  for (const entry of cache.entries) entries.set(entry.id, entry);
  for (const form of cache.forms) {
    const bucket = forms.get(form.surface) ?? [];
    bucket.push(form);
    forms.set(form.surface, bucket);
  }
  console.error(
    "Reused query index. This mode assumes dictionary and morphology have not changed since scan.",
  );
} else {
  const started = performance.now(),
    hash = createHash("sha256");
  let count = 0,
    generated = 0,
    retained = 0;
  async function* hashed() {
    for await (const chunk of createReadStream(sourcePath).pipe(
      createGunzip(),
    )) {
      hash.update(chunk);
      yield chunk;
    }
  }
  for await (const item of parseEntries(hashed(), "jmdict")) {
    const entry = item as Entry;
    count++;
    const allForms = generateForms(entry);
    generated += allForms.length;
    for (const form of allForms)
      if (requested.has(form.surface)) {
        const bucket = forms.get(form.surface) ?? [];
        bucket.push(form);
        forms.set(form.surface, bucket);
        entries.set(entry.id, entry);
        retained++;
      }
    if (count % 25000 === 0)
      console.error(
        JSON.stringify({
          phase: "scan",
          entries: count,
          generatedForms: generated,
          retainedForms: retained,
        }),
      );
  }
  scan = {
    source: "EDRDG JMdict (user-provided local XML/gzip)",
    sourcePath,
    sha256Compressed,
    morphologySha256,
    sha256Uncompressed: hash.digest("hex"),
    entriesScanned: count,
    generatedFormsScanned: generated,
    retainedEntries: entries.size,
    retainedForms: retained,
    requestedForms: requested.size,
    scanMs: performance.now() - started,
    corpusHash,
  };
  await writeFile(
    cachePath,
    JSON.stringify({
      scan,
      entries: [...entries.values()],
      forms: [...forms.values()].flat(),
    }),
  );
}
console.error(JSON.stringify({ phase: "index-ready", ...scan }));
const repo: DictionaryRepository = {
  async metadata() {
    return {
      version: scan.sha256Uncompressed,
      source: scan.source,
      entryCount: scan.entriesScanned,
      capabilities: ["words"],
    };
  },
  async lookup(wanted) {
    for (const form of wanted)
      if (!requested.has(form))
        throw new Error(`Requested form not in query index: ${form}`);
    return wanted.flatMap((form) => forms.get(form) ?? []);
  },
  async entries(ids) {
    return ids.flatMap((id) => (entries.has(id) ? [entries.get(id)!] : []));
  },
  async search() {
    throw new Error("Search is outside this query-index evaluation");
  },
  async kanji() {
    return null;
  },
};
// Load the engine only after indexing; --reuse-index supports subsequent engine-only changes.
const { analyze } = await import("../packages/core/src/engine.js");
const started = performance.now(),
  records: unknown[] = [];
let exact = 0,
  tp = 0,
  predicted = 0,
  reference = 0;
for (const c of cases) {
  const result = await analyze(repo, { text: c.text, limit: 1 });
  const actual = result.candidates[0].tokens.map((t) => t.surface);
  const metrics = compareBoundaries(c.text, c.tokens!, actual);
  if (metrics.exact) exact++;
  tp += metrics.truePositive;
  predicted += metrics.predicted;
  reference += metrics.reference;
  records.push({
    type: "case",
    id: c.id,
    line: c.line,
    text: c.text,
    expected: c.tokens,
    actual,
    ...metrics,
  });
}
const summary = {
  type: "summary",
  capturedAt: new Date().toISOString(),
  engineSha256: createHash("sha256")
    .update(await readFile("packages/core/src/engine.ts"))
    .digest("hex"),
  grammarSha256: createHash("sha256")
    .update(await readFile("packages/core/src/grammar.ts"))
    .digest("hex"),
  mode: "Full JMdict source scanned; query-index subset in memory; NOT PostgreSQL import/deployment validation",
  ...scan,
  provenance: corpus.provenance,
  evaluated: cases.length,
  excludedGapCases: corpus.cases.filter((c) => c.gap).length,
  exactMatches: exact,
  exactRate: exact / cases.length,
  boundaryTruePositives: tp,
  predictedBoundaries: predicted,
  referenceBoundaries: reference,
  boundaryPrecision: predicted ? tp / predicted : null,
  boundaryRecall: reference ? tp / reference : null,
  boundaryF1: predicted + reference ? (2 * tp) / (predicted + reference) : null,
  evaluationMs: performance.now() - started,
  node: process.version,
  rssBytes: process.memoryUsage().rss,
  notes:
    "Published Ichiran expectations, not live oracle outputs. No reading/sense/scoring equivalence claim. No upstream custom dictionary overlays were imported. Mismatches need review; current data and upstream data may differ.",
};
records.push(summary);
await writeFile(
  "data/parity-full.jsonl",
  records.map((r) => JSON.stringify(r)).join("\n") + "\n",
);
console.log(JSON.stringify(summary, null, 2));
