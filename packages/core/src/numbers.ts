/** Port of Ichiran numbers.lisp algorithms and reading tables.
 * Copyright Timofei Shatrov, MIT. Exact integer arithmetic uses bigint. */
export const JAPANESE_NUMBER_PATTERN =
  /[0-9０-９〇零一壱二弐三参四五六七八九十拾百千万億兆京]+/gu;
const digits = "〇一二三四五六七八九";
const digitValues: Record<string, number> = { 零: 0, 壱: 1, 弐: 2, 参: 3 };
for (let i = 0; i < 10; i++) {
  digitValues[digits[i]] = i;
  digitValues[String(i)] = i;
  digitValues[String.fromCharCode(0xff10 + i)] = i;
}
const powers: Record<string, bigint> = {
  十: 10n,
  拾: 10n,
  百: 100n,
  千: 1000n,
  万: 10000n,
  億: 100000000n,
  兆: 1000000000000n,
  京: 10000000000000000n,
};
const units = Object.entries(powers)
  .filter(([k]) => k !== "拾")
  .reverse();
/** Upstream's recursive highest-power parsing permits mixed forms such as 100万500. */
export function parseJapaneseNumber(text: string): bigint | null {
  if (
    !text ||
    [...text].some((c) => digitValues[c] === undefined && !powers[c])
  )
    return null;
  const chars = [...text];
  function parse(start: number, end: number): bigint {
    let max = 0n,
      index = -1;
    for (let i = start; i < end; i++) {
      const p = powers[chars[i]] ?? 0n;
      if (p > max) {
        max = p;
        index = i;
      }
    }
    if (index < 0) {
      let n = 0n;
      for (let i = start; i < end; i++)
        n = n * 10n + BigInt(digitValues[chars[i]]);
      return n;
    }
    return (
      (index === start ? 1n : parse(start, index)) * max + parse(index + 1, end)
    );
  }
  return parse(0, chars.length);
}
function integer(value: number | bigint): bigint {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0))
    throw new RangeError("Expected a nonnegative safe integer or bigint");
  const n = BigInt(value);
  if (n < 0n) throw new RangeError("Expected a nonnegative integer");
  return n;
}
export function numberToKanji(
  value: number | bigint,
  options: { legal?: boolean; oneThousand?: boolean } = {},
): string {
  const n = integer(value),
    ds = options.legal ? "〇壱弐参四五六七八九" : digits;
  function convert(x: bigint, oneThousand = false): string {
    if (x < 10n) return ds[Number(x)];
    const [unit, power] = units.find(([, p]) => p <= x)!;
    const quotient = x / power,
      rest = x % power;
    return (
      (quotient === 1n && power <= (oneThousand ? 100n : 1000n)
        ? ""
        : convert(quotient, true)) +
      (options.legal && unit === "十" ? "拾" : unit) +
      (rest ? convert(rest) : "")
    );
  }
  return convert(n, options.oneThousand);
}
const digitKana = [
  "れい",
  "いち",
  "に",
  "さん",
  "よん",
  "ご",
  "ろく",
  "なな",
  "はち",
  "きゅう",
];
const powerKana: Record<string, string> = {
  十: "じゅう",
  百: "ひゃく",
  千: "せん",
  万: "まん",
  億: "おく",
  兆: "ちょう",
  京: "けい",
};
/** Join groups without spaces by default; separator exposes upstream reading groups. */
export function numberToKana(
  value: number | bigint,
  options: { separator?: string } = {},
): string {
  const kanji = numberToKanji(value);
  const groups: string[] = [];
  let previous = "",
    group = "";
  for (const c of kanji) {
    let reading = powerKana[c] ?? digitKana[digitValues[c]];
    const power = powers[c];
    const prevPower = powers[previous];
    const connects = !!previous && !!power && (!prevPower || power > prevPower);
    if (!connects && group) {
      groups.push(group);
      group = "";
    }
    if (connects) {
      if (previous === "三" && (c === "百" || c === "千"))
        reading = c === "百" ? "びゃく" : "ぜん";
      if ((previous === "六" || previous === "八") && c === "百") {
        group = group.slice(0, -1) + "っ";
        reading = "ぴゃく";
      } else if (
        ((previous === "一" || previous === "八") &&
          ["千", "兆", "京"].includes(c)) ||
        (previous === "六" && c === "京") ||
        (previous === "十" && ["兆", "京"].includes(c)) ||
        (previous === "百" && c === "京")
      )
        group = group.slice(0, -1) + "っ";
    }
    group += reading;
    previous = c;
  }
  if (group) groups.push(group);
  return groups.join(options.separator ?? "");
}
