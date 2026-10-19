/** Port of Ichiran dict-grammar.lisp (Timofei Shatrov, MIT): suffix compounds,
 * abbreviations, synergies, penalties and segment filters. */
import { destem } from "./chars.js";
import { S, bind } from "./state.js";
import {
  adjoinWord,
  findWordAsHiragana,
  findWordFull,
  findWordSeq,
  findWordConjOf,
  findWordWithPos,
  getKana,
  isSimple,
  makeProxy,
  makeWord,
  seqOf,
  segmentText,
  setWordConjugations,
  textOf,
  wordConjData,
  wordConjugations,
  getConjData,
  bundle,
  entryRootP,
  type CompoundText,
  type ConjData,
  type ScoreMod,
  type Segment,
  type SegmentList,
  type SimpleLike,
  type SimpleText,
  type Word,
} from "./dict.js";
import {
  CONJ_ADJECTIVE_LITERARY,
  CONJ_ADJECTIVE_STEM,
  CONJ_ADVERBIAL,
  CONJ_NEGATIVE_STEM,
  SEMI_FINAL_PRT,
  WEAK_CONJ_FORMS,
  skipByConjData,
  testConjProp,
} from "./errata.js";

// ---------------------------------------------------------------------------
// Suffix cache

export type SuffixVal = [string, SimpleText | null];
export type SuffixItem = [string, string, SimpleText | null];
interface SuffixCache {
  cache: Map<string, SuffixVal[]>;
  cls: Map<number, string>;
  /** Initial word-conjugations of the shared suffix words (see resetSuffixState). */
  initial: [SimpleText, SimpleText["conjugations"]][];
}

export const SUFFIX_DESCRIPTION: Record<string, string> = {
  chau: "indicates completion (to finish ...)",
  ha: "topic marker particle",
  tai: "want to... / would like to...",
  iru: "indicates continuing action (to be ...ing)",
  oru: "indicates continuing action (to be ...ing) (humble)",
  aru: "indicates completion / finished action",
  kuru: "indicates action that had been continuing up till now / came to be ",
  oku: "to do in advance / to leave in the current state expecting a later change",
  kureru: "(asking) to do something for one",
  morau: "(asking) to get somebody to do something",
  itadaku: "(asking) to get somebody to do something (polite)",
  iku: "is becoming / action starting now and continuing",
  suru: "makes a verb from a noun",
  itasu: "makes a verb from a noun (humble)",
  sareru: "makes a verb from a noun (honorific or passive)",
  saseru: "let/make someone/something do ...",
  rou: "probably / it seems that... / I guess ...",
  ii: "it's ok if ... / is it ok if ...?",
  mo: "even if ...",
  sugiru: "to be too (much) ...",
  nikui: "difficult to...",
  gatai: "difficult to...",
  sa: "-ness (degree or condition of adjective)",
  tsutsu: "while ... / in the process of ...",
  tsutsuaru: "to be doing ... / to be in the process of doing ...",
  uru: "can ... / to be able to ...",
  sou: "looking like ... / seeming ...",
  nai: "negative suffix",
  ra: "pluralizing suffix (not polite)",
  kudasai: "please do ...",
  yagaru: "indicates disdain or contempt",
  naru: "to become ...",
  desu: "formal copula",
  desho: "it seems/perhaps/don't you think?",
  tosuru: "to try to .../to be about to...",
  garu: "to feel .../have a ... impression of someone",
  me: "somewhat/-ish",
  gai: "worth it to ...",
  tasou: "seem to want to... (tai+sou)",
  "2826528": "polite prefix",
  "2028980": "at / in / by",
  "2028970": "or / questioning particle",
  "2028990": "to / at / in",
  "2029010": "indicates direct object of action",
  "1469800": "indicates possessive (...'s)",
  "2086960": "quoting particle",
  "1002980": "from / because",
};
export function getSuffixDescription(seq: number): string | undefined {
  const cls = suffixes().cls.get(seq);
  return SUFFIX_DESCRIPTION[cls ?? String(seq)];
}

function getKanaFormsConjDataFilter(conjData: ConjData[]): number[] {
  if (skipByConjData(conjData)) return [];
  return conjData
    .filter((cd) => !testConjProp(cd.prop, WEAK_CONJ_FORMS))
    .map((cd) => cd.prop.conjId);
}
function getKanaForms(seq: number): SimpleText[] {
  const b = bundle(seq);
  if (!b) return [];
  const rows = [
    ...b.readings.filter((r) => r.table === "kana"),
    ...b.derived.flatMap((d) => (bundle(d)?.readings ?? []).filter((r) => r.table === "kana")),
  ];
  const out: SimpleText[] = [];
  for (const row of rows) {
    const kt = makeWord(row);
    if (row.seq === seq) {
      kt.conjugations = "root";
      out.push(kt);
    } else {
      const ids = getKanaFormsConjDataFilter(getConjData(row.seq, seq));
      if (ids.length) {
        kt.conjugations = ids;
        out.push(kt);
      }
    }
  }
  return out;
}
function getKanaForm(seq: number, text: string, conj?: "root"): SimpleText | null {
  const row = (bundle(seq)?.readings ?? []).find((r) => r.table === "kana" && r.text === text);
  if (!row) return null;
  const w = makeWord(row);
  if (conj) w.conjugations = conj;
  return w;
}

