/** Exact port of Ichiran characters.lisp (Timofei Shatrov, MIT) for the
 * Ichiran-compatible analyzer. The regular expressions deliberately keep the
 * upstream code-point ranges instead of Unicode script properties, because the
 * segmentation and scoring rules depend on precisely these classes. */

const KANA_TABLE: [string, string][] = [
  ["a", "あア"], ["i", "いイ"], ["u", "うウ"], ["e", "えエ"], ["o", "おオ"],
  ["ka", "かカ"], ["ki", "きキ"], ["ku", "くク"], ["ke", "けケ"], ["ko", "こコ"],
  ["sa", "さサ"], ["shi", "しシ"], ["su", "すス"], ["se", "せセ"], ["so", "そソ"],
  ["ta", "たタ"], ["chi", "ちチ"], ["tsu", "つツ"], ["te", "てテ"], ["to", "とト"],
  ["na", "なナ"], ["ni", "にニ"], ["nu", "ぬヌ"], ["ne", "ねネ"], ["no", "のノ"],
  ["ha", "はハ"], ["hi", "ひヒ"], ["fu", "ふフ"], ["he", "へヘ"], ["ho", "ほホ"],
  ["ma", "まマ"], ["mi", "みミ"], ["mu", "むム"], ["me", "めメ"], ["mo", "もモ"],
  ["ya", "やヤ"], ["yu", "ゆユ"], ["yo", "よヨ"],
  ["ra", "らラ"], ["ri", "りリ"], ["ru", "るル"], ["re", "れレ"], ["ro", "ろロ"],
  ["wa", "わワ"], ["wi", "ゐヰ"], ["we", "ゑヱ"], ["wo", "をヲ"],
  ["n", "んン"],
  ["ga", "がガ"], ["gi", "ぎギ"], ["gu", "ぐグ"], ["ge", "げゲ"], ["go", "ごゴ"],
  ["za", "ざザ"], ["ji", "じジ"], ["zu", "ずズ"], ["ze", "ぜゼ"], ["zo", "ぞゾ"],
  ["da", "だダ"], ["dji", "ぢヂ"], ["dzu", "づヅ"], ["de", "でデ"], ["do", "どド"],
  ["ba", "ばバ"], ["bi", "びビ"], ["bu", "ぶブ"], ["be", "べベ"], ["bo", "ぼボ"],
  ["pa", "ぱパ"], ["pi", "ぴピ"], ["pu", "ぷプ"], ["pe", "ぺペ"], ["po", "ぽポ"],
  ["vu", "ゔヴ"],
];
const SOKUON: [string, string][] = [["sokuon", "っッ"]];
const ITERATION: [string, string][] = [["iter", "ゝヽ"], ["iter-v", "ゞヾ"]];
const MODIFIERS: [string, string][] = [
  ["+a", "ぁァ"], ["+i", "ぃィ"], ["+u", "ぅゥ"], ["+e", "ぇェ"], ["+o", "ぉォ"],
  ["+ya", "ゃャ"], ["+yu", "ゅュ"], ["+yo", "ょョ"], ["+wa", "ゎヮ"],
  ["long-vowel", "ー"],
];
const ALL = [...SOKUON, ...ITERATION, ...MODIFIERS, ...KANA_TABLE];
const classChars = new Map<string, string>(ALL);
const charClass = new Map<string, string>();
for (const [cls, chars] of ALL) for (const c of chars) charClass.set(c, cls);
export const KANA_CLASSES = new Set(KANA_TABLE.map(([c]) => c));
const MODIFIER_CLASSES = new Set(
  [...MODIFIERS, ...ITERATION].map(([c]) => c),
);

/** Character class keyword, or the character itself when unclassified. */
export function getCharClass(c: string | undefined): string | undefined {
  if (c === undefined) return undefined;
  return charClass.get(c) ?? c;
}
export function isClassified(c: string): boolean {
  return charClass.has(c);
}
export function classCharacters(cls: string): string | undefined {
  return classChars.get(cls);
}

