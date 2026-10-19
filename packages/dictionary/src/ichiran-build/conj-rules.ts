/** Conjugation rules in the representation used by Ichiran's loader
 * (dict-load.lisp construct-conjugation): drop `stem` characters (plus one
 * when a euphonic replacement applies), append the euphonic replacement and
 * the okurigana.
 *
 * The built-in rules below are an independent description of standard
 * Japanese verb/adjective paradigms written for Yomichi; no JMdictDB table is
 * bundled. Their conjugation type numbering follows Ichiran/JMdictDB so that
 * the analyzer's grammar rules apply unchanged. `loadJmdictdbRules` can
 * instead read a user-supplied JMdictDB `conjo.csv`/`kwpos.csv` (GPL data, not
 * distributed here) to reproduce an upstream Ichiran build exactly. Ichiran's
 * own rule adjustments (dict-errata.lisp errata-conj-rules-hook) are applied to
 * both. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { testWord } from "../../../core/src/ichiran/chars.js";

export interface ConjRule {
  pos: string;
  conj: number;
  neg: boolean;
  fml: boolean;
  onum: number;
  stem: number;
  okuri: string;
  euphr: string;
  euphk: string;
}
export type RuleTable = Map<string, ConjRule[]>;

export const CONJ_ADVERBIAL = 50;
export const CONJ_ADJECTIVE_STEM = 51;
export const CONJ_NEGATIVE_STEM = 52;
export const CONJ_CAUSATIVE_SU = 53;
export const CONJ_ADJECTIVE_LITERARY = 54;

/** construct-conjugation */
export function constructConjugation(word: string, rule: ConjRule): string {
  const iskana = testWord(word.slice(Math.max(0, word.length - 2)), "kana");
  const euph = iskana ? rule.euphr : rule.euphk;
  const stem = rule.stem + (euph.length > 0 ? 1 : 0);
  return word.slice(0, word.length - stem) + euph + rule.okuri;
}

// ---------------------------------------------------------------------------
// Built-in paradigms

type Form = [conj: number, neg: boolean, fml: boolean, okuri: string, opts?: { stem?: number; euphr?: string; euphk?: string }];

function rules(pos: string, forms: Form[]): ConjRule[] {
  const out: ConjRule[] = [];
  const onum = new Map<string, number>();
  for (const [conj, neg, fml, okuri, o] of forms) {
    const key = `${conj}${neg}${fml}`;
    const n = (onum.get(key) ?? 0) + 1;
    onum.set(key, n);
    out.push({ pos, conj, neg, fml, onum: n, stem: o?.stem ?? 1, okuri, euphr: o?.euphr ?? "", euphk: o?.euphk ?? "" });
  }
  return out;
}

/** Polite (-masu) forms built on a stem string. */
function politeForms(i: string): Record<string, string> {
  return {
    "1F": i + "ます",
    "1NF": i + "ません",
    "2F": i + "ました",
    "2NF": i + "ませんでした",
    "3F": i + "まして",
    "3NF": i + "ませんで",
    "4F": i + "ますなら",
    "4F2": i + "ますならば",
    "4NF": i + "ませんなら",
    "4NF2": i + "ませんならば",
    "9F": i + "ましょう",
    // standard polite negative volitional (JMdictDB uses ～ませんまい for godan)
    "9NF": i + "ますまい",
    "10F": i + "なさい",
    "10NF": i + "なさるな",
    "11F": i + "ましたら",
    "11NF": i + "ませんでしたら",
    "12F": i + "ましたり",
    "12NF": i + "ませんでしたり",
  };
}

