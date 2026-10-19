import { conjugatePair } from "./morphology/paradigms.js";
import type { Token } from "./types.js";

/** Productive grammatical suffixes, expressed independently as stem constraints.
 * These are grammar rules, not dictionary entries: synthetic suffix components
 * have no entry ID or gloss. A derivation is bounded to three suffix layers. */
interface Rule {
  name: string;
  root: "te" | "stem" | "adjective" | "suru" | "noun";
  word: string;
  pos: string;
  contract?: boolean;
}
const rules: Rule[] = [
  ...[
    ["いる", "v1", "progressive"],
    ["ある", "v5r-i", "resultative"],
    ["おく", "v5k", "preparative"],
    ["しまう", "v5u", "completion"],
    ["いく", "v5k-s", "continuation"],
    ["くる", "vk", "toward speaker"],
    ["みる", "v1", "attempt"],
    ["あげる", "v1", "benefactive"],
    ["くれる", "v1-s", "benefactive"],
    ["もらう", "v5u", "benefactive"],
    ["いただく", "v5k", "humble benefactive"],
    ["くださる", "v5aru", "honorific benefactive"],
    ["ほしい", "adj-i", "request"],
  ].map(([word, pos, name]) => ({ word, pos, name, root: "te" as const })),
  ...[
    ["たい", "adj-i", "desiderative"],
    ["たがる", "v5r", "apparent desire"],
    ["やすい", "adj-i", "easy to"],
    ["にくい", "adj-i", "difficult to"],
    ["づらい", "adj-i", "difficult to"],
    ["すぎる", "v1", "excessive"],
    ["ながら", "", "simultaneous"],
    ["そう", "", "appearance"],
  ].map(([word, pos, name]) => ({ word, pos, name, root: "stem" as const })),
  { word: "すぎる", pos: "v1", name: "excessive", root: "adjective" },
  { word: "さ", pos: "", name: "nominalization", root: "adjective" },
  { word: "そう", pos: "", name: "appearance", root: "adjective" },
  { word: "する", pos: "vs-i", name: "suru compound", root: "suru" },
  ...[
    ["たち", "plural"],
    ["ら", "plural"],
    ["さん", "honorific"],
    ["様", "honorific"],
  ].map(([word, name]) => ({ word, pos: "", name, root: "noun" as const })),
  { word: "る", pos: "v1", name: "contracted progressive", root: "te" },
  {
    word: "ちゃう",
    pos: "v5u",
    name: "contracted completion",
    root: "te",
    contract: true,
  },
  {
    word: "じゃう",
    pos: "v5u",
    name: "contracted completion",
    root: "te",
    contract: true,
  },
];
const expanded = rules.map((rule) => ({
  rule,
  forms: [
    {
      surface: rule.word,
      reading: rule.word === "様" ? "さま" : rule.word,
      steps: [] as string[],
    },
    ...conjugatePair(rule.word, rule.word, rule.pos),
  ],
}));
function eligible(t: Token, r: Rule) {
  const last = t.conjugationSteps.at(-1) ?? "";
  if (r.root === "te")
    return (
      last === "te-form" ||
      last === "negative te-form" ||
      last === "polite te-form"
    );
  if (r.root === "stem") return last === "continuative";
  if (r.root === "adjective") return last === "adjective stem";
  if (r.root === "suru")
    return t.pos.includes("vs") && !t.conjugationSteps.length;
  return (
    t.pos.some((p) => p === "n" || p.startsWith("n-") || p === "pn") &&
    !t.conjugationSteps.length
  );
}
export function grammarExtensions(root: Token, text: string): Token[] {
  if (!root.reading || root.kind !== "word") return [];
  const result: Token[] = [];
  for (const { rule, forms } of expanded) {
    if (!eligible(root, rule)) continue;
    let join = root.end,
      reading = root.reading;
    if (rule.contract) {
      const ending = root.surface.at(-1);
      if (
        (rule.word === "ちゃう" && ending !== "て") ||
        (rule.word === "じゃう" && ending !== "で")
      )
        continue;
      join--;
      reading = reading.slice(0, -1);
    }
    for (const f of forms) {
      if (!f.surface || !text.startsWith(f.surface, join)) continue;
      const end = join + f.surface.length;
      if (end <= root.end) continue;
      const suffix: Token = {
        surface: f.surface,
        start: join,
        end,
        kind: "word",
        lemma: rule.word,
        reading: f.reading,
        romanization: null,
        entryId: null,
        pos: rule.pos ? [rule.pos] : ["suf"],
        senses: [],
        senseIndices: [],
        conjugationSteps: [rule.name, ...f.steps],
        components: [],
        alternatives: [],
      };
      // Contracted connector belongs to the suffix, keeping component spans disjoint.
      const primary = rule.contract
        ? { ...root, surface: text.slice(root.start, join), end: join, reading }
        : root;
      result.push({
        ...root,
        surface: text.slice(root.start, end),
        end,
        reading: reading + f.reading,
        conjugationSteps: [...root.conjugationSteps, rule.name, ...f.steps],
        components: [primary, suffix],
        alternatives: [],
      });
    }
  }
  // Polite adjective predicate; inflection already belongs to the adjective.
  if (
    root.pos.some((p) => p.startsWith("adj-")) &&
    !root.conjugationSteps.includes("polite predicate") &&
    text.startsWith("です", root.end)
  ) {
    const suffix: Token = {
      ...root,
      surface: "です",
      start: root.end,
      end: root.end + 2,
      lemma: "です",
      reading: "です",
      entryId: null,
      pos: ["cop"],
      senseIndices: [],
      senses: [],
      conjugationSteps: ["polite predicate"],
      components: [],
      alternatives: [],
    };
    result.push({
      ...root,
      surface: root.surface + "です",
      end: root.end + 2,
      reading: root.reading + "です",
      conjugationSteps: [...root.conjugationSteps, "polite predicate"],
      components: [root, suffix],
      alternatives: [],
    });
  }
  return result;
}
/** Small explicit contextual preferences; scores are ranking weights, not probabilities. */
export function connectionScore(
  previous: Token | undefined,
  current: Token,
): number {
  if (
    !previous ||
    previous.kind === "separator" ||
    current.kind === "separator"
  )
    return 0;
  if (previous.kind === "unknown" || current.kind === "unknown") return -1;
  const prevParticle = previous.pos.includes("prt"),
    particle = current.pos.includes("prt");
  let score = 0;
  if (particle && previous.kind === "word") score += 1.5;
  if (prevParticle && particle) score -= 2;
  if (
    previous.pos.some((p) => p === "pref" || p === "n-pref") &&
    current.pos.some((p) => p === "n" || p.startsWith("n-"))
  )
    score += 4;
  if (
    current.pos.some((p) => p === "suf" || p === "n-suf") &&
    previous.pos.some((p) => p === "n" || p.startsWith("n-"))
  )
    score += 3;
  if (
    previous.conjugationSteps.at(-1) === "continuative" &&
    !current.pos.some((p) => p.startsWith("v") || p.startsWith("aux"))
  )
    score -= 5;
  return score;
}
