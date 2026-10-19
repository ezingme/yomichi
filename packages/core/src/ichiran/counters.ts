/** Port of Ichiran dict-counters.lisp (Timofei Shatrov, MIT). */
import { geminate, getCharClass, testWord, rendaku } from "./chars.js";
import { S } from "./state.js";
import {
  DIGIT_TO_KANA,
  POWER_TO_KANA,
  NotANumber,
  numberToKana,
  numberToKanji,
  parseNumber,
} from "./numbers.js";
import { KANA_HINT_SPACE } from "./split.js";
import {
  bundle,
  makeWord,
  type SimpleLike,
  type SimpleText,
} from "./dict.js";
import type { ReadingRow } from "./store.js";

export type CounterClass =
  | "counter-text"
  | "number-text"
  | "counter-halfhour"
  | "counter-tsu"
  | "counter-hifumi"
  | "counter-days-kun"
  | "counter-days-on"
  | "counter-months"
  | "counter-people"
  | "counter-wari"
  | "counter-age";
type DigitOpt = [number | "off", ...(string | "g" | "r" | "h" | "c")[]];

interface CounterArgs {
  cls: CounterClass;
  text: string;
  kana: string;
  source: SimpleText | null;
  ordinalp?: boolean;
  suffix?: string | null;
  accepts?: string[];
  suffixDescriptions?: string[];
  digitOpts?: DigitOpt[];
  /** undefined = not given; null = :null */
  common?: number | null;
  allowed?: number[] | null;
  foreign?: boolean;
  digitSet?: number[];
}
export interface CounterText extends Required<Omit<CounterArgs, "common" | "allowed" | "digitSet" | "source">> {
  kind: "counter";
  source: SimpleLike | null;
  common: number | null | undefined;
  allowed: number[] | null;
  digitSet: number[];
  numberText: string;
  numberValue: bigint;
}

const CLASS_DEFAULTS: Partial<Record<CounterClass, Partial<CounterArgs>>> = {
  "number-text": { text: "", kana: "", ordinalp: false },
  "counter-days-kun": { allowed: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 20, 24, 30] },
  "counter-months": {
    allowed: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    digitOpts: [[4, "し"], [7, "しち"], [9, "く"]],
  },
};

export function counterText(w: CounterText): string {
  return w.numberText + w.text;
}

function getDigit(n: bigint): number | null {
  const digit = Number(n % 10n);
  if (digit !== 0) return digit;
  const ps = [10n, 100n, 1000n, 10000n, 100000000n];
  for (let i = 0; i < ps.length; i++) {
    const pn = ps[i + 1];
    if (pn !== undefined && n % pn !== 0n) return Number(ps[i]);
  }
  return null;
}

const ROW = {
  ka: ["ka", "ki", "ku", "ke", "ko"],
  sa: ["sa", "shi", "su", "se", "so"],
  ta: ["ta", "chi", "tsu", "te", "to"],
  ha: ["ha", "hi", "fu", "he", "ho"],
  pa: ["pa", "pi", "pu", "pe", "po"],
};
const inRows = (head: string | undefined, ...rows: (keyof typeof ROW)[]) =>
  !!head && rows.some((r) => ROW[r].includes(head));

