/** Counter sandhi and special-counter tables ported from Ichiran dict-counters.lisp
 * Copyright Timofei Shatrov, MIT. These are pronunciation rules, not dictionary
 * entries or glosses. A caller can supply dictionary-backed counter definitions. */
import { geminate, rendaku } from "./characters.js";
import { numberToKana, parseJapaneseNumber } from "./numbers.js";
export interface CounterDigitOptions {
  number?: string;
  counter?: string;
  geminate?: boolean;
  voice?: boolean;
  halfVoice?: boolean;
}
export interface CounterDefinition {
  surface: string;
  reading: string;
  foreign?: boolean;
  digitOptions?: Readonly<Record<number, CounterDigitOptions>>;
  disableSandhi?: boolean;
  nativeDigits?: readonly number[];
  allowed?: readonly number[];
  kind?: "days-kun" | "days-on" | "people" | "age" | "tsu" | "month";
  suffixes?: readonly string[];
}
export interface CounterComponent {
  surface: string;
  reading: string | null;
  start: number;
  end: number;
  kind: "number" | "counter" | "suffix" | "prefix";
}
export interface CounterCandidate {
  surface: string;
  reading: string;
  value: string;
  counter: string;
  start: number;
  end: number;
  ordinal: boolean;
  components: CounterComponent[];
}
const definitions: CounterDefinition[] = [];
function add(
  surfaces: string,
  reading: string,
  options: Omit<CounterDefinition, "surface" | "reading"> = {},
) {
  for (const surface of surfaces.split("|"))
    definitions.push({ surface, reading, ...options });
}
// Productive common counters. Exceptions below replace the relevant rows.
for (const pair of "倍:ばい 秒:びょう 着:ちゃく 挺:ちょう 台:だい 度:ど 服:ふく 幅:ふく 発:はつ 課:か 回:かい ヵ月:かげつ ヶ月:かげつ か月:かげつ 箇月:かげつ 機:き 個:こ 箇:か 脚:きゃく 枚:まい 巻:かん 名:めい 列:れつ 輪:りん 輌:りょう 両:りょう 冊:さつ 隻:せき 艘:そう 反:たん 滴:てき 点:てん 頭:とう 通:つう 対:つい 週間:しゅうかん 週:しゅう 番:ばん 期:き 丁:ちょう 割:わり 割引:わりびき".split(
  " ",
)) {
  const [s, r] = pair.split(":");
  add(s, r);
}
const r = { voice: true },
  h = { halfVoice: true };
for (const [s, k] of [
  ["階", "かい"],
  ["本", "ほん"],
  ["匹|疋", "ひき"],
  ["杯|盃", "はい"],
  ["軒", "けん"],
  ["遍", "へん"],
  ["編|篇", "へん"],
  ["足", "そく"],
])
  add(s, k, { digitOptions: { 3: r } });
for (const [s, k] of [
  ["舗", "ほ"],
  ["敗", "はい"],
  ["泊", "はく"],
  ["筆", "ひつ"],
  ["分", "ふん"],
  ["分間", "ふんかん"],
])
  add(s, k, { digitOptions: { 4: h } });
for (const [s, k] of [
  ["時", "じ"],
  ["年", "ねん"],
  ["年生", "ねんせい"],
])
  add(s, k, {
    digitOptions: {
      4: { number: "よ" },
      7: { number: "しち" },
      9: { number: "く" },
    },
    ...(s === "年" ? { suffixes: ["間"] } : {}),
  });
for (const [s, k] of [
  ["時間", "じかん"],
  ["時半", "じはん"],
])
  add(s, k, { digitOptions: { 4: { number: "よ" }, 9: { number: "く" } } });
for (const [s, k] of [
  ["畳", "じょう"],
  ["帖", "じょう"],
  ["膳", "ぜん"],
])
  add(s, k, { digitOptions: { 4: { number: "よ" }, 7: { number: "しち" } } });
