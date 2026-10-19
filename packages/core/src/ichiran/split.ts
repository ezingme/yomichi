/** Port of Ichiran dict-split.lisp (Timofei Shatrov, MIT): word splits that
 * score an entry as several words, segment splits, and kana hints. */
import { matchDiff, unrendaku } from "./chars.js";
import { EASY_HINTS } from "./easy-hints.js";
import { matchReadings } from "./kanji.js";
import {
  calcScore,
  findWordConjOf,
  findWordSeq,
  getKana,
  isSimple,
  seqOf,
  setWordConjugations,
  textOf,
  trueKana,
  trueKanji,
  trueText,
  wordConjData,
  wordType,
  type CompoundText,
  type Segment,
  type SimpleLike,
} from "./dict.js";

// ---------------------------------------------------------------------------
// Splits

interface Ctx {
  len: number;
  txt: string;
  r: SimpleLike;
}
type Len = number | ((c: Ctx) => number | null) | null;
type PartSeq = number | number[] | [string, number];
type Part =
  | { seq: PartSeq; len?: Len; conj?: boolean; modify?: true | ((t: string) => string) }
  | { test: (c: Ctx) => boolean; score?: number; push?: "score" | "pscore" }
  | "score"
  | "pscore";
type SplitResult = [(SimpleLike | null | "score" | "pscore")[], number];
export type SplitDef = (r: SimpleLike) => SplitResult | null;

class SplitAbort extends Error {}
const pos = (txt: string, c: string): number => {
  const i = txt.indexOf(c);
  if (i < 0) throw new SplitAbort();
  return i;
};
function safeSubseq(s: string, start: number, end: number | null): string | null {
  if (start < 0 || start > s.length) return null;
  if (end !== null && (end < start || end > s.length)) return null;
  return end === null ? s.slice(start) : s.slice(start, end);
}

function simpleSplit(seq: number, score: number, parts: Part[]): SplitDef {
  return (r) => {
    const txt = trueText(r);
    const ctx: Ctx = { len: txt.length, txt, r };
    let offset = 0,
      sc = score;
    const out: SplitResult[0] = [];
    try {
      for (const part of parts) {
        if (part === "score" || part === "pscore") {
          out.push(part);
          continue;
        }
        if ("test" in part) {
          if (!part.test(ctx)) {
            if (part.score !== undefined) sc = part.score;
            if (part.push) out.push(part.push);
            break;
          }
          continue;
        }
        let pseq: number[];
        if (typeof part.seq === "number") pseq = [part.seq];
        else if (typeof part.seq[0] === "string") {
          const [t, of] = part.seq as [string, number];
          const w = findWordConjOf(t, of)[0];
          pseq = w ? [seqOf(w)!] : [];
        } else pseq = part.seq as number[];
        const plen =
          part.len === undefined || part.len === null
            ? null
            : typeof part.len === "number"
              ? part.len
              : part.len(ctx);
        const ptxt = safeSubseq(txt, offset, plen === null ? null : offset + plen);
        if (pseq.includes(seq)) out.push(null);
        else if (ptxt !== null) {
          const t = part.modify === true ? unrendaku(ptxt) : part.modify ? part.modify(ptxt) : ptxt;
          out.push((part.conj ? findWordConjOf(t, ...pseq) : findWordSeq(t, ...pseq))[0] ?? null);
        } else out.push(null);
        if (plen !== null) offset += plen;
      }
    } catch (e) {
      if (e instanceof SplitAbort) return null;
      throw e;
    }
    return [out, sc];
  };
}

const p = (seq: PartSeq, len?: Len, conj?: boolean, modify?: true | ((t: string) => string)): Part => ({
  seq,
  len,
  conj,
  modify,
});
const rest = (seq: PartSeq) => p(seq, null, true);
const isKanji: Part = { test: (c) => wordType(c.r) === "kanji" };
const isKana: Part = { test: (c) => wordType(c.r) === "kana" };
const txtIs = (s: string): Part => ({ test: (c) => c.txt === s });
const minus = (n: number) => (c: Ctx) => c.len - n;
const after = (ch: string) => (c: Ctx) => pos(c.txt, ch) + 1;
const at = (ch: string) => (c: Ctx) => pos(c.txt, ch);
const optprefix = (prefix: string) => (t: string) => (t.startsWith(prefix) ? t : prefix + t);