function counterJoin(obj: CounterText, n: bigint, numberKana: string, counterKana: string): string {
  if (obj.cls === "number-text") return numberKana + counterKana;
  const digit = getDigit(n);
  const head = getCharClass(counterKana[0]);
  const digitOpts = obj.digitOpts.find((o) => o[0] === digit);
  const off = obj.digitOpts.find((o) => o[0] === "off");
  if (off || digitOpts) {
    let modCounter = false;
    for (const opt of (digitOpts ?? []).slice(1) as string[]) {
      if (opt === "g") numberKana = geminate(numberKana);
      else if (opt === "r") counterKana = rendaku(counterKana);
      else if (opt === "h") counterKana = rendaku(counterKana, true);
      else if (opt === "c") modCounter = true;
      else if (modCounter) counterKana = opt;
      else {
        const stem = (
          digit! < 10 ? DIGIT_TO_KANA[digit!] : POWER_TO_KANA[Math.round(Math.log10(digit!))]
        ).length;
        numberKana = numberKana.slice(0, numberKana.length - stem) + opt;
      }
    }
    return numberKana + counterKana;
  }
  if (obj.foreign) {
    if (
      (digit === 6 && inRows(head, "ka", "pa")) ||
      ((digit === 8 || digit === 10) && inRows(head, "ka", "sa", "ta", "pa")) ||
      (digit === 100 && inRows(head, "ka"))
    )
      numberKana = geminate(numberKana);
    return numberKana + counterKana;
  }
  const gemH = () => {
    numberKana = geminate(numberKana);
    counterKana = rendaku(counterKana, true);
  };
  switch (digit) {
    case 1:
      if (inRows(head, "ka", "sa", "ta")) numberKana = geminate(numberKana);
      else if (inRows(head, "ha")) gemH();
      break;
    case 3:
      if (inRows(head, "ha")) counterKana = rendaku(counterKana, true);
      break;
    case 6:
      if (inRows(head, "ka", "pa")) numberKana = geminate(numberKana);
      else if (inRows(head, "ha")) gemH();
      break;
    case 8:
    case 10:
      if (inRows(head, "ka", "sa", "ta", "pa")) numberKana = geminate(numberKana);
      else if (inRows(head, "ha")) gemH();
      break;
    case 100:
      if (inRows(head, "ka")) numberKana = geminate(numberKana);
      else if (inRows(head, "ha")) gemH();
      break;
    case 1000:
    case 10000:
      if (inRows(head, "ha")) counterKana = rendaku(counterKana, true);
      break;
  }
  return numberKana + counterKana;
}

function baseKana(obj: CounterText): string {
  const n = obj.numberValue;
  const v = Number(n);
  switch (obj.cls) {
    case "number-text":
      return numberToKana(n, KANA_HINT_SPACE);
    case "counter-tsu": {
      const t = ["", "ひとつ", "ふたつ", "みっつ", "よっつ", "いつつ", "むっつ", "ななつ", "やっつ", "ここのつ"];
      if (v >= 1 && v <= 9) return t[v];
      break;
    }
    case "counter-hifumi":
      if (obj.digitSet.includes(v)) {
        const t = ["", "ひと", "ふた", "み", "よ", "いつ", "む", "なな", "や", "ここの", "と"];
        return t[v] + obj.kana;
      }
      break;
    case "counter-days-kun":
      return (
        {
          1: "ついたち", 2: "ふつか", 3: "みっか", 4: "よっか", 5: "いつか", 6: "むいか",
          7: "なのか", 8: "ようか", 9: "ここのか", 10: "とうか", 14: "じゅうよっか",
          20: "はつか", 24: "にじゅうよっか", 30: "みそか",
        } as Record<number, string>
      )[v] ?? "";
    case "counter-people":
      if (v === 1) return "ひとり";
      if (v === 2) return "ふたり";
      break;
    case "counter-age":
      if (v === 20) return "はたち";
      break;
  }
  return counterJoin(obj, n, numberToKana(n, KANA_HINT_SPACE), obj.kana);
}
export function counterGetKana(obj: CounterText): string {
  const kana = baseKana(obj);
  return obj.suffix ? kana + obj.suffix : kana;
}
export function counterGetKanji(obj: CounterText): string {
  return numberToKanji(obj.numberValue) + obj.text;
}

