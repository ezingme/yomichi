/** Exact port of Ichiran romanize.lisp (Timofei Shatrov, MIT). */
import { getCharClass, isClassified, normalize, voiceChar } from "./chars.js";
import { processHints, stripHints } from "./split.js";

type Tree = TreeItem[];
type TreeItem = string | { mod: string; tree: Tree } | null;
// Plain characters (unclassified) are kept as { char } to distinguish them from classes.
type Cc = { cls: string } | { char: string };

function getCharacterClasses(word: string): Cc[] {
  return [...word].map((c) => (isClassified(c) ? { cls: getCharClass(c)! } : { char: c }));
}
function processIterationCharacters(list: Cc[]): Cc[] {
  const out: Cc[] = [];
  let prev: Cc | null = null;
  for (const cc of list) {
    if ("cls" in cc && cc.cls === "iter") {
      if (prev) out.push(prev);
    } else if ("cls" in cc && cc.cls === "iter-v") {
      if (prev) out.push("cls" in prev ? { cls: voiceChar(prev.cls) } : prev);
    } else {
      out.push(cc);
      prev = cc;
    }
  }
  return out;
}
const MODIFIERS = new Set(["+a", "+i", "+u", "+e", "+o", "+ya", "+yu", "+yo", "+wa", "long-vowel"]);
type Node = string | { char: string } | { mod: string; tree: Node[] } | null;
function processModifiers(list: Cc[]): Node[] {
  const result: Node[] = [];
  for (let i = 0; i < list.length; i++) {
    const cc = list[i];
    if ("cls" in cc && cc.cls === "sokuon") {
      result.push({ mod: "sokuon", tree: processModifiers(list.slice(i + 1)) });
      break;
    }
    if ("cls" in cc && MODIFIERS.has(cc.cls)) {
      const prev = result.pop() ?? null;
      result.push({ mod: cc.cls, tree: [prev] });
    } else result.push("cls" in cc ? cc.cls : cc);
  }
  return result;
}
function leftmostAtom(tree: Node[]): Node {
  const first = tree[0];
  if (first === undefined || first === null || typeof first === "string" || "char" in first) return first ?? null;
  return first.mod === "sokuon" ? leftmostAtom(first.tree) : leftmostAtom(first.tree);
}

const HEPBURN: Record<string, string> = {
  a: "a", i: "i", u: "u", e: "e", o: "o",
  ka: "ka", ki: "ki", ku: "ku", ke: "ke", ko: "ko",
  sa: "sa", shi: "shi", su: "su", se: "se", so: "so",
  ta: "ta", chi: "chi", tsu: "tsu", te: "te", to: "to",
  na: "na", ni: "ni", nu: "nu", ne: "ne", no: "no",
  ha: "ha", hi: "hi", fu: "fu", he: "he", ho: "ho",
  ma: "ma", mi: "mi", mu: "mu", me: "me", mo: "mo",
  ya: "ya", yu: "yu", yo: "yo",
  ra: "ra", ri: "ri", ru: "ru", re: "re", ro: "ro",
  wa: "wa", wi: "wi", we: "we", wo: "wo",
  n: "n'",
  ga: "ga", gi: "gi", gu: "gu", ge: "ge", go: "go",
  za: "za", ji: "ji", zu: "zu", ze: "ze", zo: "zo",
  da: "da", dji: "ji", dzu: "zu", de: "de", do: "do",
  ba: "ba", bi: "bi", bu: "bu", be: "be", bo: "bo",
  pa: "pa", pi: "pi", pu: "pu", pe: "pe", po: "po",
  "+a": "a", "+i": "i", "+u": "u", "+e": "e", "+o": "o",
  "+ya": "ya", "+yu": "yu", "+yo": "yo",
  vu: "vu", "+wa": "wa",
};
const KUNREI: Record<string, string> = {
  ...HEPBURN,
  shi: "si", chi: "ti", tsu: "tu", fu: "hu", wi: "i", we: "e", wo: "o",
  ji: "zi", dji: "zi", dzu: "zu",
};