const DAKUTEN: Record<string, string> = {
  ka: "ga", ki: "gi", ku: "gu", ke: "ge", ko: "go",
  sa: "za", shi: "ji", su: "zu", se: "ze", so: "zo",
  ta: "da", chi: "dji", tsu: "dzu", te: "de", to: "do",
  ha: "ba", hi: "bi", fu: "bu", he: "be", ho: "bo",
  u: "vu",
};
const HANDAKUTEN: Record<string, string> = {
  ha: "pa", hi: "pi", fu: "pu", he: "pe", ho: "po",
};
const UNDAKUTEN: Record<string, string> = {
  ga: "ka", gi: "ki", gu: "ku", ge: "ke", go: "ko",
  za: "sa", ji: "shi", zu: "su", ze: "se", zo: "so",
  da: "ta", dji: "chi", dzu: "tsu", de: "te", do: "to",
  ba: "ha", bi: "hi", bu: "fu", be: "he", bo: "ho",
  pa: "ha", pi: "hi", pu: "fu", pe: "he", po: "ho",
  vu: "u",
};
export function voiceChar(cls: string): string {
  return DAKUTEN[cls] ?? cls;
}

export function longVowelModifierP(modifier: string, prev: string): boolean {
  const vowel = (
    { "+a": "a", "+i": "i", "+u": "u", "+e": "e", "+o": "o" } as Record<
      string,
      string
    >
  )[modifier];
  if (!vowel) return false;
  const cls = charClass.get(prev);
  return cls !== undefined && cls.at(-1) === vowel;
}

const HALF_WIDTH_KANA =
  "･ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝﾞﾟ";
const FULL_WIDTH_KANA =
  "・ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン゛゜";
const ABNORMAL =
  "０１２３４５６７８９ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ＃＄％＆（）＊＋／〈＝〉？＠［］＾＿‘｛｜｝～" +
  HALF_WIDTH_KANA;
const NORMAL =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ#$%&()*+/<=>?@[]^_`{|}~" +
  FULL_WIDTH_KANA;

export function toNormalChar(c: string, kanaContext = false): string | undefined {
  const pos = (kanaContext ? HALF_WIDTH_KANA : ABNORMAL).indexOf(c);
  if (pos < 0) return undefined;
  return (kanaContext ? FULL_WIDTH_KANA : NORMAL)[pos];
}

const PUNCTUATION: [string, string][] = [
  ["【", " ["], ["】", "] "],
  ["、", ", "], ["，", ", "],
  ["。", ". "], ["・・・", "... "], ["・", " "], ["　", " "],
  ["「", ' "'], ["」", '" '], ["゛", '"'],
  ["『", " «"], ["』", "» "],
  ["〜", " - "], ["：", ": "], ["！", "! "], ["？", "? "], ["；", "; "],
];
function dakutenJoin(table: Record<string, string>, mark: string) {
  const out: [string, string][] = [];
  for (const [cc, ccd] of Object.entries(table)) {
    let kc = classChars.get(cc)!;
    const kcd = classChars.get(ccd)!;
    const offset = kc.length - kcd.length;
    if (offset > 0) kc = kc.slice(offset);
    for (let i = 0; i < kc.length; i++) out.push([kc[i] + mark, kcd[i]]);
  }
  return out;
}
const DAKUTEN_JOIN = [
  ...dakutenJoin(DAKUTEN, "゛"),
  ...dakutenJoin(HANDAKUTEN, "゜"),
];

/** A normalized string with, for every output UTF-16 unit, its original span. */
export interface Normalized {
  text: string;
  /** source[i] = [start, end) in the original string for output position i. */
  source: [number, number][];
}