const SPLITS = new Map<number, SplitDef>();
const def = (seq: number, score: number, parts: Part[]) => SPLITS.set(seq, simpleSplit(seq, score, parts));

for (const [seq, seqA] of [
  [1163700, 1576150], [1611020, 1577100], [1004800, 1628530], [2810720, 1004820],
  [1006840, 1006880], [1530610, 1530600], [1245390, 1245290], [2719270, 1445430],
  [1189420, 2416780], [1272220, 1592990], [1311360, 1311350], [1368500, 1368490],
  [1395670, 1395660], [1417790, 1417780], [1454270, 1454260], [1479100, 1679020],
  [1510140, 1680900], [1518550, 1529560], [1531420, 1531410], [1597400, 1585205],
  [1679990, 2582460], [1682060, 2085340], [1736650, 1611710], [1865020, 1590150],
  [1878880, 2423450], [2126220, 1802920], [2136520, 2005870], [2513590, 2513650],
  [2771850, 2563780], [2810800, 1587590], [1343110, 1343100], [1270210, 1001640],
])
  def(seq, 20, [p(seqA, minus(1)), p(2028980, 1)]);
def(2253080, 20, [p(2028980, 1), rest(1612690)]);
for (const [seq, seqA, seqB] of [
  [1260990, 1260670, 1432930], [1414570, 2082450, 1432930], [1424950, 1620400, 1432930],
  [1424960, 1423310, 1432930], [1820790, 1250090, 1432930], [1489800, 1489340, 1432930],
  [1523010, 1522150, 1432930], [1808080, 1604890, 1432930], [1368820, 1580640, 1432930],
  [1550490, 1550190, 1432930], [1619440, 2069220, 1432930], [1164910, 2821500, 1432920],
  [1462720, 1461140, 1432920],
])
  def(seq, 50, [isKanji, p(seqA, minus(2)), p(seqB, 2)]);
for (const [seq, seqB] of [[2142710, 1185200], [2803190, 1595630], [2142680, 1290210], [2523480, 1442750]])
  def(seq, 30, [p(2252690, 1), p(seqB)]);
for (const [seq, seqB] of [
  [1005700, 1156990], [1005830, 1370760], [1157200, 2772730], [1157220, 1195970],
  [1157230, 1284430], [1157280, 1370090], [1157310, 1405800], [1304890, 1256520],
  [1304960, 1307550], [1305110, 1338180], [1305280, 1599390], [1305290, 1212670],
  [1594300, 1596510], [1594310, 1406680], [1594460, 1372620], [1594580, 1277100],
  [2518250, 1332760], [1157240, 1600260], [1304820, 1207610], [2858937, 1406690],
])
  def(seq, 30, [p(["し", 1157170], 1), rest(seqB)]);