function buildSuffixes(): SuffixCache {
  const cache = new Map<string, SuffixVal[]>();
  const cls = new Map<number, string>();
  const update = (text: string, val: SuffixVal, join = false) => {
    const old = cache.get(text);
    cache.set(text, !old ? [val] : join ? [val, ...old] : [val]);
  };
  const loadKf = (key: string, kf: SimpleText | null, opts: { cls?: string; text?: string; join?: boolean } = {}) => {
    if (!kf) return;
    update(opts.text ?? kf.row.text, [key, kf], opts.join);
    cls.set(kf.row.seq, opts.cls ?? key);
  };
  const loadConjs = (key: string, seq: number, klass?: string, join?: boolean) => {
    for (const kf of getKanaForms(seq)) loadKf(key, kf, { cls: klass, join });
  };
  const loadAbbr = (key: string, text: string, join = false) => update(text, [key, null], join);

  loadConjs("chau", 2013800);
  loadConjs("chau", 2210750);
  loadKf("chau", getKanaForm(2028920, "は"), { cls: "ha", text: "ちゃ" });
  loadKf("chau", getKanaForm(2028920, "は"), { cls: "ha", text: "じゃ" });
  loadConjs("tai", 2017560);
  loadKf("tai", getKanaForm(900000, "たそう"), { cls: "tasou" });
  loadConjs("ren-", 2772730, "nikui");
  loadConjs("ren-", 2867504, "gatai");
  loadConjs("te", 1577985, "oru");
  loadConjs("te", 1296400, "aru");
  for (const kf of getKanaForms(1577980)) {
    const t = kf.row.text;
    cache.set(t, [[t.length > 1 ? "teiru+" : "teiru", kf]]);
    cls.set(kf.row.seq, "iru");
    if (t.length > 1) cache.set(t.slice(1), [["teiru", kf]]);
  }
  loadConjs("te", 1547720, "kuru");
  loadConjs("te", 1421850, "oku");
  loadConjs("to", 2108590, "oku");
  loadConjs("te", 1305380, "chau");
  loadConjs("te+space", 1269130, "kureru");
  loadConjs("te+space", 1535910, "morau");
  loadConjs("te+space", 1587290, "itadaku");
  for (const kf of getKanaForms(1578850)) {
    const t = kf.row.text;
    const val: SuffixVal = ["te", kf];
    if (t[0] === "い") {
      cache.set(t, [val]);
      cls.set(kf.row.seq, "iku");
      if (!cache.has(t.slice(1))) cache.set(t.slice(1), [val]);
    }
  }
  loadKf("teii", getKanaForm(2820690, "いい"), { cls: "ii" });
  loadKf("teii", getKanaForm(900001, "もいい"), { cls: "ii", text: "もいい" });
  loadKf("te", getKanaForm(2028940, "も"), { cls: "mo" });
  loadKf("kudasai", getKanaForm(1184270, "ください", "root"));
  loadConjs("suru", 1157170);
  loadConjs("suru", 1421900, "itasu");
  loadConjs("suru", 2269820, "sareru");
  loadConjs("suru", 1005160, "saseru");
  loadConjs("sou", 1006610);
  loadConjs("sou+", 2141080);
  loadKf("rou", getKanaForm(1928670, "だろう"), { text: "ろう" });
  loadConjs("sugiru", 1195970);
  loadKf("sa", getKanaForm(2029120, "さ"));
  loadKf("ren", getKanaForm(1008120, "つつ"), { cls: "tsutsu" });
  loadConjs("ren", 2027910, "tsutsuaru");
  loadKf("ren", getKanaForm(1454500, "うる"), { cls: "uru" });
  loadKf("neg", findWordConjOf("なく", 1529520)[0] ?? null, { cls: "nai" });
  loadConjs("adv", 1375610, "naru");
  loadConjs("teren", 1012740, "yagaru");
  loadKf("ra", getKanaForm(2067770, "ら"));
  loadConjs("rashii", 1013240);
  loadKf("desu", getKanaForm(1628500, "です"));
  loadKf("desho", getKanaForm(1008420, "でしょう"));
  loadKf("desho", getKanaForm(1008420, "でしょ"));
  loadConjs("tosuru", 2136890);
  loadKf("kurai", getKanaForm(1154340, "くらい"));
  loadKf("kurai", getKanaForm(1154340, "ぐらい"));
  loadConjs("garu", 1631750);
  loadKf("ren", getKanaForm(2016470, "がち"), { cls: "gachi" });
  loadKf("iadj", getKanaForm(2006580, "げ"));
  loadKf("iadj", getKanaForm(1604890, "め"), { cls: "me" });
  loadKf("ren-", getKanaForm(2606690, "がい"), { cls: "gai" });
  loadAbbr("nai", "ねえ");
  loadAbbr("nai", "ねぇ");
  loadAbbr("nai", "ねー");
  loadAbbr("nai-x", "ず");
  loadAbbr("nai-x", "ざる");
  loadAbbr("nai-x", "ぬ");
  loadAbbr("nai-n", "ん");
  loadAbbr("nakereba", "なきゃ");
  loadAbbr("nakereba", "なくちゃ");
  loadAbbr("nakereba", "ねば");
  loadAbbr("teba", "ちゃ", true);
  loadAbbr("reba", "りゃ");
  loadAbbr("keba", "きゃ");
  loadAbbr("geba", "ぎゃ");
  loadAbbr("neba", "にゃ");
  loadAbbr("beba", "びゃ");
  loadAbbr("meba", "みゃ");
  loadAbbr("seba", "しゃ");
  loadAbbr("shimashou", "しましょ");
  loadAbbr("dewanai", "じゃない");
  loadAbbr("ii", "ええ");
  const initial: SuffixCache["initial"] = [];
  for (const vals of cache.values())
    for (const [, kf] of vals) if (kf) initial.push([kf, kf.conjugations]);
  return { cache, cls, initial };
}