function ordinalStr(n: bigint): string {
  const d = Number(n % 10n),
    m = Number(n % 100n);
  const teen = m > 10 && m < 20;
  return `${n}${teen ? "th" : d === 1 ? "st" : d === 2 ? "nd" : d === 3 ? "rd" : "th"}`;
}
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function valueString(c: CounterText): string {
  switch (c.cls) {
    case "counter-halfhour":
      return `${c.numberValue}:30`;
    case "counter-months":
      return MONTHS[Number(c.numberValue) - 1];
    case "counter-wari":
      return `${10n * c.numberValue}%`;
  }
  const v = c.ordinalp ? ordinalStr(c.numberValue) : String(c.numberValue);
  return `Value: ${v}${[...c.suffixDescriptions].reverse().map((d) => " " + d).join("")}`;
}

function verify(c: CounterText, unique: boolean): boolean {
  const n = Number(c.numberValue);
  if (c.cls === "counter-tsu") return n >= 1 && n <= 9 && unique;
  const base = (!c.allowed || c.allowed.includes(n)) && unique;
  if (c.cls === "counter-days-on") return (n > 10 || n === 1) && n !== 20 && base;
  return base;
}

// ---------------------------------------------------------------------------
// Counter cache

const COUNTER_SUFFIXES: Record<string, [string, string, string]> = {
  kan: ["間", "かん", "[duration]"],
  kango: ["間後", "かんご", "[after ...]"],
  chuu: ["中", "ちゅう", "[among/out of ...]"],
};
const COUNTER_ACCEPTS: Record<number, string[]> = {
  1194480: ["kan"],
  1490430: ["kan"],
  1333450: ["kan", "kango"],
};
const COUNTER_FOREIGN = new Set([1120410]);
const EXTRA_COUNTER_IDS = [1255430, 1606800];
const SKIP_COUNTER_IDS = new Set([
  2426510, 2220370, 2248360, 2423450, 2671670, 2735690, 2838543, 2249290,
  2833260, 2833465, 2833466, 2833467,
]);

type Spec = { cls: CounterClass; text: string | string[]; kana: string; suffix?: string; textParts?: string[] } & Omit<
  Partial<CounterArgs>,
  "cls" | "text" | "kana" | "source"
