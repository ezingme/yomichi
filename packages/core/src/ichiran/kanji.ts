/** Port of the reading matcher of Ichiran kanji.lisp (Timofei Shatrov, MIT),
 * used by kana hints. Readings come from Ichiran's KANJIDIC-derived table. */
import { geminate, rendaku } from "./chars.js";
import { S } from "./state.js";

/** [text, type, rendaku?, geminated-char?] */
export type NormalReading = [string, string, boolean, string | null];

function getReadingAlternatives(reading: string, type: string, withRendaku: boolean): NormalReading[] {
  const end = reading.length - 1;
  const lst: NormalReading[] = [[reading, type, false, null]];
  if (end > 0 && type === "ja_on" && "つくきち".includes(reading[end]))
    lst.push([geminate(reading), type, false, reading[end]]);
  if (!withRendaku) return lst;
  const extra: NormalReading[] = [];
  for (const [rd, , , gem] of lst) {
    extra.push([rendaku(rd), type, true, gem]);
    extra.push([rendaku(rd, true), type, true, gem]);
  }
  return [...lst, ...extra];
}

export function getNormalReadings(char: string, withRendaku: boolean): NormalReading[] {
  const readings = S()
    .store.kanjiReadings(char)
    .filter((r) => r.type !== "ja_na");
  const main: NormalReading[] = [];
  const alt: NormalReading[] = [];
  for (const r of readings) {
    const [m, ...rest] = getReadingAlternatives(r.text, r.type, withRendaku);
    main.push(m);
    alt.push(...rest);
  }
  const seen = new Set<string>();
  return [...main, ...alt].filter((r) => (seen.has(r[0]) ? false : (seen.add(r[0]), true)));
}

type RItem = string | NormalReading[];
const KANJI = /[々ヶ〆一-龯]/;
function makeRmap(str: string): RItem[] {
  let prev: string | null = null;
  const out: RItem[] = [];
  for (let start = 0; start < str.length; start++) {
    const c = str[start];
    if (!KANJI.test(c)) {
      out.push(c);
      continue;
    }
    if (c === "々") {
      out.push(prev ? getNormalReadings(prev, true) : []);
      prev = null;
    } else if (c === "ヶ") {
      prev = null;
      out.push([
        ["か", "ja_on", false, null],
        ["が", "abbr", false, null],
      ]);
    } else if (c === "〆") {
      prev = "締";
      out.push([
        ["しめ", "ja_kun", false, null],
        ["じめ", "ja_kun", true, null],
      ]);
    } else {
      prev = c;
      out.push(getNormalReadings(c, start > 0));
    }
  }
  return out;
}

type MatchPart = string | NormalReading | [string, "irr"];
const NONE = Symbol("none");
function matchStar(rmap: RItem[], i: number, reading: string, start: number): [MatchPart[], number] | typeof NONE {
  if (i >= rmap.length) return start >= reading.length ? [[], 0] : NONE;
  if (start >= reading.length) return NONE;
  const item = rmap[i];
  if (Array.isArray(item)) {
    const matches: [MatchPart[], number][] = [];
    for (let end = start + 1; end <= reading.length; end++) {
      const sub = matchStar(rmap, i + 1, reading, end);
      if (sub === NONE) continue;
      const [match, score] = sub;
      const piece = reading.slice(start, end);
      const r = item.find((x) => x[0] === piece);
      if (r) matches.unshift([[r, ...match], score]);
      else matches.unshift([[[piece, "irr"], ...match], score - (end - start)]);
    }
    if (!matches.length) return NONE;
    let best = matches[0];
    for (const m of matches) if (m[1] > best[1]) best = m;
    return best;
  }
  if (item === reading[start]) {
    const sub = matchStar(rmap, i + 1, reading, start + 1);
    if (sub === NONE) return NONE;
    return [[item, ...sub[0]], sub[1]];
  }
  return NONE;
}

/** Result parts: plain strings, or [kanji, readingText, ...]. */
export type ReadingMatch = (string | [string, string, ...unknown[]])[];
export function matchReadings(str: string, reading: string): ReadingMatch | null {
  const m = matchStar(makeRmap(str), 0, reading, 0);
  if (m === NONE) return null;
  const result: ReadingMatch = [];
  let charbag = "";
  const n = Math.min(m[0].length, str.length);
  for (let i = 0; i < n; i++) {
    const part = m[0][i];
    if (Array.isArray(part)) {
      if (charbag) {
        result.push(charbag);
        charbag = "";
      }
      result.push([str[i], ...part] as [string, string, ...unknown[]]);
    } else charbag += str[i];
  }
  if (charbag) result.push(charbag);
  return result;
}