export interface RomanizationMethod {
  name: string;
  table: Record<string, string>;
  hepburn: boolean;
  simplify: (s: string) => string;
}
function ngrams(map: string[]): (s: string) => string {
  const pairs: [string, string][] = [];
  for (let i = 0; i < map.length; i += 2) pairs.push([map[i], map[i + 1]]);
  return (s) => {
    let out = "";
    outer: for (let i = 0; i < s.length; ) {
      for (const [f, t] of pairs)
        if (s.startsWith(f, i)) {
          out += t;
          i += f.length;
          continue outer;
        }
      out += s[i++];
    }
    return out;
  };
}
const hepburnN = (s: string) => s.replace(/n'([^aiueoy]|$)/g, "n$1");
const simple = (map: string[]) => {
  const f = ngrams(map);
  return (s: string) => f(hepburnN(s));
};
export const METHODS: Record<string, RomanizationMethod> = {
  "hepburn-basic": { name: "hepburn-basic", table: HEPBURN, hepburn: true, simplify: hepburnN },
  "hepburn-simple": { name: "hepburn-simple", table: HEPBURN, hepburn: true, simplify: simple(["oo", "o", "ou", "o", "uu", "u"]) },
  "hepburn-passport": { name: "hepburn-passport", table: HEPBURN, hepburn: true, simplify: simple(["oo", "oh", "ou", "oh", "uu", "u"]) },
  "hepburn-traditional": {
    name: "hepburn-traditional",
    table: HEPBURN,
    hepburn: true,
    simplify: (s) => {
      const t = simple(["oo", "ō", "ou", "ō", "uu", "ū"])(s);
      return t.replace(/n'([aiueoy])/g, "n-$1").replace(/n([mbp])/g, "m$1");
    },
  },
  "hepburn-modified": {
    name: "hepburn-modified",
    table: { ...HEPBURN, wo: "o" },
    hepburn: true,
    simplify: simple(["oo", "ō", "ou", "ō", "uu", "ū", "aa", "ā", "ee", "ē"]),
  },
  "kunrei-siki": {
    name: "kunrei-siki",
    table: KUNREI,
    hepburn: false,
    simplify: (s) => ngrams(["oo", "ô", "ou", "ô", "uu", "û"])(s.replace(/n'([^aiueoy]|$)/g, "n$1")),
  },
};
export const DEFAULT_METHOD = METHODS["hepburn-traditional"];

function rBase(m: RomanizationMethod, item: string): string {
  return m.table[item] ?? item.toLowerCase();
}
function core(m: RomanizationMethod, tree: Node[]): string {
  let out = "";
  for (const item of tree) {
    if (item === null) continue;
    if (typeof item === "string") out += rBase(m, item);
    else if ("char" in item) out += item.char;
    else out += rApply(item.mod, m, item.tree);
  }
  return out;
}
const isBasicLatin = (c: string) => c.charCodeAt(0) < 0x80;
function rApply(mod: string, m: RomanizationMethod, tree: Node[]): string {
  if (mod === "sokuon") {
    if (m.hepburn && leftmostAtom(tree) === "chi") return "t" + core(m, tree);
    const inner = core(m, tree);
    return !inner.length || !isBasicLatin(inner[0]) ? inner : inner[0] + inner;
  }
  if (mod === "long-vowel") return core(m, tree);
  if (m.hepburn && (mod === "+ya" || mod === "+yu" || mod === "+yo")) {
    const first = tree[0];
    const v = mod.slice(2);
    if (first === "shi") return "sh" + v;
    if (first === "chi") return "ch" + v;
    if (first === "ji" || first === "dji") return "j" + v;
  }
  const yoon = m.table[mod];
  if (yoon) {
    const first = tree[0];
    if (first === "u") return "w" + yoon;
    if (first === "a" || first === "i" || first === "e" || first === "o") return m.table[first] + yoon;
    const inner = core(m, tree);
    return inner.slice(0, Math.max(0, inner.length - 1)) + yoon;
  }
  return core(m, tree) + mod.toLowerCase();
}

export function romanizeList(list: Cc[], m: RomanizationMethod = DEFAULT_METHOD): string {
  return m.simplify(core(m, processModifiers(processIterationCharacters(list))));
}
function rSpecial(word: string): string | null {
  if (word === "っ") return "!";
  if (word === "ー") return "~";
  return null;
}
export function romanizeWord(
  word: string,
  opts: { method?: RomanizationMethod; originalSpelling?: string | null; normalize?: boolean } = {},
): string {
  const m = opts.method ?? DEFAULT_METHOD;
  if (opts.normalize ?? true) word = normalize(word);
  const special = rSpecial(opts.originalSpelling ?? word);
  if (special !== null) return special;
  return romanizeList(getCharacterClasses(processHints(word)), m);
}
/** CL string-capitalize: first alphanumeric of each word upcased, rest downcased. */
function capitalize(s: string): string {
  let out = "",
    inWord = false;
  for (const c of s) {
    const alnum = /[\p{L}\p{N}]/u.test(c);
    out += alnum ? (inWord ? c.toLowerCase() : c.toUpperCase()) : c;
    inWord = alnum;
  }
  return out;
}
export function romanizeWordGeo(input: string): string {
  return capitalize(romanizeWord(input, { method: METHODS["hepburn-simple"], normalize: true }));
}
export { stripHints };
