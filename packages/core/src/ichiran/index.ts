/** Ichiran-compatible analyzer: a TypeScript port of the segmentation,
 * scoring and grammar logic of Ichiran (https://github.com/tshatrov/ichiran,
 * Timofei Shatrov, MIT). The data model mirrors Ichiran's database tables;
 * rows are obtained through an IchiranSource. */
import { basicSplit, normalizeWithMap } from "./chars.js";
import { dictSegment, type WordInfo } from "./dict.js";
import { withState } from "./state.js";
import { resetSuffixState } from "./grammar.js";
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
  const norm = normalizeWithMap(input);
  return runSync(store, () =>
    basicSplit(norm.text).map((seg) => {
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
    }),
  );
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