function simplifyNgrams(
  input: Normalized,
  map: [string, string][],
): Normalized {
  // Upstream builds an alternation in list order; the first alternative that
  // matches at a position wins (Perl-compatible leftmost alternation).
  let text = "";
  const source: [number, number][] = [];
  let i = 0;
  outer: while (i < input.text.length) {
    for (const [from, to] of map) {
      if (input.text.startsWith(from, i)) {
        const start = input.source[i][0];
        const end = input.source[i + from.length - 1][1];
        for (const c of to) {
          text += c;
          source.push([start, end]);
        }
        i += from.length;
        continue outer;
      }
    }
    text += input.text[i];
    source.push(input.source[i]);
    i++;
  }
  return { text, source };
}

/** ichiran/characters:normalize, keeping a map back to original offsets. */
export function normalizeWithMap(str: string, kanaContext = false): Normalized {
  let text = "";
  const source: [number, number][] = [];
  for (let i = 0; i < str.length; i++) {
    text += toNormalChar(str[i], kanaContext) ?? str[i];
    source.push([i, i + 1]);
  }
  return simplifyNgrams(
    { text, source },
    kanaContext ? DAKUTEN_JOIN : [...PUNCTUATION, ...DAKUTEN_JOIN],
  );
}
/** Character normalization without punctuation replacement: the text
 * ichi.moe displays for a run (e.g. "３" → "3", "？" → "?", but "、" kept). */
export function normalizeChars(str: string): string {
  let text = "";
  const source: [number, number][] = [];
  for (let i = 0; i < str.length; i++) {
    text += toNormalChar(str[i], false) ?? str[i];
    source.push([i, i + 1]);
  }
  return simplifyNgrams({ text, source }, DAKUTEN_JOIN).text;
}
export function normalize(str: string, kanaContext = false): string {
  return normalizeWithMap(str, kanaContext).text;
}

const KATAKANA = "ァ-ヺヽヾー";
const KATAKANA_UNIQ = "ァ-ヺヽヾ";
const HIRAGANA = "ぁ-ゔゝゞー";
const KANJI = "々ヶ〆一-龯";
const KANJI_CHAR = "一-龯";
export type IchiranCharClass =
  | "katakana"
  | "katakana-uniq"
  | "hiragana"
  | "kanji"
  | "kanji-char"
  | "kana"
  | "traditional"
  | "nonword"
  | "number";
const CLASS_SOURCE: Record<IchiranCharClass, string> = {
  katakana: `[${KATAKANA}]`,
  "katakana-uniq": `[${KATAKANA_UNIQ}]`,
  hiragana: `[${HIRAGANA}]`,
  kanji: `[${KANJI}]`,
  "kanji-char": `[${KANJI_CHAR}]`,
  kana: `(?:[${KATAKANA}]|[${HIRAGANA}])`,
  traditional: `(?:[${HIRAGANA}]|[${KANJI}])`,
  nonword: `[^${KANJI}ァ-ヺヽヾぁ-ゔゝゞー〇]`,
  number: "[0-9０-９〇一二三四五六七八九零壱弐参拾十百千万億兆京]",
};
const WHOLE = Object.fromEntries(
  Object.entries(CLASS_SOURCE).map(([k, v]) => [k, new RegExp(`^${v}+$`)]),
) as Record<IchiranCharClass, RegExp>;
const SINGLE = Object.fromEntries(
  Object.entries(CLASS_SOURCE).map(([k, v]) => [k, new RegExp(v, "g")]),
) as Record<IchiranCharClass, RegExp>;
const RUNS = Object.fromEntries(
  Object.entries(CLASS_SOURCE).map(([k, v]) => [k, new RegExp(`${v}+`, "g")]),
) as Record<IchiranCharClass, RegExp>;

