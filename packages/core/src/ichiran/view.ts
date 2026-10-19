/** The ichi.moe presentation of Ichiran results as plain data: what a word
 * card shows, derived only from word-info-gloss-json and word info. Shared by
 * the Playground renderer and the ichi.moe comparison script. Browser-safe:
 * no dictionary access. */
import type { Json } from "./output.js";

export interface SenseView {
  /** "[n,vs,vt]" */
  pos: string;
  /** Sense information note (s_inf). */
  note?: string;
  /** "{food}" */
  field?: string;
  gloss: string;
}
export interface ConjPropView {
  pos: string;
  type: string;
  negative: boolean;
  formal: boolean;
}
export interface ConjView {
  props: ConjPropView[];
  /** The intermediate conjugation(s) of a secondary conjugation. */
  via?: ConjView[];
  /** Root reading and senses, when not via. */
  reading?: string;
  senses?: SenseView[];
}
export interface EntryView {
  reading: string;
  /** "Value: 3", "Value: 3rd" */
  counter?: string;
  compound?: { words: string[]; parts: EntryView[] };
  /** Suffix role, e.g. "indicates continuing action (to be ...ing)". */
  suffix?: string;
  senses: SenseView[];
  conjugations: ConjView[];
}
export interface CardView {
  romanization: string;
  /** Entries for one word; several for an alternative (numbered on ichi.moe). */
  entries: EntryView[];
  /** "omitted: N" */
  skipped: number;
}

type Obj = { [k: string]: Json };
const isObj = (j: Json | undefined): j is Obj => !!j && typeof j === "object" && !Array.isArray(j);
const list = (j: Json | undefined): Json[] => (Array.isArray(j) ? j : []);
const str = (j: Json | undefined): string | undefined => (typeof j === "string" ? j : undefined);

function senses(j: Json | undefined): SenseView[] {
  return list(j)
    .filter(isObj)
    .map((s) => {
      const v: SenseView = { pos: str(s.pos) ?? "", gloss: str(s.gloss) ?? "" };
      if (str(s.info)) v.note = str(s.info);
      if (str(s.field)) v.field = str(s.field);
      return v;
    });
}
/** ichi.moe leaves out the root senses of a suffix's conjugation. */
function conj(c: Obj, withSenses = true): ConjView {
  const v: ConjView = {
    props: list(c.prop)
      .filter(isObj)
      .map((p) => ({ pos: str(p.pos) ?? "", type: str(p.type) ?? "", negative: p.neg === true, formal: p.fml === true })),
  };
  if (Array.isArray(c.via)) v.via = c.via.filter(isObj).map((x) => conj(x, withSenses));
  else {
    v.reading = str(c.reading) ?? "";
    v.senses = withSenses ? senses(c.gloss) : [];
  }
  return v;
}
/** One word-info-gloss-json object (not an alternative wrapper). */
export function entryView(g: Obj): EntryView {
  const suffix = str(g.suffix);
  const v: EntryView = {
    reading: str(g.reading) ?? "",
    senses: senses(g.gloss),
    conjugations: list(g.conj)
      .filter(isObj)
      .map((c) => conj(c, !suffix)),
  };
  if (isObj(g.counter)) v.counter = str(g.counter.value);
  if (Array.isArray(g.compound))
    v.compound = { words: g.compound.map((w) => String(w)), parts: list(g.components).filter(isObj).map(entryView) };
  if (suffix) v.suffix = suffix;
  return v;
}
/** A card from a word's romanization, gloss JSON and skipped count. */
export function cardView(romanization: string, gloss: Json, skipped = 0): CardView {
  const g = isObj(gloss) ? gloss : {};
  const entries = Array.isArray(g.alternative) ? g.alternative.filter(isObj).map(entryView) : [entryView(g)];
  return { romanization, entries, skipped };
}

/** join-parts: whether a space goes before each part (alphanumeric parts not
 * preceded by whitespace get one). */
export function spacesBefore(parts: string[]): boolean[] {
  let lastSpace = true;
  return parts.map((part) => {
    const space = part.length > 0 && !lastSpace && /^[\p{L}\p{N}]/u.test(part);
    if (part.length) lastSpace = /\s/u.test(part[part.length - 1]);
    return space;
  });
}
/** ichiran:join-parts, as used for the romanized sentence. */
export function joinParts(parts: string[]): string {
  const spaces = spacesBefore(parts);
  return parts.map((p, i) => (spaces[i] ? " " : "") + p).join("");
}
