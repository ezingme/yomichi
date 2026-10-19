import type { Entry, Lexeme } from "./types.js";
import { toHiragana } from "./kana.js";
import { conjugatePair } from "./morphology/paradigms.js";
export { conjugatePair, MORPHOLOGY_POS } from "./morphology/paradigms.js";
export type { MorphologyForm } from "./morphology/paradigms.js";

/** Finite productive paradigms, retaining dictionary reading/sense restrictions. */
export function generateForms(entry: Entry): Lexeme[] {
  const output: Lexeme[] = [];
  for (const r of entry.readings) {
    const spellings = r.noKanji
      ? []
      : entry.spellings.filter(
          (s) => !r.restrictions.length || r.restrictions.includes(s),
        );
    for (const surface of new Set([...spellings, r.text])) {
      const senseIndices = entry.senses.flatMap((s, i) =>
        (!s.restrictions.length ||
          s.restrictions.includes(surface) ||
          (surface === r.text &&
            spellings.some((w) => s.restrictions.includes(w)))) &&
        (!s.readingRestrictions.length ||
          s.readingRestrictions.includes(r.text))
          ? [i]
          : [],
      );
      const senses = senseIndices.map((i) => entry.senses[i]);
      const pos = [...new Set(senses.flatMap((s) => s.pos))];
      const base: Lexeme = {
        surface,
        reading: toHiragana(r.text),
        lemma: surface,
        entryId: entry.id,
        pos,
        priority: entry.spellingPriorities
          ? (surface === r.text
              ? 0
              : (entry.spellingPriorities[surface] ?? 0)) + (r.priority ?? 0)
          : entry.priority,
        senseIndices,
        conjugationSteps: [],
        cost: ["n-pref", "pref", "n-suf", "suf"].includes(pos[0]) ? 3 : 0,
      };
      output.push(base);
      // These upstream exceptions are lexicalized strings, not productive verbs.
      if (["2765070", "2835284"].includes(entry.id)) continue;
      for (const part of pos) {
        const applicable = senseIndices.filter((i) =>
          entry.senses[i].pos.includes(part),
        );
        for (const form of conjugatePair(surface, base.reading, part)) {
          output.push({
            ...base,
            surface: form.surface,
            reading: form.reading,
            pos: [part],
            senseIndices: applicable,
            conjugationSteps: form.steps,
            cost: form.steps.length * 1.5 + (form.weak ? 8 : 0),
          });
        }
      }
    }
  }
  return [
    ...new Map(
      output.map((f) => [
        JSON.stringify([
          f.surface,
          f.reading,
          f.entryId,
          f.pos,
          f.senseIndices,
          f.conjugationSteps,
        ]),
        f,
      ]),
    ).values(),
  ];
}