/** Upstream initializes the suffix cache once per connection. */
export function suffixes(): SuffixCache {
  const store = S().store;
  const existing = store.extras.get("suffixes") as SuffixCache | undefined;
  if (existing) return existing;
  const hadMisses = store.hasMisses();
  const built = buildSuffixes();
  if (!hadMisses && !store.hasMisses()) store.extras.set("suffixes", built);
  return built;
}

/** Upstream shares suffix word objects between analyses and mutates their
 * conjugation lists, which makes results depend on previously analyzed text.
 * Restoring the initial state at the start of every analysis keeps Yomichi
 * deterministic; it equals upstream behaviour for a freshly started process. */
export function resetSuffixState(): void {
  const c = S().store.extras.get("suffixes") as SuffixCache | undefined;
  if (c) for (const [kf, conj] of c.initial) kf.conjugations = conj;
}

// ---------------------------------------------------------------------------
// Suffix functions

function findWordWithConjProp(
  wordstr: string,
  filter: (cd: ConjData) => boolean,
  allowRoot = false,
): Word[] {
  const out: Word[] = [];
  for (const word of findWordFull(wordstr)) {
    const conjData = wordConjData(word);
    const filtered = conjData.filter(filter);
    const ids = filtered.map((cd) => cd.prop.conjId);
    if (filtered.length || (!conjData.length && allowRoot)) {
      setWordConjugations(word, ids.length ? ids : null);
      out.push(word);
    }
  }
  return out;
}
function findWordWithConjType(word: string, ...types: number[]): Word[] {
  return findWordWithConjProp(word, (cd) => types.includes(cd.prop.conjType));
}
/** `(conj-neg prop)` is a generalized boolean in Lisp: :null (unknown) is true. */
const negFilter = (cd: ConjData) => cd.prop.neg !== false;

function pairWordsByConj(...groups: Word[][]): (Word | null)[][] {
  const key = (word: Word) => {
    const ids = wordConjugations(word);
    const pairs = (Array.isArray(ids) ? ids : []).map((id) => {
      const c = S().store.conjugation(id)!;
      return [c.from, c.via ?? 0];
    });
    pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return JSON.stringify(pairs);
  };
  const bag = new Map<string, (Word | null)[]>();
  groups.forEach((wg, idx) => {
    for (const word of wg) {
      const k = key(word);
      const arr = bag.get(k) ?? groups.map(() => null);
      arr[idx] = word;
      bag.set(k, arr);
    }
  });
  return [...bag.values()];
}

function findWordWithSuffix(wordstr: string, ...classes: string[]): Word[] {
  const { cls } = suffixes();
  return findWordFull(wordstr).filter((w) => {
    if (w.kind !== "compound") return false;
    const c = cls.get(seqOf(w.words.at(-1)!)!);
    return c !== undefined && classes.includes(c);
  });
}
function orAsHiragana(fn: (w: string) => SimpleLike[], word: string): SimpleLike[] {
  const r = fn(word);
  return r.length ? r : findWordAsHiragana(word, [], fn);
}
function applyPatch(root: string, patch: [string, string]): string {
  return root.slice(0, root.length - patch[1].length) + patch[0];
}

