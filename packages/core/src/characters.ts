/** Character operations adapted from Ichiran characters.lisp, MIT, Timofei Shatrov.
 * Unlike upstream normalization, these helpers never mutate the analyzed input.
 * Offsets always refer to original UTF-16 text, including supplementary kanji. */
export type CharacterClass =
  | "hiragana"
  | "katakana"
  | "kana"
  | "kanji"
  | "kanji-char"
  | "number"
  | "word"
  | "nonword"
  | "traditional";
const patterns: Record<CharacterClass, RegExp> = {
  hiragana: /^[\p{Script=Hiragana}ー]$/u,
  katakana: /^[\p{Script=Katakana}ー]$/u,
  kana: /^[\p{Script=Hiragana}\p{Script=Katakana}ー]$/u,
  kanji: /^[\p{Script=Han}々ヶ〆]$/u,
  "kanji-char": /^\p{Script=Han}$/u,
  number: /^[0-9０-９〇零一壱二弐三参四五六七八九十拾百千万億兆京]$/u,
  word: /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}々〆ー]$/u,
  nonword: /^[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}々〆ー]$/u,
  traditional: /^[\p{Script=Han}\p{Script=Hiragana}々ヶ〆ー]$/u,
};
export function testWord(text: string, kind: CharacterClass): boolean {
  return text.length > 0 && [...text].every((c) => patterns[kind].test(c));
}
export function countCharacterClass(
  text: string,
  kind: CharacterClass,
): number {
  return [...text].filter((c) => patterns[kind].test(c)).length;
}
export interface CharacterSpan {
  start: number;
  end: number;
}
export function consecutiveCharacterGroups(
  text: string,
  kind: CharacterClass,
): CharacterSpan[] {
  const result: CharacterSpan[] = [];
  let offset = 0;
  for (const c of text) {
    if (patterns[kind].test(c)) {
      const prev = result.at(-1);
      if (prev?.end === offset) prev.end += c.length;
      else result.push({ start: offset, end: offset + c.length });
    }
    offset += c.length;
  }
  return result;
}
/** Normalize width and combining kana only; compatibility kanji are preserved. */
export function normalizeJapanese(text: string): string {
  return text
    .replace(/[\uFF01-\uFF5E\uFF61-\uFF9F]+/g, (s) => s.normalize("NFKC"))
    .replace(
      /([ぁ-ゖァ-ヺ])([゛゜])/g,
      (_, c: string, m: string) => c + (m === "゛" ? "\u3099" : "\u309a"),
    )
    .normalize("NFC");
}
const unvoiced =
  "かきくけこさしすせそたちつてとはひふへほうカキクケコサシスセソタチツテトハヒフヘホウ";
const voiced =
  "がぎぐげござじずぜぞだぢづでどばびぶべぼゔガギグゲゴザジズゼゾダヂヅデドバビブベボヴ";
const h = "はひふへほハヒフヘホ",
  p = "ぱぴぷぺぽパピプペポ";
export function rendaku(text: string, handakuten = false): string {
  const from = handakuten ? h : unvoiced,
    to = handakuten ? p : voiced;
  const i = from.indexOf(text[0] ?? " ");
  return i < 0 ? text : to[i] + text.slice(1);
}
export function unrendaku(text: string): string {
  const i = (voiced + p).indexOf(text[0] ?? " ");
  return i < 0 ? text : (unvoiced + h)[i] + text.slice(1);
}
export function geminate(text: string): string {
  return text ? text.slice(0, -1) + "っ" : text;
}
export function expandIterationMarks(text: string): string {
  let result = "",
    previous = "";
  for (const c of text) {
    if ("ゝヽゞヾ".includes(c)) {
      result += previous
        ? "ゞヾ".includes(c)
          ? rendaku(previous)
          : previous
        : c;
    } else {
      result += c;
      previous = c;
    }
  }
  return result;
}
/** Ichiran's scoring length excludes small kana, sokuon and prolonged marks. */
export function moraLength(text: string): number {
  return [...text].filter(
    (c) => !"っッぁァぃィぅゥぇェぉォゃャゅュょョー".includes(c),
  ).length;
}
export interface TextSegment extends CharacterSpan {
  surface: string;
  kind: "word" | "misc";
}
export function basicSplit(text: string): TextSegment[] {
  const result: TextSegment[] = [];
  let offset = 0;
  for (const c of text) {
    const kind =
      patterns.word.test(c) || patterns.number.test(c) ? "word" : "misc";
    const last = result.at(-1);
    if (last?.kind === kind) {
      last.surface += c;
      last.end += c.length;
    } else
      result.push({ surface: c, kind, start: offset, end: offset + c.length });
    offset += c.length;
  }
  return result;
}
export function kanjiMask(text: string): string {
  return text.replace(/[\p{Script=Han}々ヶ〆]+/gu, "%");
}
export function kanjiMatchesReading(text: string, reading: string): boolean {
  const pattern = text
    .split(/([\p{Script=Han}々ヶ〆]+)/u)
    .map((s) =>
      testWord(s, "kanji") ? ".+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("");
  return new RegExp("^" + pattern + "$", "u").test(reading);
}