interface Godan {
  a: string;
  i: string;
  u: string;
  e: string;
  o: string;
  te: string;
  ta: string;
  /** negative forms replace the whole ending (ある -> ない) */
  negStem?: number;
  negA?: string;
  imperative?: string;
  causativePassiveShort?: boolean;
}
function godan(pos: string, g: Godan): ConjRule[] {
  const p = politeForms(g.i);
  const na = g.negA ?? g.a;
  const ns = g.negStem ? { stem: g.negStem } : undefined;
  const f: Form[] = [
    [1, false, false, g.u],
    [1, false, true, p["1F"]],
    [1, true, false, na + "ない", ns],
    [1, true, true, p["1NF"]],
    [2, false, false, g.ta],
    [2, false, true, p["2F"]],
    [2, true, false, na + "なかった", ns],
    [2, true, true, p["2NF"]],
    [3, false, false, g.te],
    [3, false, true, p["3F"]],
    [3, true, false, na + "なくて", ns],
    [3, true, false, na + "ないで", ns],
    [3, true, true, p["3NF"]],
    [4, false, false, g.e + "ば"],
    [4, false, true, p["4F"]],
    [4, false, true, p["4F2"]],
    [4, true, false, na + "なければ", ns],
    [4, true, true, p["4NF"]],
    [4, true, true, p["4NF2"]],
    [5, false, false, g.e + "る"],
    [5, false, true, g.e + "ます"],
    [5, true, false, g.e + "ない"],
    [5, true, true, g.e + "ません"],
    [6, false, false, g.a + "れる"],
    [6, false, true, g.a + "れます"],
    [6, true, false, g.a + "れない"],
    [6, true, true, g.a + "れません"],
    [7, false, false, g.a + "せる"],
    [7, false, false, g.a + "す"],
    [7, false, true, g.a + "せます"],
    [7, false, true, g.a + "します"],
    [7, true, false, g.a + "せない"],
    [7, true, false, g.a + "さない"],
    [7, true, true, g.a + "せません"],
    [7, true, true, g.a + "しません"],
  ];
  const short = g.causativePassiveShort ?? true;
  for (const [neg, fml, end] of [
    [false, false, "る"],
    [false, true, "ます"],
    [true, false, "ない"],
    [true, true, "ません"],
  ] as const) {
    const base = end === "る" ? "" : end;
    f.push([8, neg, fml, g.a + "せられ" + (end === "る" ? "る" : base)]);
    if (short) f.push([8, neg, fml, g.a + "され" + (end === "る" ? "る" : base)]);
  }
  f.push(
    [9, false, false, g.o + "う"],
    [9, false, true, p["9F"]],
    [9, true, false, g.u + "まい"],
    [9, true, true, p["9NF"]],
    [10, false, false, g.imperative ?? g.e],
    [10, false, true, p["10F"]],
    [10, true, false, g.u + "な"],
    [10, true, true, p["10NF"]],
    [11, false, false, g.ta + "ら"],
    [11, false, true, p["11F"]],
    [11, true, false, na + "なかったら", ns],
    [11, true, true, p["11NF"]],
    [12, false, false, g.ta + "り"],
    [12, false, true, p["12F"]],
    [12, true, false, na + "なかったり", ns],
    [12, true, true, p["12NF"]],
    [13, false, false, g.i],
  );
  return rules(pos, f);
}
const row = (a: string, i: string, u: string, e: string, o: string, te: string, ta: string): Godan => ({
  a, i, u, e, o, te, ta,
});