for (const [s, k] of [
  ["段", "だん"],
  ["条", "じょう"],
])
  add(s, k, { digitOptions: { 7: { number: "しち" } } });
for (const [s, k] of [
  ["首", "しゅ"],
  ["章", "しょう"],
])
  add(s, k, { digitOptions: { 10: {} } });
for (const [s, k] of [
  ["世紀", "せいき"],
  ["傑", "けつ"],
  ["袋", "たい"],
])
  add(s, k, { digitOptions: { 10: { number: "じっ" } } });
for (const [s, k] of [
  ["円", "えん"],
  ["字", "じ"],
])
  add(s, k, { digitOptions: { 4: { number: "よ" } } });
add("羽", "わ", {
  digitOptions: {
    3: { counter: "ば" },
    6: { geminate: true, counter: "ぱ" },
    10: { geminate: true, counter: "ぱ" },
    100: { geminate: true, counter: "ぱ" },
    1000: { counter: "ば" },
    10000: { counter: "ば" },
  },
});
add("把", "わ", {
  digitOptions: {
    3: { counter: "ば" },
    7: { number: "しち" },
    10: { geminate: true, counter: "ぱ" },
  },
});
add("立て|たて|タテ", "たて", { disableSandhi: true });
// Native hito/futa/mi counter stems, preserving multiple possible readings.
for (const row of [
  "株:かぶ:12",
  "竿|棹:さお:12345",
  "本:もと:123",
  "口:くち:123",
  "皿|盤:さら:123",
  "山:やま:123",
  "重ね|襲:かさね:123",
  "振り|風:ふり:12:off",
  "針|鉤|鈎:はり:12:off",
  "盛り|盛:もり:12",
  "切り|限り|限:きり:123",
  "切れ:きれ:123",
  "折:おり:12",
  "束:たば:12",
  "柱:はしら:12:off",
  "通り:とおり:12",
  "度:たび:12:off",
  "棟:むね:12",
  "晩:ばん:123",
  "腹|肚:はら:12:off",
  "房|総:ふさ:12:off",
  "粒:つぶ:123",
  "一刎:はね:123:off",
  "箱|函|匣|筥|筐|凾:はこ:12",
  "船|舟:ふね:123:off",
  "締め|〆:しめ:12",
  "間:ま:12349",
  "咫:あた:123",
  "梱:こり:12",
  "品:しな:123",
  "袋:ふくろ:123",
  "回り|廻り:まわり:12",
  "ケース:ケース:12",
  "缶:かん:12",
  "齣|コマ:こま:12",
  "桁:けた:123",
  "筋:すじ:123",
  "包み:つつみ:123",
  "片:ひら:123",
  "腰:こし:123",
  "緡:さし:123",
  "駅:えき:12",
  "揃え:そろえ:12",
]) {
  const [s, k, d, off] = row.split(":");
  const opts: Record<number, CounterDigitOptions> = {};
  if (
    [
      "竿|棹",
      "切り|限り|限",
      "切れ",
      "晩",
      "箱|函|匣|筥|筐|凾",
      "間",
      "品",
      "袋|",
    ].includes(s) ||
    s === "袋"
  )
    opts[4] = { number: "よ" };
  if (s === "竿|棹") opts[10] = {};
  if (s === "切り|限り|限" || s === "切れ") opts[8] = {};
  if (s === "通り") opts[100] = { geminate: true };
  if (s === "粒") opts[6] = { geminate: true };
  if (s === "箱|函|匣|筥|筐|凾") {
    opts[1000] = {};
    opts[10000] = {};
  }
  if (s === "袋") opts[10] = { number: "じっ", halfVoice: true };
  add(s, k, {
    nativeDigits: [...d].map(Number),
    disableSandhi: off === "off",
    digitOptions: opts,
    foreign: s === "ケース",
  });
}
add("口", "こう");
add("重", "え", {
  nativeDigits: [1, 2, 3, 5, 7, 8, 9, 10],
  allowed: [1, 2, 3, 5, 7, 8, 9, 10],
});
add("重", "じゅう", {
  digitOptions: {
    4: { number: "し" },
    7: { number: "しち" },
    9: { number: "く" },
  },
});
add("組", "くみ", { nativeDigits: [1, 2, 3], allowed: [1, 2, 3] });
add("組", "くみ", { digitOptions: { 1: {} } });
add("つ", "つ", { kind: "tsu", allowed: [1, 2, 3, 4, 5, 6, 7, 8, 9] });
add("日", "か", {
  kind: "days-kun",
  allowed: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 20, 24, 30],
  suffixes: ["間"],
});
add("日", "にち", { kind: "days-on" });
add("月", "がつ", {
  kind: "month",
  allowed: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  digitOptions: {
    4: { number: "し" },
    7: { number: "しち" },
    9: { number: "く" },
  },
});
add("人", "にん", {
  kind: "people",
  digitOptions: { 4: { number: "よ" }, 7: { number: "しち" } },
  suffixes: ["中"],
});
add("歳|才", "さい", { kind: "age" });
export const BUILTIN_COUNTERS: readonly CounterDefinition[] = definitions;
const native = [
  "",
  "ひと",
  "ふた",
  "み",
  "よ",
  "いつ",
  "む",
  "なな",
  "や",
  "ここの",
  "と",
];
const dayReadings: Record<number, string> = {
  1: "ついたち",
  2: "ふつか",
  3: "みっか",
  4: "よっか",
  5: "いつか",
  6: "むいか",
  7: "なのか",
  8: "ようか",
  9: "ここのか",
  10: "とうか",
  14: "じゅうよっか",
  20: "はつか",
  24: "にじゅうよっか",
  30: "みそか",
};
function lastDigit(n: bigint): number {
  if (n % 10n) return Number(n % 10n);
  for (const [p, next] of [
    [10n, 100n],
    [100n, 1000n],
    [1000n, 10000n],
    [10000n, 100000000n],
  ])
    if (n % next) return Number(p);
  return 0;
}
/** Return all lexical counter readings by invoking this for each definition. */
export function counterReading(
  value: bigint | number,
  definition: CounterDefinition,
): string | null {
  const n = typeof value === "bigint" ? value : BigInt(value);
  if (n < 0n) return null;
  const exact = Number(n),
    d = lastDigit(n),
    def = definition;
  if (def.allowed && !def.allowed.some((x) => BigInt(x) === n)) return null;
  if (def.kind === "days-on" && ((n <= 10n && n !== 1n) || n === 20n))
    return null;
  if (def.kind === "days-kun") return dayReadings[exact] ?? null;
  if (def.kind === "tsu")
    return (
      [
        "",
        "ひとつ",
        "ふたつ",
        "みっつ",
        "よっつ",
        "いつつ",
        "むっつ",
        "ななつ",
        "やっつ",
        "ここのつ",
      ][exact] ?? null
    );
  if (def.kind === "people" && (n === 1n || n === 2n))
    return n === 1n ? "ひとり" : "ふたり";
  if (def.kind === "age" && n === 20n) return "はたち";
  if (def.nativeDigits?.some((x) => BigInt(x) === n))
    return native[exact] + def.reading;
  let number = numberToKana(n),
    counter = def.reading;
  const options = def.digitOptions?.[d];
  if (options) {
    if (options.number !== undefined) {
      const tail = numberToKana(d);
      number = number.slice(0, -tail.length) + options.number;
    }
    if (options.geminate) number = geminate(number);
    if (options.voice) counter = rendaku(counter);
    if (options.halfVoice) counter = rendaku(counter, true);
    if (options.counter) counter = options.counter;
    return number + counter;
  }
  if (def.disableSandhi) return number + counter;
  const head = counter[0],
    k = "かきくけこカキクケコ".includes(head),
    st = "さしすせそたちつてとサシスセソタチツテト".includes(head),
    hp = "はひふへほハヒフヘホ".includes(head),
    p = "ぱぴぷぺぽパピプペポ".includes(head);
  if (def.foreign) {
    if (
      (d === 6 && (k || p)) ||
      ([8, 10].includes(d) && (k || st || p)) ||
      (d === 100 && k)
    )
      number = geminate(number);
  } else {
    if (
      (d === 1 && (k || st || hp)) ||
      (d === 6 && (k || hp || p)) ||
      ([8, 10].includes(d) && (k || st || hp || p)) ||
      (d === 100 && (k || hp))
    )
      number = geminate(number);
    if (hp && [1, 3, 6, 8, 10, 100, 1000, 10000].includes(d))
      counter = rendaku(counter, true);
  }
  return number + counter;
}
const suffixReading: Record<string, string> = {
  目: "め",
  間: "かん",
  間後: "かんご",
  中: "ちゅう",
};
/** Candidates beginning at an original UTF-16 position. Includes bare integers;
 * never emits dictionary IDs or fabricated glosses. Longest candidates first. */
