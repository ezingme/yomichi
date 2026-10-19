import { toHiragana } from "wanakana";
import type { Kanji } from "../../core/src/types.js";
import { rendaku, geminate } from "../../core/src/characters.js";
export interface AlignedReadingCandidate {
  type: string;
  original: string;
  stem: string;
  okurigana: string;
  rendaku: boolean;
  geminated: boolean;
}
export interface KanjiAlignmentSegment {
  surface: string;
  start: number;
  end: number;
  reading: string;
  readingStart: number;
  readingEnd: number;
  status: "matched" | "unmatched";
  candidates: AlignedReadingCandidate[];
}
export interface KanjiAlignment {
  word: string;
  reading: string;
  status: "matched" | "partial" | "unmatched" | "limit";
  segments: KanjiAlignmentSegment[];
  statesVisited: number;
  warnings: string[];
}
export interface AlignmentOptions {
  maxStates?: number;
  maxWordLength?: number;
  maxReadingLength?: number;
  includeNanori?: boolean;
}
type ReadingKanji = Kanji & { nanori?: string[] };
const normalize = (s: string) =>
  toHiragana(s.normalize("NFKC"), { passRomaji: true });
/** Independent bounded dynamic-programming interpretation of Ichiran kanji.lisp
 * get-reading-alternatives/match-readings (Timofei Shatrov, MIT).
 * Only caller-supplied KANJIDIC readings can yield matched kanji. Irregular spans
 * are alignment hypotheses, explicitly unmatched, never inferred dictionary data.
 * Offsets refer to original UTF-16 strings, including normalized kana readings. */