function ichidan(pos: string, imperative: string): ConjRule[] {
  const p = politeForms("");
  return rules(pos, [
    [1, false, false, "る"],
    [1, false, true, p["1F"]],
    [1, true, false, "ない"],
    [1, true, true, p["1NF"]],
    [2, false, false, "た"],
    [2, false, true, p["2F"]],
    [2, true, false, "なかった"],
    [2, true, true, p["2NF"]],
    [3, false, false, "て"],
    [3, false, true, p["3F"]],
    [3, true, false, "なくて"],
    [3, true, false, "ないで"],
    [3, true, true, p["3NF"]],
    [4, false, false, "れば"],
    [4, false, true, p["4F"]],
    [4, false, true, p["4F2"]],
    [4, true, false, "なければ"],
    [4, true, true, p["4NF"]],
    [4, true, true, p["4NF2"]],
    [5, false, false, "られる"],
    [5, false, false, "れる"],
    [5, false, true, "られます"],
    [5, false, true, "れます"],
    [5, true, false, "られない"],
    [5, true, false, "れない"],
    [5, true, true, "られません"],
    [5, true, true, "れません"],
    [6, false, false, "られる"],
    [6, false, true, "られます"],
    [6, true, false, "られない"],
    [6, true, true, "られません"],
    [7, false, false, "させる"],
    [7, false, false, "さす"],
    [7, false, true, "させます"],
    [7, false, true, "さします"],
    [7, true, false, "させない"],
    [7, true, false, "ささない"],
    [7, true, true, "させません"],
    [7, true, true, "さしません"],
    [8, false, false, "させられる"],
    [8, false, true, "させられます"],
    [8, true, false, "させられない"],
    [8, true, true, "させられません"],
    [9, false, false, "よう"],
    [9, false, true, p["9F"]],
    [9, true, false, "まい"],
    [9, true, true, p["9NF"]],
    [10, false, false, imperative],
    [10, false, true, p["10F"]],
    [10, true, false, "るな"],
    [10, true, true, p["10NF"]],
    [11, false, false, "たら"],
    [11, false, true, p["11F"]],
    [11, true, false, "なかったら"],
    [11, true, true, p["11NF"]],
    [12, false, false, "たり"],
    [12, false, true, p["12F"]],
    [12, true, false, "なかったり"],
    [12, true, true, p["12NF"]],
    [13, false, false, ""],
  ]);
}

/** 来る: kana forms change the stem vowel (euphr); kanji forms keep 来. */
function kuru(): ConjRule[] {
  const k = (e: string) => ({ euphr: e });
  const p = politeForms("");
  const ki = k("き"),
    ku = k("く"),
    ko = k("こ");
  return rules("vk", [
    [1, false, false, "る", ku],
    [1, false, true, p["1F"], ki],
    [1, true, false, "ない", ko],
    [1, true, true, p["1NF"], ki],
    [2, false, false, "た", ki],
    [2, false, true, p["2F"], ki],
    [2, true, false, "なかった", ko],
    [2, true, true, p["2NF"], ki],
    [3, false, false, "て", ki],
    [3, false, true, p["3F"], ki],
    [3, true, false, "なくて", ko],
    [3, true, false, "ないで", ko],
    [3, true, true, p["3NF"], ki],
    [4, false, false, "れば", ku],
    [4, false, true, p["4F"], ki],
    [4, false, true, p["4F2"], ki],
    [4, true, false, "なければ", ko],
    [4, true, true, p["4NF"], ki],
    [4, true, true, p["4NF2"], ki],
    [5, false, false, "られる", ko],
    [5, false, false, "れる", ko],
    [5, false, true, "られます", ko],
    [5, false, true, "れます", ko],
    [5, true, false, "られない", ko],
    [5, true, false, "れない", ko],
    [5, true, true, "られません", ko],
    [5, true, true, "れません", ko],
    [6, false, false, "られる", ko],
    [6, false, true, "られます", ko],
    [6, true, false, "られない", ko],
    [6, true, true, "られません", ko],
    [7, false, false, "させる", ko],
    [7, false, false, "さす", ko],
    [7, false, true, "させます", ko],
    [7, false, true, "さします", ko],
    [7, true, false, "させない", ko],
    [7, true, false, "ささない", ko],
    [7, true, true, "させません", ko],
    [7, true, true, "さしません", ko],
    [8, false, false, "させられる", ko],
    [8, false, true, "させられます", ko],
    [8, true, false, "させられない", ko],
    [8, true, true, "させられません", ko],
    [9, false, false, "よう", ko],
    [9, false, true, p["9F"], ki],
    [9, true, false, "まい", ko],
    [9, true, true, p["9NF"], ki],
    [10, false, false, "い", ko],
    [10, false, true, p["10F"], ko],
    [10, true, false, "るな", ku],
    [10, true, true, p["10NF"], ko],
    [11, false, false, "たら", ki],
    [11, false, true, p["11F"], ki],
    [11, true, false, "なかったら", ko],
    [11, true, true, p["11NF"], ki],
    [12, false, false, "たり", ki],
    [12, false, true, p["12F"], ki],
    [12, true, false, "なかったり", ko],
    [12, true, true, p["12NF"], ki],
    [13, false, false, "", ki],
  ]);
}