type SuffixFn = (root: string, suf: string, kf: SimpleText | null) => Word[];
type Body = (root: string, suf: string, setPatch: (p: [string, string]) => void) => (Word | (Word | null)[])[];

/** A suffix score that depends on the root, like `(constantly (cond ...))`. */
interface RootScore {
  byRoot: (root: string) => ScoreMod;
}
function simpleSuffix(
  stem: number,
  score: ScoreMod | RootScore,
  connector: string,
  body: Body,
): SuffixFn {
  return (root, suf, kf) => {
    let patch: [string, string] | null = null;
    const primary = bind(
      { suffixMapTemp: stem === 0 ? S().suffixMapTemp : null },
      () => body(root, suf, (p) => (patch = p)),
    );
    const out: Word[] = [];
    for (let pw of primary) {
      let scoreBase: SimpleLike | null = null;
      if (Array.isArray(pw)) {
        scoreBase = (pw[1] as SimpleLike | null) ?? null;
        pw = pw[0] as Word;
        if (!pw) continue;
      }
      const w = pw as SimpleLike | CompoundText;
      const k = getKana(w);
      const p = patch as [string, string] | null;
      const kana = (p ? destem(k, p[0].length) + p[1] : destem(k, stem)) + connector + suf;
      const scoreMod =
        typeof score === "object" && !Array.isArray(score) ? score.byRoot(root) : score;
      out.push(adjoinWord(w, kf!, { text: root + suf, kana, scoreMod, scoreBase }));
    }
    return out;
  };
}
/** (constantly n) where n may depend on the suffix root */
function constantlyBy(fn: (root: string) => number): RootScore {
  return {
    byRoot: (root) => {
      const v = fn(root);
      return () => v;
    },
  };
}
const constantly = (v: number) => constantlyBy(() => v);

function abbrSuffix(stem: number, body: Body): SuffixFn {
  return (root, suf) => {
    let patch: [string, string] | null = null;
    const primary = bind({ suffixMapTemp: null }, () => body(root, suf, (p) => (patch = p)));
    return (primary as Word[]).map((pw) => {
      const text = root + suf;
      const k = getKana(pw);
      const p = patch as [string, string] | null;
      const kana = (p ? destem(k, p[0].length) + p[1] : destem(k, stem)) + suf;
      if (isSimple(pw)) return makeProxy(pw, text, kana, true);
      if (pw.kind === "compound") {
        pw.text = text;
        pw.kana = kana;
      }
      return pw;
    });
  };
}

const lastChar = (s: string) => s[s.length - 1];
function teCheck(root: string): Word[] {
  return root !== "で" && "てで".includes(lastChar(root)) ? findWordWithConjType(root, 3) : [];
}
function teiruCheck(root: string): Word[] {
  return root !== "いて" ? teCheck(root) : [];
}
function souBase(root: string, setPatch: (p: [string, string]) => void): Word[] {
  if (root.endsWith("なさ")) {
    const patch: [string, string] = ["い", "さ"];
    setPatch(patch);
    const r = applyPatch(root, patch);
    return bind({ suffixMapTemp: null }, () => findWordWithConjProp(r, negFilter));
  }
  if (!["な", "よ", "よさ", "に", "き"].includes(root))
    return findWordWithConjType(root, 13, CONJ_ADJECTIVE_STEM, CONJ_ADVERBIAL);
  return [];
}

