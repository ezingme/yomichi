/** Exact port of Ichiran numbers.lisp (Timofei Shatrov, MIT). Values are
 * BigInt so that 京-scale numbers survive. */
import { geminate, rendaku } from "./chars.js";

type NumClass = ["jd" | "p" | "ad", number];
const CHAR_NUMBER: [string, NumClass][] = [
  ["〇零", ["jd", 0]], ["一壱", ["jd", 1]], ["二弐", ["jd", 2]], ["三参", ["jd", 3]],
  ["四", ["jd", 4]], ["五", ["jd", 5]], ["六", ["jd", 6]], ["七", ["jd", 7]],
  ["八", ["jd", 8]], ["九", ["jd", 9]], ["十拾", ["p", 1]], ["百", ["p", 2]],
  ["千", ["p", 3]], ["万", ["p", 4]], ["億", ["p", 8]], ["兆", ["p", 12]], ["京", ["p", 16]],
  ["0０", ["ad", 0]], ["1１", ["ad", 1]], ["2２", ["ad", 2]], ["3３", ["ad", 3]], ["4４", ["ad", 4]],
  ["5５", ["ad", 5]], ["6６", ["ad", 6]], ["7７", ["ad", 7]], ["8８", ["ad", 8]], ["9９", ["ad", 9]],
];
const charNumber = new Map<string, NumClass>();
for (const [chars, cls] of CHAR_NUMBER) for (const c of chars) charNumber.set(c, cls);

export const DIGIT_TO_KANA: Record<number, string> = {
  0: "れい", 1: "いち", 2: "に", 3: "さん", 4: "よん", 5: "ご", 6: "ろく", 7: "なな", 8: "はち", 9: "きゅう",
};
export const POWER_TO_KANA: Record<number, string> = {
  1: "じゅう", 2: "ひゃく", 3: "せん", 4: "まん", 8: "おく", 12: "ちょう", 16: "けい",
};
const DIGIT_KANJI_DEFAULT = "〇一二三四五六七八九";
const POWER_KANJI = "一十百千万   億   兆   京";

export class NotANumber extends Error {}

export function numberToKanji(n: bigint, sen1 = false): string {
  if (n < 0n) throw new Error("negative");
  if (n === 0n) return DIGIT_KANJI_DEFAULT[0];
  let mp = 1n,
    mc = "";
  let p = 1n;
  for (let i = 0; i < POWER_KANJI.length; i++, p *= 10n) {
    if (p > n) break;
    const c = POWER_KANJI[i];
    if (c !== " ") {
      mp = p;
      mc = c;
    }
  }
  if (mp === 1n) return DIGIT_KANJI_DEFAULT[Number(n)];
  const qt = n / mp,
    rem = n % mp;
  return (
    (qt === 1n && mp <= (sen1 ? 100n : 1000n) ? "" : numberToKanji(qt, true)) +
    mc +
    (rem === 0n ? "" : numberToKanji(rem))
  );
}

function parseArr(na: NumClass[], start: number, end: number): bigint {
  let mp = 0,
    mi: number | null = null;
  for (let i = start; i < end; i++) {
    const [cls, val] = na[i];
    if (cls === "p" && val > mp) {
      mp = val;
      mi = i;
    }
  }
  if (mi === null) {
    let acc = 0n;
    for (let i = start; i < end; i++) acc = acc * 10n + BigInt(na[i][1]);
    return acc;
  }
  const pow = 10n ** BigInt(mp);
  if (mi === start)
    return pow + (start + 1 < end ? parseArr(na, start + 1, end) : 0n);
  return (
    parseArr(na, start, mi) * pow +
    (mi + 1 < end ? parseArr(na, mi + 1, end) : 0n)
  );
}

export function parseNumber(str: string): bigint {
  const na = [...str].map((c) => {
    const cls = charNumber.get(c);
    if (!cls) throw new NotANumber(`${str} is not a number: Invalid character: ${c}`);
    return cls;
  });
  return parseArr(na, 0, na.length);
}

function numSandhi(
  c1: string | null,
  v1: number | null,
  c2: string,
  v2: number,
  s1: string,
  s2: string,
): string {
  if (c1 === "jd" && c2 === "p") {
    if (v1 === 1 && [3, 12, 16].includes(v2)) s1 = geminate(s1);
    else if (v1 === 3 && [2, 3].includes(v2)) s2 = rendaku(s2);
    else if (v1 === 6) {
      if (v2 === 2) {
        s1 = geminate(s1);
        s2 = rendaku(s2, true);
      } else if (v2 === 16) s1 = geminate(s1);
    } else if (v1 === 8) {
      if (v2 === 2) {
        s1 = geminate(s1);
        s2 = rendaku(s2, true);
      } else if ([3, 12, 16].includes(v2)) s1 = geminate(s1);
    }
  } else if (c1 === "p" && c2 === "p") {
    if (v1 === 1 && [12, 16].includes(v2)) s1 = geminate(s1);
    else if (v1 === 2 && v2 === 16) s1 = geminate(s1);
  }
  return s1 + s2;
}

function groupToKana(group: NumClass[]): string {
  let result = "",
    lastClass: string | null = null,
    lastVal: number | null = null;
  for (const [cls, val] of group) {
    const kana = (cls === "jd" ? DIGIT_TO_KANA : POWER_TO_KANA)[val];
    result = numSandhi(lastClass, lastVal, cls, val, result, kana);
    lastClass = cls;
    lastVal = val;
  }
  return result;
}

export function numberToKana(n: bigint, separator = " "): string {
  const groups: NumClass[][] = [];
  let cur: NumClass[] = [];
  let lastClass: string | null = null,
    lastVal = 0;
  for (const k of numberToKanji(n)) {
    const [cls, val] = charNumber.get(k)!;
    if (
      !lastClass ||
      (cls === "p" &&
        (lastClass === "jd" || (lastClass === "p" && val > lastVal)))
    )
      cur.push([cls, val]);
    else {
      groups.push(cur);
      cur = [[cls, val]];
    }
    lastClass = cls;
    lastVal = val;
  }
  groups.push(cur);
  return groups.map(groupToKana).join(separator);
}