/** する (vs-i: included suru, potential 出来る) and vs-s (special suru, potential し得る). */
function suru(pos: "vs-i" | "vs-s"): ConjRule[] {
  const e = (euphr: string, euphk = "") => ({ euphr, euphk });
  const si = e("し"),
    su = e("す"),
    se = e("せ"),
    sa = e("さ");
  const negSi = pos === "vs-i" ? si : sa;
  const p = politeForms("");
  const f: Form[] = [
    [1, false, false, "る", su],
    [1, false, true, p["1F"], si],
    [1, true, false, "ない", negSi],
    [1, true, true, p["1NF"], si],
    [2, false, false, "た", si],
    [2, false, true, p["2F"], si],
    [2, true, false, "なかった", negSi],
    [2, true, true, p["2NF"], si],
    [3, false, false, "て", si],
    [3, false, true, p["3F"], si],
    [3, true, false, "なくて", negSi],
    [3, true, false, "ないで", si],
    [3, true, true, p["3NF"], si],
    [4, false, false, "れば", su],
    [4, false, true, p["4F"], si],
    [4, false, true, p["4F2"], si],
    [4, true, false, "なければ", negSi],
    [4, true, true, p["4NF"], si],
    [4, true, true, p["4NF2"], si],
  ];
  if (pos === "vs-i") {
    const dk = e("でき", "出来");
    f.push([5, false, false, "る", dk], [5, false, true, "ます", dk], [5, true, false, "ない", dk], [5, true, true, "ません", dk]);
  } else {
    f.push(
      [5, false, false, "る", e("しえ")],
      [5, false, false, "る", e("しう")],
      [5, false, true, "ます", e("しえ")],
      [5, true, false, "ない", e("しえ")],
      [5, true, true, "ません", e("しえ")],
    );
  }
  f.push(
    [6, false, false, "れる", sa],
    [6, false, true, "れます", sa],
    [6, true, false, "れない", sa],
    [6, true, true, "れません", sa],
    [7, false, false, "せる", sa],
    [7, false, false, "す", sa],
    [7, false, true, "せます", sa],
    [7, false, true, "します", sa],
    [7, true, false, "せない", sa],
    [7, true, false, "さない", sa],
    [7, true, true, "せません", sa],
    [7, true, true, "しません", sa],
    [8, false, false, "せられる", sa],
    [8, false, true, "せられます", sa],
    [8, true, false, "せられない", sa],
    [8, true, true, "せられません", sa],
    [9, false, false, "よう", si],
    [9, false, true, p["9F"], si],
    [9, true, false, "るまい", su],
    [9, true, true, p["9NF"], si],
    [10, false, false, "ろ", si],
    [10, false, false, "よ", se],
    [10, false, true, p["10F"], si],
    [10, true, false, "るな", su],
    [10, true, true, p["10NF"], si],
    [11, false, false, "たら", si],
    [11, false, true, p["11F"], si],
    [11, true, false, "なかったら", negSi],
    [11, true, true, p["11NF"], si],
    [12, false, false, "たり", si],
    [12, false, true, p["12F"], si],
    [12, true, false, "なかったり", negSi],
    [12, true, true, p["12NF"], si],
    [13, false, false, "", si],
  );
  return rules(pos, f);
}

