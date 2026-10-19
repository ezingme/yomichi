/** Ichiran-compatible analyzer: a TypeScript port of the segmentation,
 * scoring and grammar logic of Ichiran (https://github.com/tshatrov/ichiran,
 * Timofei Shatrov, MIT). The data model mirrors Ichiran's database tables;
 * rows are obtained through an IchiranSource. */
import { basicSplit, normalizeChars, normalizeWithMap } from "./chars.js";
import { dictSegment, findWordInfo, type WordInfo } from "./dict.js";
import { withState } from "./state.js";
import { resetSuffixState } from "./grammar.js";
import { DEFAULT_METHOD, METHODS, type RomanizationMethod } from "./romanize.js";
import { joinParts, kanjiInfoJson, matchReadingsJson, romanizeWordInfo, wordInfoGlossJson, wordInfoStr, type Json } from "./output.js";
import { IchiranStore, runWithStore, type IchiranSource } from "./store.js";
import { ichiranMethod, projectAnalysis } from "./yomichi.js";
import { ENGINE_VERSION, validateOptions } from "../engine.js";
import type { Analysis, AnalyzeOptions, DictionaryMetadata } from "../types.js";

export * from "./store.js";
export * as ichiranChars from "./chars.js";
export * as ichiranNumbers from "./numbers.js";
export {
  dictSegment,
  simpleSegment,
  getKana,
  textOf,
  type WordInfo,
  type Word,
} from "./dict.js";
export { processHints, stripHints } from "./split.js";
export { METHODS as ROMANIZATION_METHODS, romanizeWord, type RomanizationMethod } from "./romanize.js";
export { wordInfoGlossJson, wordInfoStr, romanizeWordInfo, joinParts, type Json } from "./output.js";
export { getSuffixDescription } from "./grammar.js";

export interface IchiranPath {
  words: WordInfo[];
  score: number;
}
export type IchiranChunk =
  | { type: "misc"; text: string; start: number; end: number }
  | { type: "word"; text: string; start: number; end: number; paths: IchiranPath[] };

/** Run a synchronous computation with the dynamic state of one analysis. */
export function runSync<T>(store: IchiranStore, fn: () => T): T {
  return withState(
    {
      store,
      substringHash: null,
      suffixMapTemp: null,
      suffixNextEnd: null,
      disableHints: false,
    },
    () => {
      resetSuffixState();
      return fn();
    },
  );
}

/** Equivalent of ichiran:romanize* without romanization: normalize, split
 * into Japanese word runs, segment each run. Offsets refer to `input` (UTF-16).
 * Word-info start/end are relative to the normalized run, as upstream. */
export function segmentSync(store: IchiranStore, input: string, limit = 5): IchiranChunk[] {
  return runSync(store, () => segmentRaw(input, limit));
}
function segmentRaw(input: string, limit: number): IchiranChunk[] {
  const norm = normalizeWithMap(input);
  return basicSplit(norm.text).map((seg): IchiranChunk => {
      const start = norm.source[seg.start][0];
      const end = norm.source[seg.end - 1][1];
      if (seg.type === "misc") return { type: "misc", text: seg.text, start, end };
      return {
        type: "word",
        text: seg.text,
        start,
        end,
        paths: dictSegment(seg.text, limit).map(([words, score]) => ({ words, score })),
      };
  });
}

export async function segment(
  store: IchiranStore,
  source: IchiranSource,
  input: string,
  limit = 5,
): Promise<IchiranChunk[]> {
  return runWithStore(store, source, () => segmentSync(store, input, limit));
}

/** The same as upstream simple-segment on one run of Japanese text. */
export async function simpleSegmentText(
  store: IchiranStore,
  source: IchiranSource,
  text: string,
  limit = 5,
): Promise<WordInfo[]> {
  return runWithStore(store, source, () =>
    runSync(store, () => dictSegment(text, limit)[0]?.[0] ?? []),
  );
}

/** ichiran:romanize* — detailed JSON identical in structure to upstream. */
export async function romanizeStar(
  store: IchiranStore,
  source: IchiranSource,
  input: string,
  opts: { method?: RomanizationMethod; limit?: number } = {},
): Promise<Json> {
  const method = opts.method ?? DEFAULT_METHOD;
  return runWithStore(store, source, () =>
    runSync(store, () =>
      segmentRaw(input, opts.limit ?? 5).map(
        (chunk): Json =>
          chunk.type === "misc"
            ? chunk.text
            : chunk.paths.map((p) => [
                p.words.map((w) => [romanizeWordInfo(w, method), wordInfoGlossJson(w), []] as Json),
                p.score,
              ]),
      ),
    ),
  );
}

/** ichiran:romanize — romanized sentence, optionally with per-word info text. */
export async function romanize(
  store: IchiranStore,
  source: IchiranSource,
  input: string,
  opts: { method?: RomanizationMethod; withInfo?: boolean } = {},
): Promise<{ text: string; info: [string, string][] }> {
  const method = opts.method ?? DEFAULT_METHOD;
  return runWithStore(store, source, () =>
    runSync(store, () => {
      const parts: string[] = [];
      const info: [string, string][] = [];
      for (const chunk of segmentRaw(input, 5)) {
        if (chunk.type === "misc") parts.push(chunk.text);
        else
          for (const w of chunk.paths[0]?.words ?? []) {
            const rom = romanizeWordInfo(w, method);
            if (opts.withInfo) info.push([rom, wordInfoStr(w)]);
            parts.push(rom);
          }
      }
      return { text: joinParts(parts), info };
    }),
  );
}

export { ichiranMethod, entrySenses } from "./yomichi.js";
export { findWordInfo };
export { kanjiInfoJson, matchReadingsJson, wordInfoReadingStr, type KanjiInfo } from "./output.js";