export function findCounterCandidates(
  text: string,
  start = 0,
  additionalDefinitions: readonly CounterDefinition[] = [],
): CounterCandidate[] {
  if (start < 0 || start >= text.length || !Number.isInteger(start)) return [];
  if (text[start] === "第")
    return findCounterCandidates(text, start + 1, additionalDefinitions).map(
      (candidate) => ({
        ...candidate,
        start,
        surface: text.slice(start, candidate.end),
        reading: "だい" + candidate.reading,
        ordinal: true,
        components: [
          {
            surface: "第",
            reading: "だい",
            start,
            end: start + 1,
            kind: "prefix" as const,
          },
          ...candidate.components,
        ],
      }),
    );
  const match =
    /^[0-9０-９〇零一壱二弐三参四五六七八九十拾百千万億兆京]+/u.exec(
      text.slice(start),
    );
  if (!match) return [];
  const numberSurface = match[0],
    n = parseJapaneseNumber(numberSurface);
  if (n === null) return [];
  const split = start + numberSurface.length;
  const result: CounterCandidate[] = [
    {
      surface: numberSurface,
      reading: numberToKana(n),
      value: String(n),
      counter: "",
      start,
      end: split,
      ordinal: false,
      components: [
        {
          surface: numberSurface,
          reading: numberToKana(n),
          start,
          end: split,
          kind: "number",
        },
      ],
    },
  ];
  for (const def of [...definitions, ...additionalDefinitions]) {
    if (!text.startsWith(def.surface, split)) continue;
    const reading = counterReading(n, def);
    if (reading === null) continue;
    const tail = split + def.surface.length;
    const suffixes = [
      "",
      ...(def.suffixes ?? []),
      ...(def.surface.endsWith("目") ? [] : ["目"]),
    ];
    for (const suffix of suffixes) {
      if (suffix && !text.startsWith(suffix, tail)) continue;
      const end = tail + suffix.length;
      result.push({
        surface: text.slice(start, end),
        reading: reading + (suffixReading[suffix] ?? ""),
        value: String(n),
        counter: def.surface,
        start,
        end,
        ordinal: suffix === "目" || def.surface.endsWith("目"),
        components: [
          {
            surface: numberSurface,
            reading: null,
            start,
            end: split,
            kind: "number",
          },
          {
            surface: def.surface,
            reading: null,
            start: split,
            end: tail,
            kind: "counter",
          },
          ...(suffix
            ? [
                {
                  surface: suffix,
                  reading: suffixReading[suffix] ?? null,
                  start: tail,
                  end,
                  kind: "suffix" as const,
                },
              ]
            : []),
        ],
      });
    }
  }
  const seen = new Set<string>();
  return result
    .sort((a, b) => b.end - a.end)
    .filter((c) => {
      const key = c.surface + "\0" + c.reading;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