function adjective(pos: "adj-i" | "adj-ix"): ConjRule[] {
  const y = pos === "adj-ix" ? { euphr: "よ" } : undefined;
  return rules(pos, [
    [1, false, false, "い"],
    [1, false, true, "いです"],
    [1, true, false, "くない", y],
    [1, true, true, "くないです", y],
    [1, true, true, "くありません", y],
    [2, false, false, "かった", y],
    [2, false, true, "かったです", y],
    [2, true, false, "くなかった", y],
    [2, true, true, "くなかったです", y],
    [2, true, true, "くありませんでした", y],
    [3, false, false, "くて", y],
    [3, true, false, "くなくて", y],
    [4, false, false, "ければ", y],
    [4, true, false, "くなければ", y],
    [7, false, false, "くさせる", y],
    [9, false, false, "かろう", y],
    [9, false, true, "いでしょう"],
    [11, false, false, "かったら", y],
    [11, true, false, "くなかったら", y],
    [12, false, false, "かったり", y],
  ]);
}

function copula(): ConjRule[] {
  const f: Form[] = [
    [1, false, false, "だ"],
    [1, false, true, "です"],
    [1, true, false, "ではない"],
    [1, true, true, "ではありません"],
    [1, true, true, "ではないです"],
    [2, false, false, "だった"],
    [2, false, true, "でした"],
    [2, true, false, "ではなかった"],
    [2, true, true, "ではありませんでした"],
    [3, false, false, "で"],
    [3, false, true, "でありまして"],
    [3, true, false, "ではなくて"],
    [4, false, false, "なら"],
    [4, false, false, "ならば"],
    [4, false, false, "であれば"],
    [9, false, false, "だろう"],
    [9, false, true, "でしょう"],
    [10, false, false, "であれ"],
    [11, false, false, "だったら"],
    [11, false, true, "でしたら"],
    [11, true, false, "ではなかったら"],
    [11, true, true, "ではありませんでしたら"],
    [12, false, false, "だったり"],
  ];
  return rules("cop", f);
}

/** Rules before Ichiran's adjustments, keyed by part-of-speech code. */
export function builtinRuleTable(): RuleTable {
  const t: RuleTable = new Map();
  const add = (rs: ConjRule[]) => t.set(rs[0].pos, rs);
  add(adjective("adj-i"));
  add(adjective("adj-ix"));
  add(copula());
  add(ichidan("v1", "ろ"));
  add(ichidan("v1-s", ""));
  add(godan("v5aru", { ...row("ら", "い", "る", "れ", "ろ", "って", "った"), imperative: "い" }));
  add(godan("v5b", row("ば", "び", "ぶ", "べ", "ぼ", "んで", "んだ")));
  add(godan("v5g", row("が", "ぎ", "ぐ", "げ", "ご", "いで", "いだ")));
  add(godan("v5k", row("か", "き", "く", "け", "こ", "いて", "いた")));
  add(godan("v5k-s", row("か", "き", "く", "け", "こ", "って", "った")));
  add(godan("v5m", row("ま", "み", "む", "め", "も", "んで", "んだ")));
  add(godan("v5n", row("な", "に", "ぬ", "ね", "の", "んで", "んだ")));
  add(godan("v5r", row("ら", "り", "る", "れ", "ろ", "って", "った")));
  add(godan("v5r-i", { ...row("ら", "り", "る", "れ", "ろ", "って", "った"), negA: "", negStem: 2 }));
  add(godan("v5s", { ...row("さ", "し", "す", "せ", "そ", "して", "した"), causativePassiveShort: false }));
  add(godan("v5t", row("た", "ち", "つ", "て", "と", "って", "った")));
  add(godan("v5u", row("わ", "い", "う", "え", "お", "って", "った")));
  add(godan("v5u-s", row("わ", "い", "う", "え", "お", "うて", "うた")));
  add(kuru());
  add(suru("vs-s"));
  add(suru("vs-i"));
  // These classes only carry their bare dictionary form; Ichiran never
  // conjugates them (*do-not-conjugate*), but the entries exist upstream.
  t.set("adj-na", [{ pos: "adj-na", conj: 1, neg: false, fml: false, onum: 1, stem: 0, okuri: "だ", euphr: "", euphk: "" }]);
  t.set("n", [{ pos: "n", conj: 1, neg: false, fml: false, onum: 1, stem: 0, okuri: "だ", euphr: "", euphk: "" }]);
  t.set("vs", [{ pos: "vs", conj: 1, neg: false, fml: false, onum: 1, stem: 0, okuri: "する", euphr: "", euphk: "" }]);
  return t;
}

