/** Jisho-style verb paradigm rows built on the existing morphology engine.
 *
 * `sensePropPosTexts` must contain the `text` values from rows in
 * `sense_prop` whose `tag` is `pos`. POS is deliberately not inferred from
 * the spelling or from gloss text.
 */
import { toHiragana } from "./kana.js";
import { conjugatePair, MORPHOLOGY_POS, type MorphologyForm } from "./morphology/paradigms.js";

export interface VerbInflectionRow {
  form: string;
  positive: string;
  negative: string;
}

export interface VerbInflectionResult {
  word: string;
  reading: string;
  /** POS class selected from sense_prop.text to generate this paradigm. */
  pos: string;
  /** Supported verb POS classes found in sense_prop.text for the entry. */
  posCandidates: string[];
  forms: VerbInflectionRow[];
}

const VERB_POS = new Set<string>(
  MORPHOLOGY_POS.filter((pos) => pos.startsWith("v")),
);

function select(
  forms: MorphologyForm[],
  step: string,
  prefix: readonly string[] = [],
  surfaceSuffix?: string,
): MorphologyForm | undefined {
  return forms.find((form) =>
    form.steps.length === prefix.length + 1 &&
    prefix.every((value, index) => form.steps[index] === value) &&
    form.steps[prefix.length] === step &&
    (!surfaceSuffix || form.surface.endsWith(surfaceSuffix)),
  );
}

function row(
  form: string,
  positive?: string,
  negative?: string,
): VerbInflectionRow | null {
  return positive && negative ? { form, positive, negative } : null;
}

function buildRows(
  word: string,
  generated: MorphologyForm[],
  pos: string,
): VerbInflectionRow[] {
  const basic = (step: string, suffix?: string) =>
    select(generated, step, [], suffix)?.surface;
  const derived = (derivation: string, step: string, suffix?: string) =>
    select(generated, step, [derivation], suffix)?.surface;
  const continuative = basic("continuative");
  const negativeVolitional =
    pos.startsWith("v1") && continuative
      ? continuative + "まい"
      : basic("negative volitional");

  return [
    row("现在（普通体）", word, basic("negative")),
    row("现在（敬体）", basic("polite"), basic("polite negative")),
    row("过去（普通体）", basic("past"), basic("negative past")),
    row("过去（敬体）", basic("polite past"), basic("polite negative past")),
    row("て形", basic("te-form"), basic("negative te-form", "ないで")),
    row("意志形", basic("volitional"), negativeVolitional),
    row("假定形（ば形）", basic("conditional"), basic("negative conditional", "なければ")),
    row("命令形", basic("imperative"), word + "な"),
    row("可能形", basic("potential"), derived("potential", "negative")),
    row("被动形", basic("passive"), derived("passive", "negative")),
    row("使役形", basic("causative"), derived("causative", "negative")),
    row("使役被动", basic("causative passive"), derived("causative passive", "negative")),
  ].filter((item): item is VerbInflectionRow => item !== null);
}

/**
 * Generate a compact affirmative/negative paradigm for a dictionary-form verb.
 * Supply POS strings from sense_prop.text (tag='pos'). Returns null when no
 * supported verb POS is present. For ambiguous POS, the class yielding the
 * most supported rows is selected, with sense_prop order breaking ties.
 */
export function generateVerbInflections(
  word: string,
  reading: string,
  sensePropPosTexts: readonly string[],
): VerbInflectionResult | null {
  if (!word.trim() || !reading.trim()) return null;

  const posCandidates = [
    ...new Set(
      sensePropPosTexts
        .map((pos) => pos.trim())
        .filter((pos) => VERB_POS.has(pos)),
    ),
  ];
  if (!posCandidates.length) return null;

  const kana = toHiragana(reading);
  const analyses = posCandidates
    .map((pos) => ({
      pos,
      forms: buildRows(word, conjugatePair(word, kana, pos), pos),
    }))
    .sort((a, b) => b.forms.length - a.forms.length);

  const selected = analyses[0];
  if (!selected || !selected.forms.length) return null;

  return {
    word,
    reading: kana,
    pos: selected.pos,
    posCandidates,
    forms: selected.forms,
  };
}