>;
const a = (cls: CounterClass, text: string | string[], kana: string, keys: Partial<Spec> = {}): Spec => ({
  cls,
  text,
  kana,
  ...keys,
});
const SPECIAL: Record<number, Spec[]> = {
  1203020: [a("counter-text", "階", "かい", { digitOpts: [[3, "r"]] })],
  2020680: [a("counter-text", "時", "じ", { digitOpts: [[4, "よ"], [7, "しち"], [9, "く"]] })],
  1315920: [a("counter-text", "時間", "じかん", { digitOpts: [[4, "よ"], [9, "く"]] })],
  1658480: [a("counter-halfhour", "時半", "じはん", { digitOpts: [[4, "よ"], [9, "く"]] })],
  1356740: [a("counter-text", "畳", "じょう", { digitOpts: [[4, "よ"], [7, "しち"]] })],
  2258110: [a("counter-text", "帖", "じょう", { digitOpts: [[4, "よ"], [7, "しち"]] })],
  1396490: [a("counter-text", "膳", "ぜん", { digitOpts: [[4, "よ"], [7, "しち"]] })],
  1427240: [
    a("counter-text", "丁", "ちょう"),
    { cls: "counter-text", text: "丁目", kana: "ちょう", suffix: "め", textParts: ["丁", "目"], ordinalp: true },
  ],
  1427420: [a("counter-text", "丁目", "ちょうめ", { ordinalp: true })],
  1514050: [a("counter-text", "舗", "ほ", { digitOpts: [[4, "h"]] })],
  1522150: [a("counter-text", "本", "ほん", { digitOpts: [[3, "r"]] })],
  1583370: [a("counter-text", ["匹", "疋"], "ひき", { digitOpts: [[3, "r"]] })],
  1607310: [
    a("counter-text", "羽", "わ", {
      digitOpts: [[3, "c", "ば"], [6, "g", "c", "ぱ"], [10, "g", "c", "ぱ"], [100, "g", "c", "ぱ"], [1000, "c", "ば"], [10000, "c", "ば"]],
    }),
  ],
  1607320: [a("counter-text", "把", "わ", { digitOpts: [[3, "c", "ば"], [7, "しち"], [10, "g", "c", "ぱ"]] })],
  1633690: [a("counter-text", "段", "だん", { digitOpts: [[7, "しち"]] })],
  1901390: [a("counter-text", "敗", "はい", { digitOpts: [[4, "h"]] })],
  1919550: [a("counter-text", "泊", "はく", { digitOpts: [[4, "h"]] })],
  1994890: [a("counter-text", "首", "しゅ", { digitOpts: [[10]] })],
  1351270: [a("counter-text", "章", "しょう", { digitOpts: [[10]] })],
  2019640: [a("counter-text", ["杯", "盃"], "はい", { digitOpts: [[3, "r"]] })],
  2078550: [a("counter-text", "条", "じょう", { digitOpts: [[7, "しち"]] })],
  2078590: [a("counter-text", "軒", "けん", { digitOpts: [[3, "r"]] })],
  2081610: [a("counter-text", ["立て", "たて", "タテ"], "たて", { digitOpts: [["off"]] })],
  2084840: [a("counter-text", "年", "ねん", { digitOpts: [[4, "よ"], [7, "しち"], [9, "く"]], accepts: ["kan"] })],
  1468900: [a("counter-text", "年生", "ねんせい", { digitOpts: [[4, "よ"], [7, "しち"], [9, "く"]] })],
  1502840: [a("counter-text", "分", "ふん", { digitOpts: [[4, "h"]] })],
  2386360: [a("counter-text", "分間", "ふんかん", { digitOpts: [[4, "h"]] })],
  1373990: [a("counter-text", "世紀", "せいき", { digitOpts: [[10, "じっ"]] })],
  2836694: [a("counter-text", "傑", "けつ", { digitOpts: [[10, "じっ"]] })],
  2208060: [a("counter-text", "遍", "へん", { digitOpts: [[3, "r"]] })],
  1511870: [a("counter-text", ["編", "篇"], "へん", { digitOpts: [[3, "r"]] })],
  2271620: [a("counter-text", "口", "こう")],
  2412230: [a("counter-text", "足", "そく", { digitOpts: [[3, "r"]] })],
  1175570: [a("counter-text", "円", "えん", { digitOpts: [[4, "よ"]] })],
  1315130: [a("counter-text", "字", "じ", { digitOpts: [[4, "よ"]] })],
  1487770: [a("counter-text", "筆", "ひつ", { digitOpts: [[4, "h"]] })],
  2220330: [a("counter-tsu", "つ", "つ")],
  1208920: [a("counter-hifumi", "株", "かぶ", { digitSet: [1, 2] })],
  1214060: [a("counter-hifumi", ["竿", "棹"], "さお", { digitSet: [1, 2, 3, 4, 5], digitOpts: [[4, "よ"], [10]] })],
  1260670: [a("counter-hifumi", "本", "もと", { digitSet: [1, 2, 3] })],
  1275640: [a("counter-hifumi", "口", "くち", { digitSet: [1, 2, 3] })],
  1299680: [a("counter-hifumi", ["皿", "盤"], "さら", { digitSet: [1, 2, 3] })],
  1302680: [a("counter-hifumi", "山", "やま", { digitSet: [1, 2, 3] })],
  1335810: [a("counter-hifumi", ["重ね", "襲"], "かさね", { digitSet: [1, 2, 3] })],
  1361130: [a("counter-hifumi", ["振り", "風"], "ふり", { digitSet: [1, 2], digitOpts: [["off"]] })],
  1366210: [a("counter-hifumi", ["針", "鉤", "鈎"], "はり", { digitSet: [1, 2], digitOpts: [["off"]] })],
  1379650: [a("counter-hifumi", ["盛り", "盛"], "もり", { digitSet: [1, 2] })],
  1383800: [a("counter-hifumi", ["切り", "限り", "限"], "きり", { digitSet: [1, 2, 3], digitOpts: [[4, "よ"], [8]] })],
  1384840: [a("counter-hifumi", "切れ", "きれ", { digitSet: [1, 2, 3], digitOpts: [[4, "よ"], [8]] })],
  1385780: [a("counter-hifumi", "折", "おり", { digitSet: [1, 2] })],
  1404450: [a("counter-hifumi", "束", "たば", { digitSet: [1, 2] })],
  1426480: [a("counter-hifumi", "柱", "はしら", { digitSet: [1, 2], digitOpts: [["off"]] })],
  1432920: [a("counter-hifumi", "通り", "とおり", { digitSet: [1, 2], digitOpts: [[100, "g"]] })],
  1445150: [a("counter-hifumi", "度", "たび", { digitSet: [1, 2], digitOpts: [["off"]], common: null })],
  1448350: [a("counter-hifumi", "棟", "むね", { digitSet: [1, 2] })],
  1335730: [a("counter-hifumi", "重", "え", { digitSet: [1, 2, 3, 5, 7, 8, 9, 10], allowed: [1, 2, 3, 5, 7, 8, 9, 10] })],
  2108240: [a("counter-text", "重", "じゅう", { digitOpts: [[4, "し"], [7, "しち"], [9, "く"]] })],
  1482110: [a("counter-hifumi", "晩", "ばん", { digitSet: [1, 2, 3], digitOpts: [[4, "よ"]] })],
  1501110: [a("counter-hifumi", ["腹", "肚"], "はら", { digitSet: [1, 2], digitOpts: [["off"]] })],
  1397450: [
    a("counter-hifumi", "組", "くみ", { digitSet: [1, 2, 3], allowed: [1, 2, 3], suffixDescriptions: ["(sets or pairs only)"] }),
    a("counter-text", "組", "くみ", { digitOpts: [[1]] }),
  ],
  1519300: [a("counter-hifumi", ["房", "総"], "ふさ", { digitSet: [1, 2], digitOpts: [["off"]] })],
  1552890: [a("counter-hifumi", "粒", "つぶ", { digitSet: [1, 2, 3], digitOpts: [[6, "g"]] })],
  1564410: [a("counter-hifumi", "一刎", "はね", { digitSet: [1, 2, 3], digitOpts: [["off"]] })],
  1585650: [
    a("counter-hifumi", ["箱", "函", "匣", "筥", "筐", "凾"], "はこ", { digitSet: [1, 2], digitOpts: [[4, "よ"], [1000], [10000]] }),
  ],
  1602800: [a("counter-hifumi", ["船", "舟"], "ふね", { digitSet: [1, 2, 3], digitOpts: [["off"]] })],
  1853450: [a("counter-hifumi", ["締め", "〆"], "しめ", { digitSet: [1, 2] })],
  1215240: [a("counter-hifumi", "間", "ま", { digitSet: [1, 2, 3, 4, 9], digitOpts: [[4, "よ"]] })],
  2243700: [a("counter-hifumi", "咫", "あた", { digitSet: [1, 2, 3] })],
  2414730: [a("counter-hifumi", "梱", "こり", { digitSet: [1, 2] })],
  1583470: [a("counter-hifumi", "品", "しな", { digitSet: [1, 2, 3], digitOpts: [[4, "よ"]] })],
  1411070: [a("counter-hifumi", "袋", "ふくろ", { digitSet: [1, 2, 3], digitOpts: [[4, "よ"], [10, "じっ", "h"]] })],
  2707020: [a("counter-text", "袋", "たい", { digitOpts: [[10, "じっ"]] })],
  2800530: [a("counter-hifumi", ["回り", "廻り"], "まわり", { digitSet: [1, 2] })],
  1047880: [a("counter-hifumi", "ケース", "ケース", { digitSet: [1, 2], foreign: true })],
  1214540: [a("counter-hifumi", "缶", "かん", { digitSet: [1, 2] })],
  1575510: [a("counter-hifumi", ["齣", "コマ"], "こま", { digitSet: [1, 2] })],
  1253800: [a("counter-hifumi", "桁", "けた", { digitSet: [1, 2, 3] })],
  1241750: [a("counter-hifumi", "筋", "すじ", { digitSet: [1, 2, 3] })],
  1515340: [a("counter-hifumi", "包み", "つつみ", { digitSet: [1, 2, 3] })],
  2452360: [a("counter-hifumi", "片", "ひら", { digitSet: [1, 2, 3] })],
  2844070: [a("counter-hifumi", "腰", "こし", { digitSet: [1, 2, 3] })],
  2844196: [a("counter-hifumi", "緡", "さし", { digitSet: [1, 2, 3] })],
  1175140: [a("counter-hifumi", "駅", "えき", { digitSet: [1, 2] })],
  2855028: [a("counter-hifumi", "揃え", "そろえ", { digitSet: [1, 2] })],
  2083110: [a("counter-days-kun", "日", "か", { common: 0, accepts: ["kan"] })],
  2083100: [a("counter-days-on", "日", "にち")],
  1255430: [a("counter-months", "月", "がつ")],
  2149890: [a("counter-people", "人", "にん", { digitOpts: [[4, "よ"], [7, "しち"]], accepts: ["chuu"] })],
  1606800: [a("counter-wari", "割", "わり")],
  1606950: [a("counter-wari", "割引", "わりびき")],
  1294940: [a("counter-age", ["歳", "才"], "さい")],
};