def(1529550, 30, [p(["無く", 1529520], 2), rest(1375610)]);
def(1518540, 10, [isKana, p(["亡く", 1518450], 2), rest(1375610)]);
def(2089710, 10, [p(1327190, 1), p(2028930, 1), rest(1207590)]);
def(1411570, 10, [p([1590770, 1510720], after("り")), p(["映え", 1600620], 2)]);
def(2815260, 100, [
  p(1404975, after("い")),
  p(1502390, (c) => (c.txt.includes("物") ? 1 : 2)),
  p(2028980, 1),
]);
def(2800540, 30, [p(2252690, 1), p(2028930, 1), rest(1495740)]);
def(2819990, 20, [p(["じゃない", 2089020], 4), p(2028970, 1)]);
def(1609470, 50, [isKanji, p(1514990, 1), p(1005340, 2)]);
def(1006650, 5, [p(2137720, 2), p(2089020)]);
def(2837492, 5, [p(2137720, 2), p(1628500)]);
def(1221750, 100, [p(1221520, 1), p(1469800, 1), p(1610040, 2)]);
def(1599590, 20, [p(1188490, minus(2)), p(2143350, 2)]);
def(2102910, 20, [p(1258950, at("を")), p(2029010, 1), rest(1508390)]);
def(2057340, 300, [p(1363050, at("な")), p(2246510)]);
def(1951150, 50, [p(["決まって", 1591420])]);
def(1236680, 100, [p(1236660, after("れ")), rest(1465580)]);
def(2104540, 20, [p(1188420, after("か")), rest(1375610)]);
def(2610760, 50, [p(["弾け", 1419380], after("け")), rest(1429700)]);
def(1315700, 50, [p(["持って", 1315720], after("て")), rest(1578850)]);
def(1465460, 100, [isKanji, p(["入り", 1465590], after("り")), rest(1288790)]);
def(1881080, 30, [p(1310720, 1), p(2028990, 1), rest(1207590)]);
def(1903910, 50, [p(1601890, at("に")), p(2028990, 1), p(["なって", 1375610], null)]);
def(1009600, 50, [p(2028990, 1), p(["取って", 1326980])]);
def(2215340, 100, [p(1313580, at("に")), p(2028990, 1), rest(1157170)]);
def(1419350, 100, [p(1901710, after("き")), rest(1338180)]);
def(1368740, 100, [
  p(1580640, (c) => (c.txt.includes("人") ? 1 : 2)),
  p(1416220, (c) => (c.txt.includes("達") ? 1 : 2)),
]);
def(2034520, 30, [p(2028980, 1), p([2827091])]);
def(1524660, 50, [p(1524640, at("に")), p(2028990, 1)]);
def(1693800, 50, [p(2826528, 1), p(1609810)]);
def(1752860, 50, [p(1636070, 2), p(["支え", 1310090])]);
def(1922760, 20, [p(1008490, 1), rest(1587040)]);
def(2612990, 30, [p(1922760, 3), p(1313580, minus(4)), p(2089020)]);
def(2100770, 50, [p(1008490, 1), p(["なったら", 1375610])]);
def(2100900, 10, [p(1008490, 1), rest(1375610)]);
def(1327220, 50, [p(1327190, 1), p(2028990, 1), rest(1465590)]);
def(1327230, 50, [p(1327190, 1), p(2028990, 1), rest(1465610)]);
def(2433760, 50, [p(1006610, 2), p(2683060)]);
def(2088480, 20, [p(1634130, 2), p(2006580, 1)]);
def(2724560, 30, [p(1469800, 1), p(1610040, minus(2)), p(2028980, 1)]);
def(2666360, 30, [p(["少なくない", 1348910])]);
def(2755350, 10, [p(2089020, 2), rest(1529520)]);
def(2135280, 10, [p(2089020, 2), p(2139720, 1)]);
def(2771940, -5, [txtIs("はないか"), p(2028920, 1), p(1529520, 2), p(2028970, 1)]);
def(1009470, 1, [p(["なら", 2089020])]);
def(2083990, 20, [txtIs("ならん"), p(1009470, 2), p(2139720, 1)]);
def(2762260, 0, [p(["ならんで", 1508380])]);
def(1508380, 10, [isKana, p(2083990, 3), p(2028980, 1)]);
def(2009290, 100, [p(1423310, minus(2)), p(1008460)]);
def(1502500, 100, [p(1502390, minus(2)), p(1277450, 2, false, true)]);
def(1002970, 600, [isKanji, p(2143350, 2), p(["知れない", 1420490])]);
def(1005600, -10, [p(["しまった", 1305380])]);
def(2016840, -5, [p(["やった", 1012980])]);
def(1000430, -5, [p(1000420)]);
def(1612640, 5, [p(1000420, 2), p([2029080, 2029120, 1005110])]);
def(1314600, -5, [p(2028990, 1), rest(1529520)]);
def(1322540, -5, [p(2028990, 1), rest(1529520)]);
def(1221680, 50, [p(1221520, 1), p(2028990, 1), rest(1157170)]);
def(1538340, 50, [p(1538330, at("が")), p(2028930, 1), rest(1606560)]);
def(2757500, 50, [p(1538330, at("の")), p(1469800, 1), rest(1606560)]);
def(1315860, 20, [p(1315840, minus(2)), p(2215430, 2)]);
def(1474200, -10, [isKana, p(2028920, 1), rest(1577980)]);
def(2276360, 10, [p(2436480, minus(1)), p(2086640, 1)]);
def(1579130, -1, [txtIs("ことし"), p(1313580, 2), p(2086640, 1)]);
def(2668400, 50, [p(1213060, at("を")), p(2029010, 1), rest(1552120)]);
def(1591050, 100, [p(1221520, 1), p(2028930, 1), rest(1495740)]);
def(2835890, 50, [p(1385860, 5), p(1319060, 1)]);
def(1894260, 50, [
  { test: (c) => c.len > 3 },
  p(["付いて", 1894260], 3),
  p(1577980, null, true, optprefix("い")),
]);
def(1854750, 20, [p(["付いて", 1495740])]);
def(2526850, 10, [p(2028990, 1), p(["しろ", 1157170])]);
def(2026650, 10, [p(2028990, 1), p(["せよ", 1157170])]);
def(1602740, 50, [p(1497180, minus(1)), p(2093780)]);
def(1349300, 5, [p(2029110, 1), p(2826528)]);
def(1221530, 50, [p(1221520, 1), p(2028930, 1), rest(1296400)]);
def(2272780, 50, [p(1221520, 1), p(2028930, 1), rest(1529520)]);
def(2846470, 50, [p(1221520, 1), p(2028920, 1), rest(1529520)]);
def(1591980, 50, [p(1221520, 1), p(2029010, 1), rest(1305990)]);
def(1551500, 50, [p(["立ち", 1597040], 2), rest(1570220)]);
def(2002270, 50, [p(["零れ", 1557650], after("れ")), rest(1548550)]);
def(1314770, -10, [isKana, p(2028990, 1), rest(1495740)]);
def(1008030, -10, ["score"]);
def(1597740, 5, [isKana, p(1008030, 2), p(2081610)]);
def(1581550, 10, [
  { test: (c) => c.txt.startsWith("雪") },
  p(1386500, 1),
  p(2028930, 1),
  { test: (c) => c.len > 2, score: -2, push: "pscore" },
  rest(1529520),
]);
def(1601080, -5, [p(2028920, 1), rest(1310680)]);
def(2529050, 30, [p(1322990, (c) => (c.txt.startsWith("もの") ? 2 : 1)), p(1234250)]);
def(1006280, 30, [p(1157170, 2), p(1008490, 1)]);
def(2757540, 90, [p(1896380, 1), p(2728200)]);
def(1606530, 100, [p(["分かり", 1606560], 3), rest(1384830)]);
def(2007500, 100, [p(["落ち", 1548550], 2), rest(1557650)]);
def(1532270, 100, [p(["あけまして", 1202450], 5), p(1001540)]);
def(2133750, 100, [p(1224890, after("く")), p(1001720)]);
def(1863230, 15, [isKana, p(1576870, 2), p(1416220)]);
def(2834051, 15, [isKana, p(1002290, 3), p(1416220)]);
def(1606800, 10, [{ test: (c) => c.len === 2 }, p(["割り", 1208000])]);
def(1207840, 50, [p(["割り", 1208000], 2), rest(1384860)]);
def(2109610, 50, [p(["有り", 1296400], 2), rest(1588760)]);
def(1322560, -10, [isKana, p(2028990, 1), rest(1226480)]);
def(1006880, 50, [p(1006830, 2), p(1352130)]);
def(1601010, 50, [p(["跳ね", 1429620], 2), rest(1352290)]);
def(1881690, 50, [p(1321900, at("を")), p(2029010, 1), rest(1298790)]);
def(2834732, -10, [rest(1707770)]);
def(1855670, 50, [p(["取り留め", 1707770], at("の")), p(1469800, 1), p(1529520)]);
def(2855921, 50, [p(["取り留め", 1707770], at("も")), p(2028940, 1), p(1529520)]);
def(1774820, -5, [isKana, p(1002980, 2), p(1277450)]);
def(1362970, 100, [p(["申し", 1363090], 2), rest(1589040)]);

