import type { Entry, Lexeme } from "./types.js";
import { toHiragana } from "./kana.js";
const GODAN: Record<string, string[]> = {
  う: ["わ", "い", "え", "お", "って", "った"],
  く: ["か", "き", "け", "こ", "いて", "いた"],
  ぐ: ["が", "ぎ", "げ", "ご", "いで", "いだ"],
  す: ["さ", "し", "せ", "そ", "して", "した"],
  つ: ["た", "ち", "て", "と", "って", "った"],
  ぬ: ["な", "に", "ね", "の", "んで", "んだ"],
  ぶ: ["ば", "び", "べ", "ぼ", "んで", "んだ"],
  む: ["ま", "み", "め", "も", "んで", "んだ"],
  る: ["ら", "り", "れ", "ろ", "って", "った"],
};
/** Selected productive morphology, not a full Ichiran conjugation port. */
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
        priority: entry.priority,
        senseIndices,
        conjugationSteps: [],
        cost: 0,
      };
      output.push(base);
      const add = (w: string, k: string, steps: string[]) =>
        output.push({
          ...base,
          surface: w,
          reading: k,
          conjugationSteps: steps,
          cost: steps.length * 1.5,
        });
      const w = surface.slice(0, -1),
        k = base.reading.slice(0, -1);
      const ichi = (ws: string, ks: string, prefix: string[] = []) => {
        for (const [ending, name] of [
          ["ます", "polite"],
          ["ました", "polite past"],
          ["ません", "polite negative"],
          ["ませんでした", "polite negative past"],
          ["ない", "negative"],
          ["なかった", "negative past"],
          ["た", "past"],
          ["て", "te-form"],
          ["れば", "conditional"],
          ["よう", "volitional"],
          ["ろ", "imperative"],
          ["たい", "desiderative"],
        ])
          add(ws + ending, ks + ending, [...prefix, name]);
        for (const [ending, name] of [
          ["ている", "progressive"],
          ["ていた", "progressive past"],
          ["ています", "progressive polite"],
          ["ていました", "progressive polite past"],
        ])
          add(ws + ending, ks + ending, [...prefix, name]);
      };
      if (pos.includes("v1") && surface.endsWith("る")) {
        ichi(w, k);
        for (const [ending, name] of [
          ["られ", "potential/passive"],
          ["させ", "causative"],
          ["させられ", "causative passive"],
        ]) {
          add(w + ending + "る", k + ending + "る", [name]);
          ichi(w + ending, k + ending, [name]);
        }
      } else if (
        pos.some((p) => p.startsWith("v5")) &&
        GODAN[surface.slice(-1)]
      ) {
        const [a, regularI, e, o, te0, past0] = GODAN[surface.slice(-1)];
        const i = pos.includes("v5aru") ? "い" : regularI;
        const te = pos.includes("v5k-s")
            ? "って"
            : pos.includes("v5u-s")
              ? "うて"
              : te0,
          past = pos.includes("v5k-s")
            ? "った"
            : pos.includes("v5u-s")
              ? "うた"
              : past0;
        for (const [ending, name] of [
          [i + "ます", "polite"],
          [i + "ました", "polite past"],
          [i + "ません", "polite negative"],
          [i + "ませんでした", "polite negative past"],
          [a + "ない", "negative"],
          [a + "なかった", "negative past"],
          [te, "te-form"],
          [past, "past"],
          [e + "ば", "conditional"],
          [o + "う", "volitional"],
          [e, "imperative"],
          [i + "たい", "desiderative"],
          [te + "いる", "progressive"],
          [te + "います", "progressive polite"],
          [te + "いた", "progressive past"],
        ])
          add(w + ending, k + ending, [name]);
        for (const [ending, name] of [
          [e, "potential"],
          [a + "れ", "passive"],
          [a + "せ", "causative"],
          [a + "せられ", "causative passive"],
        ]) {
          add(w + ending + "る", k + ending + "る", [name]);
          ichi(w + ending, k + ending, [name]);
        }
      } else if (
        pos.some((p) => ["vs-i", "vs-s"].includes(p)) &&
        surface.endsWith("する")
      ) {
        const ws = surface.slice(0, -2),
          ks = base.reading.slice(0, -2);
        ichi(ws + "し", ks + "し");
        const bad = output.findIndex(
          (f) => f.entryId === entry.id && f.surface === ws + "しれば",
        );
        if (bad >= 0) output.splice(bad, 1);
        add(ws + "すれば", ks + "すれば", ["conditional"]);
        add(ws + "できる", ks + "できる", ["potential"]);
        add(ws + "される", ks + "される", ["passive"]);
        add(ws + "させる", ks + "させる", ["causative"]);
        add(ws + "しよう", ks + "しよう", ["volitional"]);
      } else if (pos.includes("vk")) {
        const kanji = surface.endsWith("来る"),
          ws = surface.slice(0, kanji ? -1 : -2),
          ks = base.reading.slice(0, -2);
        for (const [end, read, label] of [
          ["ます", "きます", "polite"],
          ["ました", "きました", "polite past"],
          ["た", "きた", "past"],
          ["て", "きて", "te-form"],
          ["ない", "こない", "negative"],
          ["なかった", "こなかった", "negative past"],
          ["られる", "こられる", "potential/passive"],
          ["よう", "こよう", "volitional"],
        ])
          add(kanji ? ws + end : ws + read, ks + read, [label]);
      } else if (pos.includes("adj-i") && surface.endsWith("い")) {
        const ws = surface === "いい" ? "よ" : w,
          ks = base.reading === "いい" ? "よ" : k;
        for (const [end, label] of [
          ["かった", "past"],
          ["くない", "negative"],
          ["くなかった", "negative past"],
          ["くて", "te-form"],
          ["ければ", "conditional"],
          ["く", "adverbial"],
        ])
          add(ws + end, ks + end, [label]);
      }
    }
  }
  if (entry.senses.some((s) => s.pos.includes("v5r-i"))) {
    for (const f of output) {
      if (
        f.conjugationSteps[0] === "negative" ||
        f.conjugationSteps[0] === "negative past"
      ) {
        f.surface = f.surface
          .replace(/(?:あら|有ら|在ら)ない$/, "ない")
          .replace(/(?:あら|有ら|在ら)なかった$/, "なかった");
        f.reading = f.reading
          .replace(/あらない$/, "ない")
          .replace(/あらなかった$/, "なかった");
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
          f.conjugationSteps,
        ]),
        f,
      ]),
    ).values(),
  ];
}
