/** Selection over immutable Ichiran bundles. No DB access or fixtures here. */
import type { SeqBundle } from "./ichiran/store.js";
import { toHiragana } from "./kana.js";
import { YomichiError } from "./types.js";
import {
  generateVerbInflections,
  type VerbInflectionResult,
} from "./verb-inflections.js";

export interface VerbInflectionRequest {
  word: string;
  reading?: string;
  entryId?: string;
  senseId?: string;
  pos?: string;
}
export interface DictionaryVerbInflections extends VerbInflectionResult {
  entryId: string;
  senseIds: string[];
  spellings: string[];
}
export interface VerbInflectionCandidate {
  entryId: string;
  senseIds: string[];
  reading: string;
  pos: string;
  spellings: string[];
  glosses: string[];
}
export function verbInflectionCandidates(
  word: string,
  bundles: readonly SeqBundle[],
  selectors: Omit<VerbInflectionRequest, "word"> = {},
): DictionaryVerbInflections[] {
  const entries = bundles.filter(
    (b) =>
      b.entry.rootP &&
      b.readings.some((r) => r.text === word) &&
      (!selectors.entryId || String(b.entry.seq) === selectors.entryId),
  );
  if (!entries.length)
    throw new YomichiError(
      "NOT_FOUND",
      "Dictionary root entry not found for this word and entryId.",
      404,
    );
  if (
    selectors.senseId &&
    !entries.some((b) =>
      b.senses.some((s) => String(s.id) === selectors.senseId),
    )
  )
    throw new YomichiError(
      "NOT_FOUND",
      "senseId does not belong to the selected entry.",
      404,
    );
  const results: DictionaryVerbInflections[] = [];
  let readingMatched = false;
  for (const b of entries) {
    const kanjiQuery = b.readings.some(
      (r) => r.table === "kanji" && r.text === word,
    );
    const kanaRows = b.readings.filter(
      (r) =>
        r.table === "kana" &&
        (kanjiQuery || r.text === word) &&
        (!selectors.reading ||
          toHiragana(r.text) === toHiragana(selectors.reading)) &&
        (!kanjiQuery ||
          (!r.nokanji &&
            (!b.restricted.some((x) => x.reading === r.text) ||
              b.restricted.some(
                (x) => x.reading === r.text && x.text === word,
              )))),
    );
    for (const kanaRow of kanaRows) {
      readingMatched = true;
      const spellings = b.readings
        .filter(
          (r) =>
            r.table === "kanji" &&
            !kanaRow.nokanji &&
            (!b.restricted.some((x) => x.reading === kanaRow.text) ||
              b.restricted.some(
                (x) => x.reading === kanaRow.text && x.text === r.text,
              )),
        )
        .map((r) => r.text);
      // In JMdict an omitted POS inherits the previous explicit POS, even when
      // that previous sense has different spelling/reading restrictions.
      let inheritedPos: string[] = [];
      for (const sense of [...b.senses].sort((a, z) => a.ord - z.ord)) {
        const props = b.props.filter((p) => p.senseId === sense.id);
        const tagged = (tag: string) =>
          props
            .filter((p) => p.tag === tag)
            .sort((a, z) => a.ord - z.ord)
            .map((p) => p.text);
        const ownPos = tagged("pos");
        if (ownPos.length) inheritedPos = ownPos;
        if (selectors.senseId && String(sense.id) !== selectors.senseId)
          continue;
        const stagk = tagged("stagk"),
          stagr = tagged("stagr");
        if (
          stagr.length &&
          !stagr.some((r) => toHiragana(r) === toHiragana(kanaRow.text))
        )
          continue;
        if (
          stagk.length &&
          !(kanjiQuery
            ? stagk.includes(word)
            : spellings.some((w) => stagk.includes(w)))
        )
          continue;
        const lexicalForms = kanjiQuery
          ? [word]
          : spellings.filter((w) => !stagk.length || stagk.includes(w));
        for (const pos of new Set(inheritedPos)) {
          if (selectors.pos && selectors.pos !== pos) continue;
          const result = generateVerbInflections(word, kanaRow.text, [pos], {
            lexicalForms,
          });
          if (!result) continue;
          const existing = results.find(
            (r) =>
              r.entryId === String(b.entry.seq) &&
              r.reading === result.reading &&
              r.pos === pos,
          );
          if (existing) {
            if (!existing.senseIds.includes(String(sense.id)))
              existing.senseIds.push(String(sense.id));
          } else
            results.push({
              ...result,
              entryId: String(b.entry.seq),
              senseIds: [String(sense.id)],
              spellings: lexicalForms,
            });
        }
      }
    }
  }
  if (!readingMatched && selectors.reading)
    throw new YomichiError(
      "INVALID_READING",
      "Reading does not match the selected spelling and entry.",
    );
  if (!results.length)
    throw new YomichiError(
      "NOT_A_VERB",
      "No supported verb POS for the selected spelling, reading, sense and POS.",
      422,
    );
  // Preserve the ordinary shorthand query for the irregular verb する. Its
  // godan homophones (刷る, 剃る, etc.) must remain explicitly selectable, but
  // must not block this established default. POS still comes from the selected
  // dictionary sense; never infer it from spelling or hard-code an entry ID.
  if (
    word === "する" &&
    !selectors.entryId &&
    !selectors.senseId &&
    !selectors.pos
  ) {
    const suru = results.filter(
      (r) => r.reading === "する" && r.pos === "vs-i",
    );
    if (suru.length === 1) return suru;
  }
  return results;
}
export function summarizeVerbCandidate(
  result: DictionaryVerbInflections,
  bundles: readonly SeqBundle[],
): VerbInflectionCandidate {
  const bundle = bundles.find((b) => String(b.entry.seq) === result.entryId);
  return {
    entryId: result.entryId,
    senseIds: result.senseIds,
    reading: result.reading,
    pos: result.pos,
    spellings: result.spellings,
    glosses: (bundle?.glosses ?? [])
      .filter((g) => result.senseIds.includes(String(g.senseId)))
      .slice(0, 5)
      .map((g) => g.text),
  };
}