export const SUFFIX_FUNCTIONS: Record<string, SuffixFn> = {
  tai: simpleSuffix(0, 5, "", (root) => (root !== "い" ? findWordWithConjType(root, 13) : [])),
  ren: simpleSuffix(0, 5, "", (root) => findWordWithConjType(root, 13)),
  "ren-": simpleSuffix(0, 0, "", (root) => findWordWithConjType(root, 13)),
  neg: simpleSuffix(0, 5, "", (root) => findWordWithConjType(root, 13, CONJ_NEGATIVE_STEM)),
  te: simpleSuffix(0, 0, "", (root) => teCheck(root)),
  teiru: simpleSuffix(0, 3, "", (root) => teiruCheck(root)),
  "teiru+": simpleSuffix(0, 6, "", (root) => teiruCheck(root)),
  "te+space": simpleSuffix(0, 3, " ", (root) => teCheck(root)),
  kudasai: simpleSuffix(0, constantly(360), " ", (root) => teCheck(root)),
  teren: simpleSuffix(0, 4, "", (root) => {
    if (root === "で") return [];
    if ("てで".includes(lastChar(root))) return findWordWithConjType(root, 3);
    if (root !== "い") return findWordWithConjType(root, 13);
    return [];
  }),
  teii: simpleSuffix(0, 1, " ", (root) =>
    "てで".includes(lastChar(root)) ? findWordWithConjType(root, 3) : [],
  ),
  chau: simpleSuffix(1, 5, "", (root, suf) => {
    const te = suf[0] === "じ" ? "で" : suf[0] === "ち" ? "て" : null;
    return te ? findWordWithConjType(root + te, 3) : [];
  }),
  to: simpleSuffix(1, 0, "", (root, suf) => {
    const te = suf[0] === "と" ? "て" : suf[0] === "ど" ? "で" : null;
    return te ? findWordWithConjType(root + te, 3) : [];
  }),
  suru: simpleSuffix(0, 5, " ", (root) => findWordWithPos(root, "vs")),
  sou: simpleSuffix(
    0,
    constantlyBy((root) => (root === "から" ? 40 : root === "い" ? 0 : root === "出来" ? 100 : 70)),
    "",
    (root, _suf, setPatch) => souBase(root, setPatch),
  ),
  "sou+": simpleSuffix(0, 1, "", (root, _suf, setPatch) => souBase(root, setPatch)),
  rou: simpleSuffix(0, 1, "", (root) => findWordWithConjType(root, 2)),
  adv: simpleSuffix(0, 1, "", (root) => findWordWithConjType(root, CONJ_ADVERBIAL)),
  sugiru: simpleSuffix(1, 5, "", (root, _suf, setPatch) => {
    let patch: [string, string] | null = null;
    let r: string | null;
    if (root === "い") r = null;
    else if (root.endsWith("なさ") || root.endsWith("無さ")) {
      patch = ["い", "さ"];
      setPatch(patch);
      r = applyPatch(root, patch);
    } else r = root + "い";
    if (r === null) return [];
    if (patch && r.length > 2) return findWordWithConjProp(r, negFilter);
    return findWordWithPos(r, "adj-i");
  }),
  sa: simpleSuffix(0, 2, "", (root) => [
    ...findWordWithConjType(root, CONJ_ADJECTIVE_STEM),
    ...findWordWithPos(root, "adj-na"),
  ]),
  iadj: simpleSuffix(0, 1, "", (root) => findWordWithConjType(root, CONJ_ADJECTIVE_STEM)),
  garu: simpleSuffix(0, 0, "", (root, _suf, setPatch) => {
    if (["な", "い", "よ"].includes(root)) return [];
    const r = findWordWithConjType(root, CONJ_ADJECTIVE_STEM);
    if (r.length) return r;
    if (root.endsWith("そ")) {
      const patch: [string, string] = ["う", ""];
      setPatch(patch);
      const r2 = applyPatch(root, patch);
      return bind({ suffixMapTemp: null }, () => findWordWithSuffix(r2, "sou"));
    }
    return [];
  }),
  ra: simpleSuffix(0, 1, "", (root) => {
    if (root.endsWith("ら")) return [];
    const r = orAsHiragana((w) => findWordWithPos(w, "pn"), root);
    return r.length ? r : findWordSeq(root, 1580640);
  }),
  rashii: simpleSuffix(0, 3, "", (root) =>
    pairWordsByConj(findWordWithConjType(root, 2), findWordWithConjType(root + "ら", 11)),
  ),
  desu: simpleSuffix(0, constantly(200), " ", (root) =>
    root.endsWith("ない") || root.endsWith("なかった") ? findWordWithConjProp(root, negFilter) : [],
  ),
  desho: simpleSuffix(0, constantly(300), " ", (root) =>
    root.endsWith("ない") ? findWordWithConjProp(root, negFilter) : [],
  ),
  tosuru: simpleSuffix(0, 3, " ", (root) => findWordWithConjType(root, 9)),
  kurai: simpleSuffix(0, 3, " ", (root) => findWordWithConjType(root, 2)),
  nai: abbrSuffix(2, (root) =>
    findWordWithConjProp(
      root + "ない",
      (cd) => ![1577980, 1547720].includes(cd.from) && cd.prop.neg !== false,
      true,
    ),
  ),
  "nai-x": abbrSuffix(2, (root, _suf, setPatch) => {
    if (root === "せ") {
      setPatch(["しない", "せ"]);
      return findWordConjOf("しない", 1157170);
    }
    return findWordWithConjProp(root + "ない", (cd) => cd.from !== 1157170 && cd.prop.neg !== false);
  }),
  "nai-n": abbrSuffix(2, (root) =>
    findWordWithConjProp(
      root + "ない",
      (cd) => ![1577980, 1547720].includes(cd.from) && cd.prop.neg !== false,
    ),
  ),
  nakereba: abbrSuffix(4, (root) => findWordFull(root + "なければ")),
  shimashou: abbrSuffix(5, (root) => findWordFull(root + "しましょう")),
  dewanai: abbrSuffix(4, (root) => findWordFull(root + "ではない")),
  teba: abbrSuffix(2, (root) => findWordFull(root + "てば")),
  reba: abbrSuffix(2, (root) => findWordFull(root + "れば")),
  keba: abbrSuffix(2, (root) => findWordFull(root + "けば")),
  geba: abbrSuffix(2, (root) => findWordFull(root + "げば")),
  neba: abbrSuffix(2, (root) => findWordFull(root + "ねば")),
  beba: abbrSuffix(2, (root) => findWordFull(root + "べば")),
  meba: abbrSuffix(2, (root) => findWordFull(root + "めば")),
  seba: abbrSuffix(2, (root) => findWordFull(root + "せば")),
  ii: abbrSuffix(2, (root) => findWordFull(root + "いい")),
};

