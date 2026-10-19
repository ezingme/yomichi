/** Word lists and conjugation-form predicates from Ichiran dict-errata.lisp
 * (Timofei Shatrov, MIT). Numbers are JMdict sequence numbers. */
import type { ConjPropRow } from "./store.js";

/** seq of words that aren't really words, like suffixes etc. */
export const SKIP_WORDS = new Set([
  2822120, 2013800, 2108590, 2029040, 2428180, 2654250, 2561100, 2210270,
  2210710, 2257550, 2210320, 2017560, 2394890, 2194000, 2568000, 2537250,
  2760890, 2831062, 2831063, 2029030, 2568020, 900000, 2827357,
]);
/** Words that only have meaning when they're final */
export const FINAL_PRT = new Set([
  2017770, 2425930, 2130430, 2029130, 2834812, 2718360, 2201380, 2722170,
  2751630,
]);
/** Particles that are final, but also have other uses */
export const SEMI_FINAL_PRT = new Set([
  ...FINAL_PRT,
  2029120, 2086640, 2029110, 2029080, 2029100,
]);
export const COPULAE = new Set([2089020]);
/** Particles that don't get final bonus */
export const NON_FINAL_PRT = new Set([2139720]);
/** Words that get no kanji break penalty */
export const NO_KANJI_BREAK_PENALTY = new Set([
  1169870, 1198360, 1277450, 2028980, 1423000, 1164690, 1587040, 2827864,
]);
export const FORCE_KANJI_BREAK = new Set(["です"]);
/** Words that do not cause kanji break */
export const NO_KANJI_BREAK = new Set(["日置"]);

export const CONJ_ADVERBIAL = 50;
export const CONJ_ADJECTIVE_STEM = 51;
export const CONJ_NEGATIVE_STEM = 52;
export const CONJ_CAUSATIVE_SU = 53;
export const CONJ_ADJECTIVE_LITERARY = 54;

/** (pos?) type neg fml, with "any" as a wildcard */
type Form = [number, boolean | "any", boolean | "any"] | [string, number, boolean | "any", boolean | "any"];
export const SKIP_CONJ_FORMS: Form[] = [
  [10, true, "any"],
  [3, true, true],
  ["vs-s", 5, "any", "any"],
];
export const WEAK_CONJ_FORMS: Form[] = [
  [CONJ_ADJECTIVE_STEM, "any", "any"],
  [CONJ_NEGATIVE_STEM, "any", "any"],
  [CONJ_CAUSATIVE_SU, "any", "any"],
  [CONJ_ADJECTIVE_LITERARY, "any", "any"],
  [9, true, "any"],
];

const eqlForm = (l: number | boolean | null, r: number | boolean | "any") =>
  r === "any" || l === r;
export function testConjProp(prop: ConjPropRow, forms: Form[]): boolean {
  return forms.some((f) =>
    f.length === 3
      ? eqlForm(prop.conjType, f[0]) && eqlForm(prop.neg, f[1]) && eqlForm(prop.fml, f[2])
      : prop.pos === f[0] &&
        eqlForm(prop.conjType, f[1]) &&
        eqlForm(prop.neg, f[2]) &&
        eqlForm(prop.fml, f[3]),
  );
}
export function skipByConjData(conjData: { prop: ConjPropRow }[]): boolean {
  return conjData.length > 0 && conjData.every((cd) => testConjProp(cd.prop, SKIP_CONJ_FORMS));
}