export function alignKanjiReadings(
  word: string,
  reading: string,
  kanjiByCharacter:
    ReadonlyMap<string, ReadingKanji> | Readonly<Record<string, ReadingKanji>>,
  options: AlignmentOptions = {},
): KanjiAlignment {
  const limit = (
    value: number | undefined,
    fallback: number,
    maximum: number,
  ) =>
    value === undefined
      ? fallback
      : Math.max(
          0,
          Math.min(
            maximum,
            Number.isFinite(value) ? Math.floor(value) : fallback,
          ),
        );
  const maxStates = limit(options.maxStates, 20000, 100000);
  const result: KanjiAlignment = {
    word,
    reading,
    status: "unmatched",
    segments: [],
    statesVisited: 0,
    warnings: [],
  };
  const fallback = (
    status: "unmatched" | "limit",
    warning: string,
  ): KanjiAlignment => ({
    ...result,
    status,
    warnings: [warning],
    segments:
      word || reading
        ? [
            {
              surface: word,
              start: 0,
              end: word.length,
              reading,
              readingStart: 0,
              readingEnd: reading.length,
              status: "unmatched",
              candidates: [],
            },
          ]
        : [],
  });
  if (
    Array.from(word).length > limit(options.maxWordLength, 128, 256) ||
    Array.from(reading).length > limit(options.maxReadingLength, 256, 512)
  )
    return fallback("limit", "Alignment input limit exceeded");
  // Grapheme boundaries preserve halfwidth voiced kana and combining marks.
  let normalized = "";
  const offsets = new Map<number, number>([[0, 0]]);
  for (const part of new Intl.Segmenter("ja", {
    granularity: "grapheme",
  }).segment(reading)) {
    normalized += normalize(part.segment);
    offsets.set(normalized.length, part.index + part.segment.length);
  }
  const boundaries = [...offsets.keys()];
  let cursor = 0;
  const units = Array.from(word).map((surface) => {
    const start = cursor;
    cursor += surface.length;
    return { surface, start, end: cursor };
  });
  const lookup = (char: string): ReadingKanji | undefined =>
    typeof (kanjiByCharacter as ReadonlyMap<string, ReadingKanji>).get ===
    "function"
      ? (kanjiByCharacter as ReadonlyMap<string, ReadingKanji>).get(char)
      : (kanjiByCharacter as Readonly<Record<string, ReadingKanji>>)[char];
  const maps = units.map((unit, index) => {
    const char =
      unit.surface === "々" && index > 0
        ? units[index - 1].surface
        : unit.surface;
    const k = lookup(char);
    const candidates = new Map<string, AlignedReadingCandidate[]>();
    const rows = [
      ...(k?.readings ?? []).filter(
        (r) => r.type === "ja_on" || r.type === "ja_kun",
      ),
      ...(options.includeNanori
        ? (k?.nanori ?? []).map((text) => ({ type: "nanori", text }))
        : []),
    ];
    for (const row of rows) {
      const [stem, okurigana = ""] = row.text
        .replace(/^-|-$/g, "")
        .split(".")
        .map(normalize);
      if (!stem) continue;
      const stems = [{ text: stem, geminated: false }];
      if (row.type === "ja_on" && stem.length > 1 && /[つくきち]$/.test(stem))
        stems.push({ text: geminate(stem), geminated: true });
      for (const base of stems) {
        const variants = [{ text: base.text, rendaku: false }];
        if (index > 0)
          for (const handakuten of [false, true]) {
            const text = rendaku(base.text, handakuten);
            if (text !== base.text) variants.push({ text, rendaku: true });
          }
        for (const variant of variants) {
          const candidate = {
            type: row.type,
            original: row.text,
            stem,
            okurigana,
            rendaku: variant.rendaku,
            geminated: base.geminated,
          };
          const existing = candidates.get(variant.text) ?? [];
          if (
            !existing.some(
              (c) => JSON.stringify(c) === JSON.stringify(candidate),
            )
          )
            existing.push(candidate);
          candidates.set(variant.text, existing);
        }
      }
    }
    return {
      candidates,
      kanji: /\p{Script=Han}|々/u.test(unit.surface) || Boolean(k),
      literal: normalize(unit.surface),
    };
  });
  type Path = { score: number; segments: KanjiAlignmentSegment[] };
  const memo = new Map<string, Path | null>();
  let exhausted = false;
  const solve = (i: number, start: number): Path | null => {
    if (i === units.length)
      return start === normalized.length ? { score: 0, segments: [] } : null;
    const key = `${i}:${start}`;
    if (memo.has(key)) return memo.get(key)!;
    let best: Path | null = null;
    const item = maps[i];
    const ends = item.kanji
      ? boundaries.filter((n) => n > start)
      : [start + item.literal.length].filter(
          (n) => offsets.has(n) && normalized.startsWith(item.literal, start),
        );
    for (const end of ends) {
      if (result.statesVisited >= maxStates) {
        exhausted = true;
        break;
      }
      result.statesVisited++;
      const tail = solve(i + 1, end);
      if (!tail) continue;
      const candidates =
        item.candidates.get(normalized.slice(start, end)) ?? [];
      const matched = !item.kanji || candidates.length > 0;
      const score =
        tail.score +
        (matched
          ? candidates.length &&
            candidates.every((c) => c.rendaku || c.geminated)
            ? 1
            : 0
          : (end - start) * 10 + 1);
      if (!best || score < best.score) {
        const readingStart = offsets.get(start)!;
        const readingEnd = offsets.get(end)!;
        best = {
          score,
          segments: [
            {
              ...units[i],
              reading: reading.slice(readingStart, readingEnd),
              readingStart,
              readingEnd,
              status: matched ? "matched" : "unmatched",
              candidates,
            },
            ...tail.segments,
          ],
        };
      }
    }
    memo.set(key, best);
    return best;
  };
  const best = solve(0, 0);
  if (exhausted)
    return fallback(
      "limit",
      "Alignment search limit exceeded; no complete result asserted",
    );
  if (!best)
    return fallback(
      "unmatched",
      "No alignment preserves the literal kana and supplied reading",
    );
  result.segments = best.segments;
  result.status = best.segments.every((s) => s.status === "matched")
    ? "matched"
    : best.segments.some((s) => s.candidates.length > 0)
      ? "partial"
      : "unmatched";
  if (result.status !== "matched")
    result.warnings.push(
      "Unmatched spans are irregular or lack supplied dictionary readings; assignments are hypotheses, not verified readings",
    );
  return result;
}