const UNIQUE_ONLY: Record<string, true | ((matches: Word[]) => boolean)> = {
  sa: (matches) =>
    matches.some((m) => {
      const s = m.kind === "compound" ? null : seqOf(m);
      return s !== null && entryRootP(s);
    }),
  ra: true,
  desu: (matches) => {
    const seqs = matches.map((m) => (m.kind === "compound" ? null : seqOf(m))).filter((s): s is number => s !== null);
    let rows = 0;
    for (const s of new Set(seqs))
      rows += (bundle(s)?.conjugations ?? []).filter((c) => c.from === 2755350).length;
    return rows < matches.length;
  },
  mo: true,
  nikui: true,
  gai: true,
  "nai-n": true,
  dewanai: true,
  eba: true,
  teba: true,
  reba: true,
  keba: true,
  geba: true,
  neba: true,
  beba: true,
  meba: true,
  seba: true,
  ii: true,
};
function matchUnique(suffixClass: string, matches: Word[]): boolean {
  const u = UNIQUE_ONLY[suffixClass];
  if (u === undefined) return false;
  return u === true ? true : u(matches);
}

export function getSuffixMap(str: string): Map<number, SuffixItem[]> {
  const { cache } = suffixes();
  const result = new Map<number, SuffixItem[]>();
  for (let start = 0; start < str.length; start++)
    for (let end = start + 1; end <= str.length; end++) {
      const substr = str.slice(start, end);
      const val = cache.get(substr);
      if (!val) continue;
      for (const [key, kf] of val) {
        const list = result.get(end) ?? [];
        list.unshift([substr, key, kf]);
        result.set(end, list);
      }
    }
  return result;
}
export function getSuffixes(word: string): SuffixItem[] {
  const { cache } = suffixes();
  const out: SuffixItem[] = [];
  for (let start = word.length - 1; start >= 1; start--) {
    const substr = word.slice(start);
    for (const [key, kf] of cache.get(substr) ?? []) out.push([substr, key, kf]);
  }
  return out;
}