/** An Ichiran-model dataset ready for analysis: a shared query store over an
 * immutable snapshot plus its metadata. */
export interface IchiranEngine {
  store: IchiranStore;
  source: IchiranSource;
  dictionary: DictionaryMetadata;
}

/** Yomichi /v1/analyze over the Ichiran engine. */
export async function analyzeIchiran(engine: IchiranEngine, o: AnalyzeOptions): Promise<Analysis> {
  validateOptions(o);
  const opts = {
    limit: o.limit ?? 1,
    method: ichiranMethod(o.romanization),
    includeGlosses: o.includeGlosses ?? true,
    includeConjugation: o.includeConjugation ?? true,
    hints: o.segmentationHints,
  };
  engine.store.trim();
  const candidates = await runWithStore(engine.store, engine.source, () =>
    runSync(engine.store, () => projectAnalysis(o.text, opts)),
  );
  return {
    text: o.text,
    offsetUnit: "utf16",
    dictionary: engine.dictionary,
    engineVersion: `${ENGINE_VERSION}+ichiran`,
    candidates,
    warnings: [],
  };
}

/** ichiran/dict:find-word-info-json — every dictionary reading of a word. */
export async function findWordInfoJson(
  engine: IchiranEngine,
  text: string,
  opts: { reading?: string; rootOnly?: boolean } = {},
): Promise<Json[]> {
  engine.store.trim();
  return runWithStore(engine.store, engine.source, () =>
    runSync(engine.store, () => findWordInfo(text, opts).map((wi) => wordInfoGlossJson(wi, opts.rootOnly))),
  );
}

/** ichiran/kanji:kanji-info-json, or null when the character is not in KANJIDIC. */
export async function kanjiInfo(engine: IchiranEngine, char: string): Promise<Json | null> {
  const info = await engine.source.fetchKanjiInfo?.(char);
  return info ? kanjiInfoJson(info) : null;
}

/** ichiran/kanji:match-readings-json — aligns kanji with a word's reading. */
export async function matchReadingsInfo(engine: IchiranEngine, word: string, reading: string): Promise<Json> {
  const chars = [...new Set(word)];
  const infos = new Map(
    await Promise.all(chars.map(async (c) => [c, (await engine.source.fetchKanjiInfo?.(c)) ?? null] as const)),
  );
  return runWithStore(engine.store, engine.source, () =>
    runSync(engine.store, () =>
      matchReadingsJson(word, reading, (kanji, text, type) => {
        const info = infos.get(kanji);
        const r = info?.readings.find((x) => x.text === text && x.type === type);
        return info && r ? { sample: r.statCommon, total: info.statCommon, grade: info.grade } : null;
      }),
    ),
  );
}

export * from "./view.js";

export type IchiranMethodName = keyof typeof METHODS | "kana" | "text";
export interface IchiranWordResult {
  text: string;
  /** Original UTF-16 offsets. */
  start: number;
  end: number;
  romanization: string;
  /** Dictionary entries for this text left out of the gloss ("omitted"). */
  skipped: number;
  /** word-info-gloss-json, as in romanize*. */
  gloss: Json;
}
/** `text` is Ichiran's normalized run and `source` the original input slice.
 * `display` is what ichi.moe shows: characters normalized, punctuation kept
 * (see normalizeChars). */
export type IchiranPart =
  | { type: "misc"; text: string; source: string; display: string; start: number; end: number }
  | {
      type: "word";
      text: string;
      source: string;
      display: string;
      start: number;
      end: number;
      paths: { score: number; romanization: string; words: IchiranWordResult[] }[];
    };
export interface IchiranResult {
  text: string;
  method: IchiranMethodName;
  /** ichiran:romanize of the best paths. */
  romanization: string;
  /** Japanese runs with their best `limit` segmentations, as ichi.moe shows them. */
  parts: IchiranPart[];
}

/** Everything ichi.moe displays for a text: per run, the best paths with
 * scores, and per word its romanization, omitted-entry count and gloss JSON. */
export async function ichiranResult(
  engine: IchiranEngine,
  input: string,
  opts: { method?: IchiranMethodName; limit?: number } = {},
): Promise<IchiranResult> {
  const name = opts.method ?? "hepburn-traditional";
  const method = name === "kana" || name === "text" ? name : METHODS[name];
  engine.store.trim();
  return runWithStore(engine.store, engine.source, () =>
    runSync(engine.store, () => {
      const norm = normalizeWithMap(input);
      const orig = (a: number, b: number) => [norm.source[a][0], norm.source[b - 1][1]] as const;
      const best: string[] = [];
      const parts = basicSplit(norm.text).map((seg): IchiranPart => {
        const [start, end] = orig(seg.start, seg.end);
        if (seg.type === "misc") {
          best.push(seg.text);
          const source = input.slice(start, end);
          return { type: "misc", text: seg.text, source, display: normalizeChars(source), start, end };
        }
        const paths = dictSegment(seg.text, opts.limit ?? 5).map(([wis, score]) => {
          const words = wis.map((wi): IchiranWordResult => {
            const [s, e] = orig(seg.start + (wi.start ?? 0), seg.start + (wi.end ?? seg.text.length));
            return {
              text: wi.text,
              start: s,
              end: e,
              romanization: romanizeWordInfo(wi, method),
              skipped: wi.skipped,
              gloss: wordInfoGlossJson(wi),
            };
          });
          return { score, romanization: words.map((w) => w.romanization).join(" "), words };
        });
        best.push(...(paths[0]?.words.map((w) => w.romanization) ?? []));
        const source = input.slice(start, end);
        return { type: "word", text: seg.text, source, display: normalizeChars(source), start, end, paths };
      });
      return { text: input, method: name, romanization: joinParts(best), parts };
    }),
  );
}
