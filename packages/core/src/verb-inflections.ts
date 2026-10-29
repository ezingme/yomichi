/** Dictionary-POS-driven learning paradigms. No spelling-based class inference. */
import { toHiragana } from "./kana.js";
import {
  conjugatePair,
  MORPHOLOGY_POS,
  type MorphologyForm,
} from "./morphology/paradigms.js";

export interface VerbInflectionRow {
  form: string;
  positive: string;
  negative: string;
}
export interface VerbVariant {
  surface: string;
  reading: string;
  register: "standard" | "formal" | "contracted";
  note?: string;
}
export interface VerbInflectionDetail {
  id: string;
  label: string;
  positive: VerbVariant[];
  negative: VerbVariant[];
  availability: "productive" | "context-dependent" | "not-applicable";
  note: string;
  /** Purpose-written teaching example; never claimed to exemplify the queried verb. */
  example?: { word: string; japanese: string; chinese: string };
}
export interface VerbInflectionResult {
  schemaVersion: "2.0";
  word: string;
  reading: string;
  pos: string;
  posCandidates: string[];
  /** Legacy labels and primary surfaces retained for existing clients. */
  forms: VerbInflectionRow[];
  details: VerbInflectionDetail[];
  extensions: VerbInflectionDetail[];
  notesLanguage: "zh";
}
export const VERB_POS: ReadonlySet<string> = new Set(
  MORPHOLOGY_POS.filter((p) => p.startsWith("v")),
);

type Definition = readonly [
  id: string,
  legacy: string,
  label: string,
  positive: string,
  negative: string,
  note: string,
];
const CORE: readonly Definition[] = [
  [
    "nonpast",
    "现在（普通体）",
    "非过去（普通形）",
    "dictionary",
    "negative",
    "辞书形可表示习惯、一般事实或将来。",
  ],
  [
    "nonpast-polite",
    "现在（敬体）",
    "非过去（敬体）",
    "polite",
    "polite negative",
    "礼貌表达，具体时间由语境确定。",
  ],
  [
    "past",
    "过去（普通体）",
    "过去（普通形）",
    "past",
    "negative past",
    "表示过去或完成。",
  ],
  [
    "past-polite",
    "过去（敬体）",
    "过去（敬体）",
    "polite past",
    "polite negative past",
    "过去的礼貌表达。",
  ],
  [
    "te",
    "て形",
    "て形",
    "te-form",
    "negative te-form",
    "ないで表示不做某事的伴随情况；なくて可连接原因或状态，两者不能任意替换。",
  ],
  [
    "volitional",
    "意志形",
    "意志／推量形",
    "volitional",
    "negative volitional",
    "可表示意志、提议或推量，取决于词义与语境；まい偏书面，可表示否定意志或否定推量。",
  ],
  [
    "ba",
    "假定形（ば形）",
    "假定形（ば形）",
    "conditional",
    "negative conditional",
    "假设条件；后句的时态及意志表达受语境限制。",
  ],
  [
    "imperative",
    "命令形",
    "命令／禁止形",
    "imperative",
    "prohibitive",
    "命令形语气强烈；辞书形＋な表示禁止。并非所有词义都适合命令。",
  ],
  [
    "potential",
    "可能形",
    "可能形",
    "potential",
    "negative",
    "表示能力或条件许可；部分状态词及本身含可能意义的词不适用。",
  ],
  [
    "passive",
    "被动形",
    "被动形",
    "passive",
    "negative",
    "被动与可能可同形，但意义和句法不同；也可能涉及尊敬或自发用法。",
  ],
  [
    "causative",
    "使役形",
    "使役形",
    "causative",
    "negative",
    "表示使、让或允许，是否自然取决于词义和参与者。",
  ],
  [
    "causative-passive",
    "使役被动",
    "使役被动形",
    "causative passive",
    "negative",
    "通常表示被迫做某事；五段动词可有缩约形，す结尾除外。",
  ],
];
const EXTENSIONS: readonly Definition[] = [
  [
    "tara",
    "",
    "たら条件形",
    "conditional (~tara)",
    "negative conditional (~tara)",
    "た形＋ら构成条件表达，不一定表示过去。",
  ],
  [
    "desiderative",
    "",
    "愿望表达",
    "desiderative",
    "negative",
    "ます词干＋たい；按い形容词活用。愿望主体及动词词义受语境限制。",
  ],
  [
    "conjectural",
    "",
    "推量表达",
    "conjectural",
    "negative conjectural",
    "普通形＋だろう表示推量，不是单纯动词词尾变化。",
  ],
  [
    "progressive",
    "",
    "进行／结果状态",
    "progressive",
    "progressive negative",
    "ている可表示进行、结果状态或习惯，并非一律译为正在。",
  ],
  [
    "progressive-polite",
    "",
    "进行／结果状态（敬体）",
    "progressive polite",
    "progressive polite negative",
    "ている的礼貌表达，解释仍取决于动词和语境。",
  ],
];
const DERIVATIONS = new Set([
  "potential",
  "passive",
  "causative",
  "causative passive",
]);
// Match spelling AND pronunciation; e.g. 見える/まみえる is a different verb.
const EXCLUDED_POTENTIAL = new Set([
  "ある|ある",
  "有る|ある",
  "在る|ある",
  "要る|いる",
  "分かる|わかる",
  "判る|わかる",
  "解る|わかる",
  "わかる|わかる",
  "見える|みえる",
  "みえる|みえる",
  "聞こえる|きこえる",
  "聞える|きこえる",
  "きこえる|きこえる",
  "できる|できる",
  "出来る|できる",
]);
const EXAMPLE = {
  word: "食べる",
  japanese: "辛いものが食べられる。／ケーキが弟に食べられた。",
  chinese: "能吃辣的东西。／蛋糕被弟弟吃了。",
};