function getCounterReadings(): Map<number, [ReadingRow[], ReadingRow[]]> {
  const ids = [...S().store.counterSeqList(), ...EXTRA_COUNTER_IDS].filter((s) => !SKIP_COUNTER_IDS.has(s));
  const kanjiRows: ReadingRow[] = [],
    kanaRows: ReadingRow[] = [];
  for (const seq of [...new Set(ids)]) {
    const b = bundle(seq);
    if (!b) continue;
    const ctrSenses = new Set(b.props.filter((p) => p.tag === "pos" && p.text === "ctr").map((p) => p.senseId));
    const stagk = b.props.filter((p) => p.tag === "stagk" && ctrSenses.has(p.senseId)).map((p) => p.text);
    const stagr = b.props.filter((p) => p.tag === "stagr" && ctrSenses.has(p.senseId)).map((p) => p.text);
    for (const r of b.readings)
      if (r.table === "kanji" ? !stagk.length || stagk.includes(r.text) : !stagr.length || stagr.includes(r.text))
        (r.table === "kanji" ? kanjiRows : kanaRows).push(r);
  }
  const byPhys = (x: ReadingRow, y: ReadingRow) => (x.phys ?? x.id) - (y.phys ?? y.id);
  kanjiRows.sort(byPhys);
  kanaRows.sort(byPhys);
  const hash = new Map<number, [ReadingRow[], ReadingRow[]]>();
  for (const r of kanjiRows) {
    const v = hash.get(r.seq) ?? [[], []];
    v[0].push(r);
    hash.set(r.seq, v);
  }
  for (const r of kanaRows) {
    const v = hash.get(r.seq) ?? [[], []];
    v[1].push(r);
    hash.set(r.seq, v);
  }
  for (const v of hash.values()) {
    v[0].sort((x, y) => x.ord - y.ord);
    v[1].sort((x, y) => x.ord - y.ord);
  }
  return hash;
}

