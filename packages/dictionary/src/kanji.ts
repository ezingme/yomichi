import { toHiragana } from "wanakana";
import type { Kanji } from "../../core/src/types.js";
/** Reading notation follows KANJIDIC2; see Ichiran kanji.lisp load-readings
 * (Timofei Shatrov, MIT). This independent helper does not infer rendaku. */
export interface KanjiReadingMatch {
  type: string;
  original: string;
  stem: string;
  okurigana: string;
  prefix: boolean;
  suffix: boolean;
  match: "stem" | "full";
}
export function matchKanjiReading(
  kanji: Kanji & { nanori?: string[] },
  reading: string,
): KanjiReadingMatch[] {
  const target = toHiragana(reading.normalize("NFKC"), { passRomaji: true });
  return [
    ...kanji.readings.filter((r) => r.type.startsWith("ja_")),
    ...(kanji.nanori ?? []).map((text) => ({ type: "nanori", text })),
  ].flatMap((r) => {
    const normalized = r.text.normalize("NFKC");
    const [stem, okurigana = ""] = normalized
      .replace(/^-|-$/g, "")
      .split(".")
      .map((s) => toHiragana(s, { passRomaji: true }));
    if (target !== stem && target !== stem + okurigana) return [];
    return [
      {
        type: r.type,
        original: r.text,
        stem,
        okurigana,
        prefix: normalized.endsWith("-"),
        suffix: normalized.startsWith("-"),
        match: target === stem ? ("stem" as const) : ("full" as const),
      },
    ];
  });
}