export function testWord(word: string, cls: IchiranCharClass): boolean {
  return WHOLE[cls].test(word);
}
export function countCharClass(word: string, cls: IchiranCharClass): number {
  SINGLE[cls].lastIndex = 0;
  return word.match(SINGLE[cls])?.length ?? 0;
}
export function consecutiveCharGroups(
  cls: IchiranCharClass,
  str: string,
): [number, number][] {
  const out: [number, number][] = [];
  for (const m of str.matchAll(RUNS[cls]))
    out.push([m.index!, m.index! + m[0].length]);
  return out;
}
export function sequentialKanjiPositions(word: string, offset = 0): number[] {
  const out: number[] = [];
  const re = /[々一-龯]/;
  for (let i = 0; i + 1 < word.length; i++)
    if (re.test(word[i]) && re.test(word[i + 1])) out.push(i + 1 + offset);
  return out;
}
export function kanjiMask(word: string): string {
  return word.replace(new RegExp(`[${KANJI}]+`, "g"), "%");
}
const regexCache = new Map<string, RegExp>();
export function kanjiRegex(word: string): RegExp {
  let re = regexCache.get(word);
  if (!re) {
    const body = [...kanjiMask(word)]
      .map((c) => (c === "%" ? "[\\s\\S]+" : c.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&")))
      .join("");
    re = new RegExp(`^${body}$`);
    if (regexCache.size > 10000) regexCache.clear();
    regexCache.set(word, re);
  }
  return re;
}
export function kanjiMatch(word: string, reading: string): boolean {
  return kanjiRegex(word).test(reading);
}
/** Index of first mismatching character, or null if equal (CL `mismatch`). */
export function mismatch(a: string, b: string): number | null {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? null : n;
}
export function kanjiCrossMatch(
  word: string,
  reading: string,
  newWord: string,
): string | null {
  const m = mismatch(word, newWord);
  if (m === null) throw new Error("kanji-cross-match on identical words");
  const rCut = m + (reading.length - word.length);
  if (m > 0 && rCut >= 0 && rCut <= reading.length)
    return reading.slice(0, rCut) + newWord.slice(m);
  return null;
}
const MODIFIER_CHARS = "っッぁァぃィぅゥぇェぉォゃャゅュょョー";
export function moraLength(str: string): number {
  let n = 0;
  for (const c of str) if (!MODIFIER_CHARS.includes(c)) n++;
  return n;
}
export function asHiragana(str: string): string {
  let out = "";
  for (const raw of str) {
    const c = toNormalChar(raw) ?? raw;
    const cls = charClass.get(c);
    out += cls ? classChars.get(cls)![0] : c;
  }
  return out;
}
export function asKatakana(str: string): string {
  let out = "";
  for (const raw of str) {
    const c = toNormalChar(raw) ?? raw;
    const cls = charClass.get(c);
    out += cls ? classChars.get(cls)!.at(-1)! : c;
  }
  return out;
}
function replaceFirst(txt: string, table: Record<string, string>): string {
  if (!txt) return txt;
  const first = txt[0];
  const cls = charClass.get(first);
  const to = cls && table[cls];
  if (!to) return txt;
  const pos = classChars.get(cls)!.indexOf(first);
  return classChars.get(to)![pos] + txt.slice(1);
}
export function rendaku(txt: string, handakuten = false): string {
  return replaceFirst(txt, handakuten ? HANDAKUTEN : DAKUTEN);
}
export function unrendaku(txt: string): string {
  return replaceFirst(txt, UNDAKUTEN);
}
export function geminate(txt: string): string {
  return txt ? txt.slice(0, -1) + "っ" : txt;
}
/** Remove `stem` kana characters (and anything in the way) from the end. */
export function destem(word: string, stem: number): string {
  if (stem === 0) return word;
  const positions: number[] = [];
  SINGLE.kana.lastIndex = 0;
  for (const m of word.matchAll(SINGLE.kana)) positions.push(m.index!);
  positions.reverse();
  const tail = positions[stem - 1];
  return tail === undefined ? "" : word.slice(0, tail);
}
export function kanjiPrefix(word: string): string {
  const m = new RegExp(`^.*[${KANJI}]`).exec(word);
  return m ? m[0] : "";
}

/** words cannot start or end after sokuon and before yoon characters */
export function findStickyPositions(str: string): number[] {
  const out: number[] = [];
  const len = str.length;
  for (let pos = 0; pos < len; pos++) {
    const c = str[pos];
    const cls = getCharClass(c)!;
    if (
      cls === "sokuon" &&
      pos !== len - 1 &&
      KANA_CLASSES.has(getCharClass(str[pos + 1])!)
    )
      out.push(pos + 1);
    else if (
      MODIFIER_CLASSES.has(cls) &&
      !(
        pos === len - 1 &&
        (cls === "long-vowel" ||
          (pos > 0 && longVowelModifierP(cls, str[pos - 1])))
      )
    )
      out.push(pos);
  }
  return out;
}

const DECIMAL = "[.,]";
const DIGIT = "[0-9０-９〇]";
const WORD = `[${KANJI}ァ-ヺヽヾぁ-ゔゝゞー〇]`;
const NUM_WORD = `[0-9０-９〇${KANJI}ァ-ヺヽヾぁ-ゔゝゞー]`;
const BASIC_SPLIT = new RegExp(
  `((?:(?<!${DECIMAL}|${DIGIT})${DIGIT}+|${WORD})${NUM_WORD}*${WORD}|${WORD})`,
  "g",
);
export interface BasicSegment {
  type: "word" | "misc";
  text: string;
  start: number;
  end: number;
}
/** Split into runs of Japanese words and other material (basic-split). */
export function basicSplit(str: string): BasicSegment[] {
  const out: BasicSegment[] = [];
  let last = 0;
  for (const m of str.matchAll(BASIC_SPLIT)) {
    if (m.index! > last)
      out.push({ type: "misc", text: str.slice(last, m.index), start: last, end: m.index! });
    if (m[0].length)
      out.push({ type: "word", text: m[0], start: m.index!, end: m.index! + m[0].length });
    last = m.index! + m[0].length;
  }
  if (last < str.length)
    out.push({ type: "misc", text: str.slice(last), start: last, end: str.length });
  // Upstream alternates types starting from whether the first piece is nonword.
  if (out.length) {
    let misc = testWord(out[0].text, "nonword");
    for (const seg of out) {
      seg.type = misc ? "misc" : "word";
      misc = !misc;
    }
  }
  return out;
}

/** Optimal matching of two strings (match-diff); returns [match, value]. */
export type DiffPart = string | [string, string];
export function matchDiff(s1: string, s2: string): [DiffPart[], number] | null {
  const l1 = s1.length,
    l2 = s2.length;
  if (l1 === 0 || l2 === 0) return null;
  const m = mismatch(s1, s2);
  if (m === null) return [[s1], l1];
  if (l1 === 1 || l2 === 1) return [[[s1, s2]], 0];
  if (m === 0) {
    let best: DiffPart[] | null = null,
      bestValue: number | null = null;
    for (let i = 1; i < l1; i++)
      for (let j = 1; j < l2; j++)
        if (s1[i] === s2[j]) {
          const r = matchDiff(s1.slice(i), s2.slice(j));
          if (r && (bestValue === null || r[1] > bestValue)) {
            best = [[s1.slice(0, i), s2.slice(0, j)], ...r[0]];
            bestValue = r[1];
          }
        }
    return best ? [best, bestValue!] : null;
  }
  if (m === l1)
    return [[s1.slice(0, l1 - 1), [s1.slice(l1 - 1), s2.slice(l1 - 1)]], l1 - 1];
  if (m === l2)
    return [[s2.slice(0, l2 - 1), [s1.slice(l2 - 1), s2.slice(l2 - 1)]], l2 - 1];
  const r = matchDiff(s1.slice(m), s2.slice(m));
  return r ? [[s1.slice(0, m), ...r[0]], r[1] + m] : null;
}