function getSplitStar(reading: SimpleLike, conjOf: number[], map: Map<number, SplitDef>): SplitResult | null {
  const fn = map.get(seqOf(reading)!);
  if (fn) return fn(reading);
  for (const s of conjOf) {
    const f = map.get(s);
    if (f) return f(reading);
  }
  return null;
}
/** Includes the safety check that every split word was found. */
export function getSplit(
  reading: SimpleLike,
  conjOf: number[],
  map: Map<number, SplitDef> = SPLITS,
): [(SimpleLike | "score" | "pscore")[], number] | null {
  const r = getSplitStar(reading, conjOf, map);
  if (!r || !r[0].length || r[0].some((x) => x === null)) return null;
  return r as [(SimpleLike | "score" | "pscore")[], number];
}

// ---------------------------------------------------------------------------
// Segment splits

interface SegsplitAttrs {
  score: number;
  primary?: number;
  connector?: string;
  root?: number[];
}
const SEGSPLITS = new Map<number, SplitDef>();
const segAttrs = new Map<number, SegsplitAttrs>();
const segdef = (seq: number, attrs: SegsplitAttrs, parts: Part[]) => {
  SEGSPLITS.set(seq, simpleSplit(seq, 0, parts));
  segAttrs.set(seq, attrs);
};
segdef(1008570, { score: -10 }, [p(1343100, minus(1)), p(2028930, 1)]);
segdef(1343110, { score: -10, root: [1] }, [p(1343100, minus(1)), p(2028980, 1)]);
segdef(2009220, { score: -10 }, [p(1343100, minus(1)), p(2028970, 1)]);
segdef(2097010, { score: -10 }, [p(1343100, minus(1)), p(2029000, 1)]);
segdef(2136660, { score: -10 }, [p(1343100, minus(1)), p(2029010, 1)]);
segdef(1897510, { score: -10 }, [p(1343100, minus(2)), p(2028980, 1), p(2028920, 1)]);
segdef(2409240, { score: 20, primary: 1, connector: "" }, [p(2826528, 1), p(1582120)]);
segdef(1366490, { score: -10, connector: "" }, [p(1580640, minus(3)), p(1013240)]);
segdef(2028950, { score: -5 }, [p(1008490, 1), p(2028920, 1)]);
segdef(1008450, { score: -5 }, [p(2028980, 1), p(2028920, 1)]);
segdef(2394710, { score: -5 }, [p(1529520, 2), p(1008490, 1)]);
segdef(1011740, { score: -5 }, [p(1522150, minus(1)), p(1469800, 1)]);
segdef(1208870, { score: 5 }, [txtIs("かなって"), p(1002940, 2), p(2086960, 2)]);
segdef(1007310, { score: -5 }, [p(2089020, 1), p(1002980)]);
segdef(1675330, { score: 10, primary: 1 }, [p(1002980, 2), p(1260720)]);
segdef(2841254, { score: 5 }, [p(1002980, 2), p(2086960, 2)]);
segdef(1567610, { score: 5 }, [txtIs("もんだ"), p(1502390, 2), p(2089020)]);
segdef(1010105, { score: 5 }, [txtIs("はぐったり"), p(2028920, 1), p(1004070)]);