export function findWordSuffix(word: string, matches: Word[]): Word[] {
  const st = S();
  const { cls } = suffixes();
  const list =
    st.suffixMapTemp !== null
      ? (st.suffixMapTemp.get(st.suffixNextEnd!) ?? [])
      : getSuffixes(word);
  const out: Word[] = [];
  for (const [suffix, keyword, kf] of list) {
    const fn = SUFFIX_FUNCTIONS[keyword];
    const suffixClass = kf ? cls.get(kf.row.seq) : keyword;
    const offset = word.length - suffix.length;
    if (!fn || offset <= 0) continue;
    if (matches.length && suffixClass !== undefined && matchUnique(suffixClass, matches)) continue;
    const nextEnd = st.suffixNextEnd !== null ? st.suffixNextEnd - suffix.length : null;
    out.push(...bind({ suffixNextEnd: nextEnd }, () => fn(word.slice(0, offset), suffix, kf)));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Synergies

export interface Synergy {
  kind: "synergy";
  description: string | null;
  connector: string;
  score: number;
  start: number;
  end: number;
}
type SegFilter = (s: Segment) => boolean;

const kpcl = (s: Segment) => s.info?.kpcl ?? [false, false, false, false];
const posi = (s: Segment) => s.info?.posi ?? [];
const seqSetOf = (s: Segment) => s.info?.seqSet ?? [];
function filterIsNoun(s: Segment): boolean {
  const [k, p, c, l] = kpcl(s);
  if ((l || k || (p && c)) && posi(s).some((x) => ["n", "n-adv", "n-t", "adj-na", "n-suf", "pn"].includes(x)))
    return true;
  return s.word.kind === "counter" && seqSetOf(s).length > 0;
}
function filterIsPos(list: string[], test: (k: boolean, p: boolean, c: boolean, l: boolean) => boolean): SegFilter {
  return (s) => {
    const [k, p, c, l] = kpcl(s);
    return test(k, p, c, l) && posi(s).some((x) => list.includes(x));
  };
}
function inSeqSet(...seqs: number[]): SegFilter {
  return (s) => seqSetOf(s).some((x) => x !== null && seqs.includes(x));
}
function inSeqSetSimple(...seqs: number[]): SegFilter {
  return (s) => s.word.kind !== "compound" && inSeqSet(...seqs)(s);
}
function isConjugation(type: number): SegFilter {
  return (s) => (s.info?.conj ?? []).some((cd) => cd.prop.conjType === type);
}
function isCompoundEnd(...seqs: number[]): SegFilter {
  return (s) => s.word.kind === "compound" && seqs.includes(seqOf(s.word.words.at(-1)!)!);
}
function isCompoundEndText(...texts: string[]): SegFilter {
  return (s) => s.word.kind === "compound" && texts.includes(textOf(s.word.words.at(-1)!));
}
const not = (f: SegFilter): SegFilter => (s) => !f(s);
function slFrom(old: SegmentList, segments: Segment[]): SegmentList {
  return { ...old, segments };
}

const NOUN_PARTICLES = [
  2028920, 2028930, 2028990, 2028980, 2029000, 1007340, 1579080, 1525680,
  2028940, 1582300, 2215430, 1469800, 1009990, 2029010, 1005120, 2034520,
  1005120, 1008490, 1008530, 1008590, 2028950, 2028960, 1009600,
];

type SynergyFn = (l: SegmentList, r: SegmentList) => [SegmentList, Synergy, SegmentList][];
function genericSynergy(
  filterLeft: SegFilter,
  filterRight: SegFilter,
  description: string | null,
  connector: string,
  score: (l: SegmentList, r: SegmentList) => number,
): SynergyFn {
  return (l, r) => {
    if (l.end !== r.start) return [];
    const left = l.segments.filter(filterLeft);
    const right = r.segments.filter(filterRight);
    if (!left.length || !right.length) return [];
    return [
      [
        slFrom(r, right),
        { kind: "synergy", start: l.end, end: r.start, description, connector, score: score(l, r) },
        slFrom(l, left),
      ],
    ];
  };
}
const fixed = (n: number) => () => n;

/** In upstream *synergy-list* order (reverse of definition order). */
const SYNERGIES: SynergyFn[] = [
  genericSynergy(filterIsPos(["ctr"], () => true), inSeqSet(2854117, 2084550), null, "", fixed(20)),
  genericSynergy(inSeqSet(1469800), inSeqSet(1432920), "no toori", " ", fixed(50)),
  genericSynergy(
    inSeqSet(1005460),
    (s) => (s.info?.conj ?? []).some((cd) => cd.prop.neg !== false),
    "shika+neg",
    " ",
    fixed(50),
  ),
  genericSynergy(
    isCompoundEnd(2028920),
    inSeqSet(1000730, 1612750, 1409110, 2829697, 1587610),
    "shicha ikenai",
    " ",
    fixed(50),
  ),
  genericSynergy(inSeqSet(2242840, 1922780, 2423740), filterIsPos(["n"], (k) => k), "kanji prefix+noun", "", fixed(15)),
  genericSynergy(inSeqSet(1270190), filterIsPos(["n"], (k, _p, _c, l) => k || l), "o+noun", "", fixed(10)),
  genericSynergy(filterIsNoun, inSeqSet(1375260), "suffix-sei", "", fixed(12)),
  genericSynergy(filterIsNoun, inSeqSet(1361140), "suffix-buri", "", fixed(40)),
  genericSynergy(filterIsNoun, inSeqSet(1416220), "suffix-tachi", "-", fixed(10)),
  genericSynergy(filterIsNoun, inSeqSet(1620400, 2083570), "suffix-chu", "-", fixed(12)),
  genericSynergy(
    filterIsPos(["adv-to"], (k, p, _c, l) => k || l || p),
    inSeqSet(1008490),
    "to-adverb",
    " ",
    (l) => 10 + 10 * (l.end - l.start),
  ),
  genericSynergy(
    filterIsPos(["adj-na"], (k, p, c, l) => k || l || (p && c)),
    inSeqSet(2029110, 2028990),
    "na-adjective",
    " ",
    fixed(15),
  ),
  genericSynergy(
    filterIsPos(["adj-no"], (k, p, c, l) => k || l || (p && c)),
    inSeqSet(1469800),
    "no-adjective",
    " ",
    fixed(15),
  ),
  genericSynergy(inSeqSet(2137720), inSeqSet(2140410), "sou na n da", " ", fixed(50)),
  genericSynergy(inSeqSet(1469800, 2139720), inSeqSet(2089020, 1007370, 1928670), "no da/desu", " ", fixed(15)),
  genericSynergy(filterIsNoun, inSeqSet(2089020), "noun+da", " ", fixed(10)),
  genericSynergy(
    filterIsNoun,
    inSeqSet(...NOUN_PARTICLES),
    "noun+prt",
    " ",
    (_l, r) => 10 + 4 * (r.end - r.start),
  ),
];

export function getSynergies(l: SegmentList, r: SegmentList): [SegmentList, Synergy, SegmentList][] {
  return SYNERGIES.flatMap((fn) => fn(l, r));
}

// ---------------------------------------------------------------------------
// Penalties

function filterShortKana(len: number, except: string[] = []) {
  return (sl: SegmentList) => {
    const seg = sl.segments[0];
    return (
      !!seg &&
      sl.end - sl.start <= len &&
      !kpcl(seg)[0] &&
      !except.includes(segmentText(seg))
    );
  };
}
type PenaltyFn = (l: SegmentList, r: SegmentList) => Synergy | null;
function genericPenalty(
  testLeft: (sl: SegmentList) => boolean,
  testRight: (sl: SegmentList) => boolean,
  serial: boolean,
  description: string,
  score: number,
): PenaltyFn {
  return (l, r) =>
    (!serial || l.end === r.start) && testLeft(l) && testRight(r)
      ? { kind: "synergy", start: l.end, end: r.start, description, connector: " ", score }
      : null;
}
const PENALTIES: PenaltyFn[] = [
  genericPenalty(
    (sl) => sl.segments.some((s) => seqSetOf(s).some((x) => x !== null && SEMI_FINAL_PRT.has(x))),
    () => true,
    true,
    "semi-final not final",
    -15,
  ),
  genericPenalty(filterShortKana(1), filterShortKana(1, ["と"]), false, "short", -9),
];
export function getPenalties(l: SegmentList, r: SegmentList): (SegmentList | Synergy)[] {
  for (const fn of PENALTIES) {
    const p = fn(l, r);
    if (p) return [r, p, l];
  }
  return [r, l];
}

// ---------------------------------------------------------------------------
// Segment filters

type Pair = [SegmentList | null, SegmentList];
type SegFilterFn = (l: SegmentList | null, r: SegmentList) => Pair[];
function mustFollow(filterLeft: SegFilter, filterRight: SegFilter, allowFirst = false): SegFilterFn {
  return (l, r) => {
    const satRight = r.segments.filter(filterRight);
    const conRight = r.segments.filter((s) => !filterRight(s));
    if (!satRight.length || (allowFirst && !l)) return [[l, r]];
    if (!l || l.end !== r.start) return conRight.length ? [[l, slFrom(r, conRight)]] : [];
    const satLeft = l.segments.filter(filterLeft);
    const conLeft = l.segments.filter((s) => !filterLeft(s));
    if (!conLeft.length) return [[l, r]];
    const result: Pair[] = conRight.length ? [[l, slFrom(r, conRight)]] : [];
    if (satLeft.length) result.unshift([slFrom(l, satLeft), slFrom(r, satRight)]);
    return result;
  };
}
const never: SegFilter = () => false;
/** In upstream *segfilter-list* order (reverse of definition order). */
const SEGFILTERS: SegFilterFn[] = [
  mustFollow(not(inSeqSet(2028940)), inSeqSet(1009980), true), // mononi
  mustFollow(not(inSeqSet(...NOUN_PARTICLES)), inSeqSet(1247260)), // honorific
  mustFollow(not(inSeqSet(1896380, 2422860)), inSeqSet(2830009, 1547720), true), // dekiru
  mustFollow(
    (s) => {
      const ss = seqSetOf(s);
      return !ss.includes(2089020) || ss.includes(2028980);
    },
    inSeqSet(1157170, 2424740, 1305070),
    true,
  ), // dashi
  mustFollow(not(inSeqSet(1008490)), inSeqSet(2086960), true), // totte
  mustFollow(not(inSeqSet(2837117)), inSeqSet(1589350, 1587040), true), // toomou
  mustFollow(not(inSeqSet(1469800)), inSeqSet(1601080), true), // nohayamete
  mustFollow(not(isCompoundEnd(2028920)), inSeqSet(1529520, 1296400, 2139720), true), // janai
  mustFollow(not(isCompoundEnd(2029120)), (s) => segmentText(s).startsWith("え"), true), // sae
  mustFollow(not(isCompoundEndText("いろ")), (s) => segmentText(s).startsWith("く"), true), // roku
  mustFollow(never, (s) => isConjugation(CONJ_ADJECTIVE_LITERARY)(s) && segmentText(s).endsWith("好き")), // sukiyoki
  mustFollow(never, isCompoundEndText("ちゃい", "いか", "とか", "とき", "い")), // badend
  mustFollow(inSeqSet(2029010), inSeqSet(2087020)), // wokarasu
  mustFollow(not(inSeqSetSimple(...NOUN_PARTICLES)), inSeqSet(2139720, 2849370, 2849387), true), // n
  mustFollow(not(inSeqSet(2221640)), inSeqSet(1577980), true), // tsu-iru
  mustFollow(isConjugation(13), inSeqSet(1342560)), // aux-verb
];
export function applySegfilters(l: SegmentList | null, r: SegmentList): Pair[] {
  let splits: Pair[] = [[l, r]];
  for (const f of SEGFILTERS) splits = splits.flatMap(([a, b]) => f(a, b));
  return splits;
}
