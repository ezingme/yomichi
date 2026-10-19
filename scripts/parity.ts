import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ReferenceCase } from "./extract-ichiran-tests.js";

export function boundaries(text: string, tokens: string[]): Set<number> {
  if (tokens.some((t) => !t.length) || tokens.join("") !== text)
    throw new Error(
      "Tokens must be nonempty and reconstruct original input exactly",
    );
  let offset = 0;
  return new Set(tokens.slice(0, -1).map((t) => (offset += t.length)));
}
export function compareBoundaries(
  text: string,
  expected: string[],
  actual: string[],
) {
  const ref = boundaries(text, expected),
    pred = boundaries(text, actual);
  const truePositive = [...pred].filter((x) => ref.has(x)).length;
  return {
    exact: ref.size === pred.size && truePositive === ref.size,
    truePositive,
    predicted: pred.size,
    reference: ref.size,
  };
}
interface Corpus {
  provenance: { kind: string; engineExecuted: boolean; [key: string]: unknown };
  cases: ReferenceCase[];
}
interface Prediction {
  id: string;
  text: string;
  tokens: string[];
  dictionary?: unknown;
}
export async function runParity(args: string[]) {
  const option = (key: string, fallback?: string) => {
    const index = args.indexOf(key);
    return index < 0 ? fallback : args[index + 1];
  };
  const corpusPath = option(
    "--corpus",
    "tests/fixtures/upstream/ichiran-tests.json",
  )!;
  const corpus = JSON.parse(await readFile(corpusPath, "utf8")) as Corpus;
  if (!corpus.provenance?.kind || !Array.isArray(corpus.cases))
    throw new Error("Corpus requires provenance and cases");
  const predictionPath = option("--predictions");
  const predictions: Prediction[] | undefined = predictionPath
    ? JSON.parse(await readFile(predictionPath, "utf8"))
    : undefined;
  const indexed = new Map(predictions?.map((p) => [p.id, p]));
  if (predictions && indexed.size !== predictions.length)
    throw new Error("Duplicate prediction ids");
  const limit = Number(option("--limit", "Infinity"));
  if (!(limit > 0)) throw new Error("--limit must be positive");
  const corpusCases = corpus.cases.filter(
    (c) => c.kind === "segmentation" && !c.gap,
  );
  const selected = corpusCases.slice(0, limit);
  let exact = 0,
    tp = 0,
    predicted = 0,
    reference = 0;
  const dictionaryVersions: unknown[] = [];
  const direct = args.includes("--database");
  if (direct && predictions)
    throw new Error("Choose --database or --predictions, not both");
  const pool = direct
    ? (await import("../packages/dictionary/src/connection.js")).createPool()
    : undefined;
  const repository = pool
    ? new (
        await import("../packages/dictionary/src/repository.js")
      ).PostgresDictionary(pool)
    : undefined;
  const analyzer = repository
    ? (await import("../packages/core/src/engine.js")).analyze
    : undefined;
  try {
    for (const c of selected) {
      let actual: string[];
      if (predictions) {
        const prediction = indexed.get(c.id);
        if (!prediction || prediction.text !== c.text)
          throw new Error(`Missing or mismatched prediction for ${c.id}`);
        actual = prediction.tokens;
        if (
          prediction.dictionary &&
          !dictionaryVersions.some(
            (v) => JSON.stringify(v) === JSON.stringify(prediction.dictionary),
          )
        )
          dictionaryVersions.push(prediction.dictionary);
      } else if (repository && analyzer) {
        const result = await analyzer(repository, { text: c.text, limit: 1 });
        if (!result.candidates[0]) throw new Error(`No candidate for ${c.id}`);
        actual = result.candidates[0].tokens.map((t) => t.surface);
        if (
          !dictionaryVersions.some(
            (v) => JSON.stringify(v) === JSON.stringify(result.dictionary),
          )
        )
          dictionaryVersions.push(result.dictionary);
      } else {
        const response = await fetch(
          `${process.env.YOMICHI_API_URL ?? "http://localhost:3000"}/v1/analyze`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(process.env.YOMICHI_API_KEY
                ? { "x-api-key": process.env.YOMICHI_API_KEY }
                : {}),
            },
            body: JSON.stringify({ text: c.text, limit: 1 }),
          },
        );
        if (!response.ok)
          throw new Error(
            `API ${response.status} for ${c.id}: ${await response.text()}`,
          );
        const result = (await response.json()) as {
          candidates: { tokens: { surface: string }[] }[];
          dictionary?: unknown;
        };
        if (!result.candidates[0]) throw new Error(`No candidate for ${c.id}`);
        actual = result.candidates[0].tokens.map((t) => t.surface);
        if (
          result.dictionary &&
          !dictionaryVersions.some(
            (v) => JSON.stringify(v) === JSON.stringify(result.dictionary),
          )
        )
          dictionaryVersions.push(result.dictionary);
      }
      const comparison = compareBoundaries(c.text, c.tokens!, actual);
      if (comparison.exact) exact++;
      else
        console.log(
          JSON.stringify({
            type: "mismatch",
            id: c.id,
            line: c.line,
            text: c.text,
            expected: c.tokens,
            actual,
          }),
        );
      tp += comparison.truePositive;
      predicted += comparison.predicted;
      reference += comparison.reference;
    }
  } finally {
    await pool?.end();
  }
  const summary = {
    type: "summary",
    provenance: corpus.provenance,
    candidateSource: direct
      ? "PostgresDictionary + core analyze (pinned repository snapshot)"
      : (predictionPath ??
        process.env.YOMICHI_API_URL ??
        "http://localhost:3000"),
    dictionaryVersions,
    corpusCases: corpus.cases.length,
    eligibleSegmentationCases: corpusCases.length,
    evaluated: selected.length,
    excludedGapCases: corpus.cases.filter((c) => c.gap).length,
    excludedNonSegmentationCases: corpus.cases.filter(
      (c) => c.kind !== "segmentation",
    ).length,
    exactMatches: exact,
    exactRate: selected.length ? exact / selected.length : null,
    boundaryTruePositives: tp,
    predictedBoundaries: predicted,
    referenceBoundaries: reference,
    boundaryPrecision: predicted ? tp / predicted : null,
    boundaryRecall: reference ? tp / reference : null,
    boundaryF1:
      predicted + reference ? (2 * tp) / (predicted + reference) : null,
    notes:
      "Internal UTF-16 token boundaries only; micro-averaged. Mismatches are review cases, not necessarily bugs. Published expectations are not live oracle outputs. No reading, sense, score, conjugation or overall equivalence claim.",
  };
  console.log(JSON.stringify(summary));
  return summary;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await runParity(process.argv.slice(2));
