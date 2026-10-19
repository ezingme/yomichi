/** Ichiran-compatible analyzer: a TypeScript port of the segmentation,
 * scoring and grammar logic of Ichiran (https://github.com/tshatrov/ichiran,
 * Timofei Shatrov, MIT). The data model mirrors Ichiran's database tables;
 * rows are obtained through an IchiranSource. */
import { basicSplit, normalizeWithMap } from "./chars.js";
import { dictSegment, type WordInfo } from "./dict.js";
import { withState } from "./state.js";
import { resetSuffixState } from "./grammar.js";
import { DEFAULT_METHOD, type RomanizationMethod } from "./romanize.js";
import { joinParts, romanizeWordInfo, wordInfoGlossJson, wordInfoStr, type Json } from "./output.js";
import { IchiranStore, runWithStore, type IchiranSource } from "./store.js";

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