export function getSegsplit(segment: Segment): Segment | null {
  const word = segment.word;
  if (!isSimple(word)) return null;
  const conjOf = (segment.info?.seqSet ?? []).slice(1).filter((s): s is number => s !== null);
  const split = getSplit(word, conjOf, SEGSPLITS);
  if (!split) return null;
  const parts = split[0] as SimpleLike[];
  // the attributes belong to the definition that produced the split
  const key = SEGSPLITS.has(seqOf(word)!) ? seqOf(word)! : conjOf.find((s) => SEGSPLITS.has(s))!;
  const attrs = segAttrs.get(key)!;
  const connector = attrs.connector ?? " ";
  const compound: CompoundText = {
    kind: "compound",
    text: parts.map(textOf).join(""),
    kana: parts.map(getKana).join(connector),
    primary: parts[attrs.primary ?? 0],
    words: parts,
    scoreBase: null,
    scoreMod: attrs.score,
  };
  for (const i of attrs.root ?? []) setWordConjugations(parts[i], "root");
  const info = calcScore(compound.primary)[1];
  const conj = wordConjData(compound);
  return {
    ...segment,
    word: compound,
    text: compound.text,
    score: segment.score! + attrs.score,
    info: info
      ? { ...info, conj }
      : { posi: [], seqSet: [], conj, common: null, scoreInfo: [], kpcl: [false, false, false, false] },
  };
}

// ---------------------------------------------------------------------------
// Kana hints (indicate when to romanize は as わ etc.)

export const KANA_HINT_MOD = "‌";
export const KANA_HINT_SPACE = "​";
type Hint = ["space" | "mod", number];
export function insertHints(str: string, hints: Hint[]): string {
  if (!hints.length) return str;
  const len = str.length;
  const positions: string[][] = Array.from({ length: len + 1 }, () => []);
  for (const [kw, position] of hints)
    if (position >= 0 && position <= len)
      positions[position].push(kw === "space" ? KANA_HINT_SPACE : KANA_HINT_MOD);
  let out = "";
  for (let i = 0; i <= len; i++) {
    out += positions[i].join("");
    if (i < len) out += str[i];
  }
  return out;
}
export function processHints(word: string): string {
  return word
    .replaceAll(KANA_HINT_SPACE, " ")
    .replace(/‌([はハへヘ])/g, (_, c: string) => ({ は: "わ", ハ: "ワ", へ: "え", ヘ: "エ" })[c]!)
    .replaceAll(KANA_HINT_MOD, "");
}
export function stripHints(word: string): string {
  return word.replaceAll(KANA_HINT_SPACE, "").replaceAll(KANA_HINT_MOD, "");
}