type CounterCache = Map<string, CounterArgs[]>;
function buildCounterCache(): CounterCache {
  const cache: CounterCache = new Map();
  const push = (text: string, args: CounterArgs) => cache.set(text, [args, ...(cache.get(text) ?? [])]);
  const addArgsStar = (text: string, args: CounterArgs) => {
    push(text, args);
    for (const suf of args.accepts ?? []) {
      const [sufText, sufKana, sufDesc] = COUNTER_SUFFIXES[suf];
      const newText = text + sufText;
      push(newText, {
        ...args,
        text: newText,
        suffix: (args.suffix ?? "") + sufKana,
        suffixDescriptions: [sufDesc, ...(args.suffixDescriptions ?? [])],
      });
    }
  };
  addArgsStar("", { cls: "number-text", text: "", kana: "", source: null });
  for (const [seq, [kanji, kana]] of getCounterReadings()) {
    const readings = [...kanji, ...kana];
    const find = (t: string) => {
      const r = readings.find((x) => x.text === t);
      return r ? makeWord(r) : null;
    };
    const special = SPECIAL[seq];
    if (special) {
      for (const spec of special) {
        const { text, textParts, ...rest } = spec;
        if (textParts) {
          const t = textParts.join("");
          addArgsStar(t, { ...rest, text: t, source: find(textParts[0]) } as CounterArgs);
        } else if (Array.isArray(text)) {
          for (const t of text) addArgsStar(t, { ...rest, text: t, source: find(t) } as CounterArgs);
        } else addArgsStar(text, { ...rest, text, source: find(text) } as CounterArgs);
      }
    } else {
      const foreign = !kanji.length || COUNTER_FOREIGN.has(seq);
      const kts = foreign ? [...kanji, ...kana.filter((k) => testWord(k.text, "katakana"))] : kanji;
      for (const kt of kts)
        addArgsStar(kt.text, {
          cls: "counter-text",
          text: kt.text,
          kana: kana[0]?.text ?? "",
          source: makeWord(kt),
          ordinalp: kt.text.length > 1 && kt.text.endsWith("目"),
          accepts: COUNTER_ACCEPTS[kt.seq],
          foreign,
        });
    }
  }
  for (const counter of [...cache.keys()]) {
    const cord = counter + "目";
    if (!counter || (counter.length > 1 && counter.endsWith("目")) || cache.has(cord)) continue;
    for (const old of cache.get(counter)!) {
      if (old.ordinalp) continue;
      addArgsStar(cord, { ...old, text: cord, suffix: (old.suffix ?? "") + "め", ordinalp: true });
    }
  }
  return cache;
}
function counterCache(): CounterCache {
  const store = S().store;
  const existing = store.extras.get("counters") as CounterCache | undefined;
  if (existing) return existing;
  const hadMisses = store.hasMisses();
  const built = buildCounterCache();
  if (!hadMisses && !store.hasMisses()) store.extras.set("counters", built);
  return built;
}