// ---------------------------------------------------------------------------
// User-supplied JMdictDB tables

/** Reads JMdictDB kwpos.csv and conjo.csv from a local directory. */
export async function loadJmdictdbRules(dir: string): Promise<RuleTable> {
  const tsv = async (f: string) =>
    (await readFile(join(dir, f), "utf8"))
      .split(/\r?\n/)
      .slice(1)
      .filter((l) => l.trim())
      .map((l) => l.split("\t").map((f) => (/^".*"$/.test(f) ? f.slice(1, -1).replaceAll('""', '"') : f)));
  const posById = new Map((await tsv("kwpos.csv")).map(([id, pos]) => [Number(id), pos]));
  const t: RuleTable = new Map();
  for (const [posId, conj, neg, fml, onum, stem, okuri, euphr, euphk] of await tsv("conjo.csv")) {
    const pos = posById.get(Number(posId));
    if (!pos) continue;
    const list = t.get(pos) ?? [];
    list.push({
      pos,
      conj: Number(conj),
      neg: neg === "t",
      fml: fml === "t",
      onum: Number(onum),
      stem: Number(stem),
      okuri: okuri ?? "",
      euphr: euphr ?? "",
      euphk: euphk ?? "",
    });
    t.set(pos, list);
  }
  return t;
}

/** dict-errata.lisp errata-conj-rules-hook, applied to a rule table. Rules
 * that Ichiran appends end up after the table rows, as upstream. */
export function applyIchiranRuleErrata(input: RuleTable): RuleTable {
  const t: RuleTable = new Map([...input].map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const add = (pos: string, r: Omit<ConjRule, "pos">) => {
    if (t.has(pos)) t.get(pos)!.push({ pos, ...r });
  };
  for (const [pos, euphr] of [
    ["adj-i", ""],
    ["adj-ix", "よ"],
  ]) {
    add(pos, { conj: CONJ_ADVERBIAL, neg: false, fml: false, onum: 1, stem: 1, okuri: "く", euphr, euphk: "" });
    add(pos, { conj: CONJ_ADJECTIVE_STEM, neg: false, fml: false, onum: 1, stem: 1, okuri: "", euphr, euphk: "" });
    add(pos, { conj: CONJ_ADJECTIVE_LITERARY, neg: false, fml: false, onum: 1, stem: 1, okuri: "き", euphr, euphk: "" });
  }
  add("v5aru", { conj: 3, neg: false, fml: false, onum: 2, stem: 1, okuri: "り", euphr: "", euphk: "" });
  for (const pos of ["v1", "v1-s"])
    for (const r of t.get(pos) ?? []) if (r.conj === 1 && r.fml && r.neg) r.okuri = "ません";
  for (const r of t.get("v5u") ?? []) if (r.conj === 11 && !r.fml && r.neg) r.okuri = "わなかったら";
  if (t.has("vs-s")) t.set("vs-s", t.get("vs-s")!.filter((r) => r.conj !== 5));
  for (const [pos, list] of t) {
    for (const r of list)
      if (r.conj === 7 && r.onum === 2) {
        r.conj = CONJ_CAUSATIVE_SU;
        r.onum = 1;
      }
    if (pos.startsWith("v5")) {
      const negRule = list.find((r) => r.conj === 1 && r.neg && !r.fml);
      if (negRule && negRule.okuri.length > 2)
        list.push({ ...negRule, conj: CONJ_NEGATIVE_STEM, okuri: negRule.okuri.slice(0, -2) });
    }
  }
  return t;
}