type HintFn = (reading: SimpleLike) => string | null;
const HINTS = new Map<number, HintFn>();
/** def-simple-hint: `vars` may return null to abort the hint. */
function simpleHint(
  seqs: number[],
  build: (l: number, k: string) => Hint[] | null,
) {
  const fn: HintFn = (reading) => {
    const k = trueKana(reading);
    const hints = build(k.length, k);
    if (!hints) return null;
    return insertHints(getKana(reading), hints);
  };
  for (const s of seqs) HINTS.set(s, fn);
}
const endsHa = (k: string) => k.endsWith("は");
const lastIdx = (k: string, s: string) => {
  const i = k.lastIndexOf(s);
  return i < 0 ? null : i;
};
const firstIdx = (k: string, s: string) => {
  const i = k.indexOf(s);
  return i < 0 ? null : i;
};

simpleHint([2028920, 2029000], (l) => [["mod", l - 1]]);
simpleHint([1289480, 1289400, 1008450, 2215430, 2028950], (l, k) => (endsHa(k) ? [["mod", l - 1]] : null));
simpleHint(
  [
    1006660, 1008500, 1307530, 1320830, 1324320, 1524990, 1586850, 1877880,
    1897510, 1907300, 1912570, 2034440, 2098160, 2105820, 2134680, 2136300,
    2176280, 2177410, 2177420, 2177430, 2177440, 2177450, 2256430, 2428890,
    2523450, 2557290, 2673120, 2691570, 2702090, 2717440, 2717510, 2828541,
    1217970, 1331520, 1907290, 1914670, 1950430, 2136680, 2181810, 2181730,
    2576840, 1331510, 1010470, 2008290, 2136690, 2829815, 2830216, 2840063,
    2841096, 2841959, 2844687, 2844836, 2850535, 2861249,
  ],
  (l, k) => (endsHa(k) ? [["space", l - 1], ["mod", l - 1]] : null),
);
simpleHint([2844416], (l) => [["space", l - 1], ["mod", 0]]);
simpleHint([2097010, 1009150], (l) => [["space", l - 1], ["mod", l - 1]]);
simpleHint([2261800], (l) => [["space", 2], ["mod", 2], ["space", 3], ["space", l - 1], ["mod", l - 1]]);
simpleHint(
  [
    1009480, 1315860, 1406050, 2026610, 2061740, 2097310, 2101020, 2119920,
    2134700, 2200100, 2407650, 2553140, 2762790, 1288910, 1423320, 2099850,
    1006890,
  ],
  (l, k) => (endsHa(k) ? [["space", l - 2], ["mod", l - 1]] : null),
);
simpleHint([2089020, 2823770, 2098240, 2027020, 2135480, 2397760, 2724540, 2757720], (_l, k) => {
  const d = lastIdx(k, "では");
  return d === null ? null : [["mod", d + 1]];
});
simpleHint(
  [
    2027080, 2126160, 2126140, 2131120, 2136640, 2214830, 2221680, 2416950,
    2419210, 2664520, 2682500, 2775790, 1343120, 2112270, 2404260, 2758400,
    2827556, 2057560, 2841318, 2088970, 2833095, 2835662, 2841608, 2841609,
    2845739, 2849457, 2850045, 2854412,
  ],
  (_l, k) => {
    const d = lastIdx(k, "では");
    return d === null ? null : [["space", d], ["mod", d + 1]];
  },
);
simpleHint([2037860, 2694350, 2111220, 2694360, 2182700, 2142010], (_l, k) => {
  const d = lastIdx(k, "では");
  return d === null ? null : [["space", d], ["mod", d + 1], ["space", d + 2]];
});
simpleHint(
  [
    2057580, 2067990, 2103020, 2105980, 2152700, 2416920, 2418030, 2792210,
    2792420, 2417920, 2598720, 2420170, 2597190, 2597800, 2057570, 2419360,
    2121480, 2646440, 2740880, 2416860, 2156910, 2182690, 2848157,
  ],
  (_l, k) => {
    const n = lastIdx(k, "には");
    return n === null ? null : [["space", n], ["mod", n + 1], ["space", n + 2]];
  },
);
simpleHint([2181860, 2037320, 2125460, 2128060, 2070730], () => [["mod", 1], ["space", 2]]);
simpleHint([2832044], (l, k) => {
  const n = lastIdx(k, "には");
  return n === null ? null : [["space", n], ["mod", n + 1], ["space", n + 2], ["space", l - 1]];
});
simpleHint(
  [
    1008970, 1188440, 1193090, 1394290, 1855940, 1949380, 1981600, 1982230,
    2018320, 2062980, 2078930, 2089520, 2089620, 2098150, 2108910, 2115570,
    2118120, 2118430, 2118440, 2134480, 2135530, 2136710, 2141360, 2168360,
    2173880, 2174570, 2176450, 2177240, 2200690, 2210960, 2213470, 2255320,
    2275900, 2403520, 2408680, 2416870, 2416930, 2417040, 2417150, 2417980,
    2418090, 2418280, 2418800, 2418840, 2418920, 2419030, 2419350, 2419390,
    2419590, 2419600, 2419610, 2419620, 2420180, 2583560, 2585230, 2593830,
    2600530, 2618920, 2618990, 2708230, 2716900, 2737650, 2741810, 2744840,
    2827754, 2831359, 2833597, 2839953, 2844002, 2858918, 2862330,
  ],
  (_l, k) => {
    const h = lastIdx(k, "は");
    return h === null ? null : [["space", h], ["mod", h], ["space", h + 1]];
  },
);
simpleHint([2867144, 2867149], (_l, k) => {
  const h = firstIdx(k, "は");
  return h === null ? null : [["space", h], ["mod", h], ["space", h + 1]];
});
simpleHint([2716860], (_l, k) => {
  const h = firstIdx(k, "は"),
    n = lastIdx(k, "の");
  return h === null || n === null
    ? null
    : [["space", h], ["mod", h], ["space", h + 1], ["space", n], ["space", n + 1]];
});
simpleHint([2845260], (_l, k) => {
  const h1 = firstIdx(k, "は"),
    h2 = lastIdx(k, "は"),
    u = firstIdx(k, "う");
  return h1 === null || h2 === null || u === null
    ? null
    : [["space", h1], ["mod", h1], ["space", h1 + 1], ["space", u], ["space", h2], ["mod", h2], ["space", h2 + 1]];
});