/** Returns null for an unsupported, inconsistent or ambiguous class.
 * Pass one dictionary-derived POS (or options.pos to select among supplied POS).
 * `forms` stays compact; `details` exposes availability and every supported
 * standard variant. Productive does not assert semantic naturalness.
 */
export function generateVerbInflections(
  word: string,
  reading: string,
  sensePropPosTexts: readonly string[],
  options: { pos?: string; lexicalForms?: readonly string[] } = {},
): VerbInflectionResult | null {
  if (!word.trim() || !reading.trim()) return null;
  const posCandidates = [
    ...new Set(
      sensePropPosTexts.map((p) => p.trim()).filter((p) => VERB_POS.has(p)),
    ),
  ];
  const pos =
    options.pos ?? (posCandidates.length === 1 ? posCandidates[0] : undefined);
  if (!pos || !posCandidates.includes(pos)) return null;
  const kana = toHiragana(reading);
  const generated = conjugatePair(word, kana, pos);
  if (!generated.length) return null;
  const select = (step: string, prefix: string[] = []): VerbVariant[] => {
    const seen = new Set<string>();
    return generated
      .filter(
        (f) =>
          f.steps.length === prefix.length + 1 &&
          prefix.every((p, i) => f.steps[i] === p) &&
          f.steps.at(-1) === step,
      )
      .filter((f) => {
        const key = f.surface + "\0" + f.reading;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((f) => ({
        surface: f.surface,
        reading: f.reading,
        register: "standard" as const,
      }));
  };
  const variant = (surface: string, reading: string): VerbVariant => ({
    surface,
    reading,
    register: "standard",
  });
  const build = (def: Definition): VerbInflectionDetail => {
    const [id, , label, pStep, nStep, note] = def;
    let positive =
      pStep === "dictionary" ? [variant(word, kana)] : select(pStep);
    let negative = select(
      nStep,
      DERIVATIONS.has(pStep) || pStep === "desiderative" ? [pStep] : [],
    );
    if (id === "imperative") negative = [variant(word + "な", kana + "な")];
    if (id === "te") {
      negative.sort(
        (a, b) =>
          Number(b.surface.endsWith("ないで")) -
          Number(a.surface.endsWith("ないで")),
      );
      negative = negative.map((v) => ({
        ...v,
        note: v.surface.endsWith("ないで")
          ? "不做某事的伴随情况；也用于ないでください。"
          : "可连接原因或状态；不能任意替换ないで。",
      }));
    }
    if (id === "volitional") {
      const stem = select("continuative")[0];
      if (pos.startsWith("v1") && stem)
        negative.unshift(variant(stem.surface + "まい", stem.reading + "まい"));
      negative = negative.map((v) => ({
        ...v,
        register: "formal",
        note: "偏书面：否定意志或否定推量。",
      }));
    }
    if (id === "causative-passive") {
      positive = positive.map((v, i) => ({
        ...v,
        register: i ? "contracted" : "standard",
      }));
      negative = negative.map((v, i) => ({
        ...v,
        register: i ? "contracted" : "standard",
      }));
    }
    if (id === "conjectural") {
      positive = [variant(word + "だろう", kana + "だろう")];
      negative = select("negative").map((v) =>
        variant(v.surface + "だろう", v.reading + "だろう"),
      );
    }
    const contextual = [
      "volitional",
      "imperative",
      "passive",
      "causative",
      "causative-passive",
      "desiderative",
      "progressive",
      "progressive-polite",
    ].includes(id);
    const detail: VerbInflectionDetail = {
      id,
      label,
      positive,
      negative,
      availability: contextual ? "context-dependent" : "productive",
      note,
    };
    if (!positive.length || !negative.length) {
      detail.availability = "not-applicable";
      detail.note =
        "当前词性规则未提供此形式；这不等于断言它在任何语境都不可用。";
    }
    const aru = pos === "v5r-i";
    const lexemes = [word, ...(options.lexicalForms ?? [])];
    if (
      id === "potential" &&
      (aru || lexemes.some((w) => EXCLUDED_POTENTIAL.has(`${w}|${kana}`)))
    ) {
      detail.positive = [];
      detail.negative = [];
      detail.availability = "not-applicable";
      detail.note =
        "此词不展示常规可能形。不能把按词尾拼出的形式当作标准可能表达；需另选表达并结合词义。";
    }
    if (
      aru &&
      [
        "passive",
        "causative",
        "causative-passive",
        "progressive",
        "progressive-polite",
      ].includes(id)
    ) {
      detail.positive = [];
      detail.negative = [];
      detail.availability = "not-applicable";
      detail.note = "存在义的ある不按普通动作动词展示此表达。";
    }
    if (aru && id === "volitional")
      detail.note =
        "あろう通常是推量，不是主动意志；あるまい也可表示否定推量。";
    if (
      lexemes.some((w) => ["分かる", "判る", "解る", "わかる"].includes(w)) &&
      ["imperative", "passive", "desiderative"].includes(id)
    )
      detail.note +=
        " 分かる的此形式在普通教学用法中不自然或很少用；特殊情感、劝说语境另论。";
    if (id === "potential" || id === "passive") detail.example = EXAMPLE;
    return detail;
  };
  const details = CORE.map(build);
  return {
    schemaVersion: "2.0",
    word,
    reading: kana,
    pos,
    posCandidates,
    forms: details.flatMap((d, i) =>
      d.positive[0] && d.negative[0]
        ? [
            {
              form: CORE[i][1],
              positive: d.positive[0].surface,
              negative: d.negative[0].surface,
            },
          ]
        : [],
    ),
    details,
    extensions: EXTENSIONS.map(build),
    notesLanguage: "zh",
  };
}