function makeCounter(args: CounterArgs, numberText: string): CounterText {
  const d = CLASS_DEFAULTS[args.cls] ?? {};
  return {
    kind: "counter",
    cls: args.cls,
    text: args.text ?? d.text ?? "",
    kana: args.kana ?? d.kana ?? "",
    source: args.source,
    ordinalp: args.ordinalp ?? d.ordinalp ?? false,
    suffix: args.suffix ?? null,
    accepts: args.accepts ?? [],
    suffixDescriptions: args.suffixDescriptions ?? [],
    digitOpts: args.digitOpts ?? d.digitOpts ?? [],
    common: "common" in args ? args.common : undefined,
    allowed: args.allowed ?? d.allowed ?? null,
    foreign: args.foreign ?? false,
    digitSet: args.digitSet ?? [],
    numberText,
    numberValue: parseNumber(numberText),
  };
}

export function findCounter(number: string, counter: string, unique = true): CounterText[] {
  const list = counterCache().get(counter);
  if (!list) return [];
  const out: CounterText[] = [];
  for (const args of list) {
    let obj: CounterText;
    try {
      obj = makeCounter(args, number);
    } catch (e) {
      if (e instanceof NotANumber) continue;
      throw e;
    }
    if (verify(obj, unique)) out.push(obj);
  }
  return out;
}