// Easy hints: hint positions are derived from a word-split of the expression
// and translated onto the dictionary spelling and its kana reading.
function translateHintPosition(match: (string | [string, string, ...unknown[]])[], position: number): number | null {
  let off = 0,
    rem = position;
  for (const part of match) {
    if (typeof part === "string") {
      const len = part.length;
      if (rem <= len) return off + rem;
      rem -= len;
      off += len;
    } else {
      const len = part[0].length,
        clen = part[1].length;
      if (rem < len) return off + Math.min(1, Math.max(clen, rem));
      if (rem === len) return off + clen;
      rem -= len;
      off += clen;
    }
  }
  return null;
}
function translateHints(match: (string | [string, string, ...unknown[]])[], hints: Hint[]): Hint[] {
  const out: Hint[] = [];
  for (const [h, pos] of hints) {
    const np = translateHintPosition(match, pos);
    if (np !== null) out.push([h, np]);
  }
  return out;
}
for (const [seq, kanjiSplit] of EASY_HINTS) {
  const parts = kanjiSplit.split(" ");
  const text = parts.join("");
  const hints: Hint[] = [];
  let pos = 0;
  for (const part of parts) {
    if (pos !== 0) {
      hints.push(["space", pos]);
      if (["は", "へ", "には", "とは"].includes(part)) hints.push(["mod", pos + part.length - 1]);
    }
    pos += part.length;
  }
  HINTS.set(seq, (reading) => {
    const rtext = trueKanji(reading);
    if (rtext === null) return null;
    const md = matchDiff(text, rtext);
    const kr = matchReadings(rtext, trueKana(reading));
    if (!md || !kr) return null;
    return insertHints(getKana(reading), translateHints(kr, translateHints(md[0] as any, hints)));
  });
}

export function getHint(reading: SimpleLike): string | null {
  const seq = seqOf(reading)!;
  const direct = HINTS.get(seq);
  if (direct) return direct(reading);
  for (const cd of wordConjData(reading)) {
    const f = HINTS.get(cd.from);
    if (f) return f(reading);
  }
  return null;
}
