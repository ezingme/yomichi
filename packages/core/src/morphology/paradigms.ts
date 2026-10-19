/** Independently expressed Japanese stem paradigms; no JMdictDB tables bundled.
 * See SOURCES.md for scope and upstream references. Expansion is finite: one
 * derivational layer followed by one inflectional layer (never recursive).
 */
export const MORPHOLOGY_POS = [
  "v1",
  "v1-s",
  "v5u",
  "v5k",
  "v5g",
  "v5s",
  "v5t",
  "v5n",
  "v5b",
  "v5m",
  "v5r",
  "v5k-s",
  "v5u-s",
  "v5r-i",
  "v5aru",
  "vk",
  "vs-i",
  "vs-s",
  "vz",
  "adj-i",
  "adj-ix",
  "cop",
  "cop-da",
] as const;
export interface MorphologyForm {
  surface: string;
  reading: string;
  steps: string[];
  /** Weak standalone stems receive an extra segmentation penalty. */
  weak?: boolean;
}
type Pair = readonly [string, string];
const suffix = (p: Pair, s: string): Pair => [p[0] + s, p[1] + s];
const trim = (p: Pair, n = 1): Pair => [p[0].slice(0, -n), p[1].slice(0, -n)];
interface Verb {
  dictionary: Pair;
  stem: Pair;
  negative: Pair;
  past: Pair;
  te: Pair;
  conditional: Pair;
  volitional: Pair;
  imperative: Pair[];
  classicalNegative?: Pair;
  negativeStem?: Pair;
  derivatives: { pair: Pair; name: string; pos?: string }[];
}
const GODAN: Record<string, readonly string[]> = {
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
function verb(pair: Pair, pos: string): Verb | undefined {
  const [w, k] = pair,
    root = trim(pair);
  const derivatives: Verb["derivatives"] = [];
  const derive = (p: Pair, name: string, pos = "v1") =>
    derivatives.push({ pair: p, name, pos });
  if (
    (pos === "v1" || pos === "v1-s") &&
    k.endsWith("る") &&
    w.endsWith("る")
  ) {
    derive(suffix(root, "られる"), "potential");
    derive(suffix(root, "られる"), "passive");
    derive(suffix(root, "させる"), "causative");
    derive(suffix(root, "させられる"), "causative passive");
    return {
      dictionary: pair,
      stem: root,
      negative: suffix(root, "ない"),
      past: suffix(root, "た"),
      te: suffix(root, "て"),
      conditional: suffix(root, "れば"),
      volitional: suffix(root, "よう"),
      imperative:
        pos === "v1-s" ? [root] : [suffix(root, "ろ"), suffix(root, "よ")],
      derivatives,
    };
  }
  if (
    pos.startsWith("v5") &&
    GODAN[k.slice(-1)] &&
    w.slice(-1) === k.slice(-1)
  ) {
    const [a, i, e, o, te, past] = GODAN[k.slice(-1)];
    const aru = pos === "v5r-i";
    // ある loses its whole final lexeme in the negative, including kanji 有/在.
    const neg: Pair = aru
      ? [w.replace(/(?:ある|有る|在る)$/u, ""), k.slice(0, -2)]
      : suffix(root, a);
    derive(suffix(root, e + "る"), "potential");
    derive(suffix(root, a + "れる"), "passive");
    derive(suffix(root, a + "せる"), "causative");
    derive(suffix(root, a + "せられる"), "causative passive");
    derive(suffix(root, a + "す"), "causative (~su)", "v5s");
    if (k.slice(-1) !== "す")
      derive(suffix(root, a + "される"), "causative passive");
    return {
      dictionary: pair,
      stem: suffix(root, pos === "v5aru" ? "い" : i),
      negative: suffix(neg, "ない"),
      negativeStem: aru ? undefined : suffix(root, a),
      classicalNegative: suffix(root, a),
      past: suffix(
        root,
        pos === "v5k-s" ? "った" : pos === "v5u-s" ? "うた" : past,
      ),
      te: suffix(
        root,
        pos === "v5k-s" ? "って" : pos === "v5u-s" ? "うて" : te,
      ),
      conditional: suffix(root, e + "ば"),
      volitional: suffix(root, o + "う"),
      imperative: [suffix(root, pos === "v5aru" ? "い" : e)],
      derivatives,
    };
  }
  if (
    pos === "vk" &&
    k.endsWith("くる") &&
    (w.endsWith("くる") || /[来來]る$/u.test(w))
  ) {
    const kanji = /[来來]る$/u.test(w);
    const p: Pair = [w.slice(0, kanji ? -1 : -2), k.slice(0, -2)];
    const make = (s: string, r: string): Pair => [
      p[0] + (kanji ? s : r),
      p[1] + r,
    ];
    derive(make("られる", "こられる"), "potential");
    derive(make("られる", "こられる"), "passive");
    derive(make("させる", "こさせる"), "causative");
    derive(make("させられる", "こさせられる"), "causative passive");
    return {
      dictionary: pair,
      stem: make("", "き"),
      negative: make("ない", "こない"),
      past: make("た", "きた"),
      te: make("て", "きて"),
      conditional: make("れば", "くれば"),
      volitional: make("よう", "こよう"),
      imperative: [make("い", "こい")],
      derivatives,
    };
  }
  if (
    (pos === "vs-i" || pos === "vs-s" || pos === "vz") &&
    (k.endsWith("する") || (pos === "vz" && k.endsWith("ずる")))
  ) {
    const z = pos === "vz",
      end = z ? "ずる" : "する";
    // Kana endings also work after arbitrary mixed-script prefixes (勉強する).
    const kanji = !z && w.endsWith("為る");
    if (!w.endsWith(end) && !kanji) return undefined;
    const p = trim(pair, 2),
      si = z ? "じ" : "し",
      se = z ? "ぜ" : "せ",
      sa = z ? "じら" : "さ";
    const make = (s: string): Pair => [
      kanji ? w.slice(0, -1) + s.slice(1) : p[0] + s,
      p[1] + s,
    ];
    if (pos === "vs-i" && !kanji) derive(suffix(p, "できる"), "potential");
    if (z) derive(suffix(p, "じられる"), "potential");
    derive(make(sa + "れる"), "passive");
    derive(make((z ? "じさ" : "さ") + "せる"), "causative");
    derive(make((z ? "じさ" : "さ") + "せられる"), "causative passive");
    return {
      dictionary: pair,
      stem: make(si),
      negative: make((pos === "vs-s" ? "さ" : si) + "ない"),
      classicalNegative: make(se),
      past: make(si + "た"),
      te: make(si + "て"),
      conditional: make((z ? "ず" : "す") + "れば"),
      volitional: make(si + "よう"),
      imperative: [make(si + "ろ"), make(se + "よ")],
      derivatives,
    };
  }
}

/** Expand a single surface/reading pair for a single restricted POS. */
export function conjugatePair(
  surface: string,
  reading: string,
  pos: string,
): MorphologyForm[] {
  const out: MorphologyForm[] = [],
    pair: Pair = [surface, reading];
  const add = (p: Pair, label: string, prefix: string[] = [], weak = false) => {
    if (p[0] && p[1])
      out.push({
        surface: p[0],
        reading: p[1],
        steps: [...prefix, label],
        ...(weak ? { weak: true } : {}),
      });
  };
  function adjective(
    p: Pair,
    prefix: string[] = [],
    exceptional = false,
    derived = false,
  ) {
    const regular = trim(p);
    const root: Pair = exceptional
      ? [
          p[0].endsWith("いい") ? p[0].slice(0, -2) + "よ" : regular[0],
          p[1].endsWith("いい") ? p[1].slice(0, -2) + "よ" : regular[1],
        ]
      : regular;
    for (const [s, label] of [
      ["かった", "past"],
      ["かったら", "conditional (~tara)"],
      ["かったり", "alternative (~tari)"],
      ["かったです", "polite past"],
      ["くない", "negative"],
      ["くなかった", "negative past"],
      ["くないです", "polite negative"],
      ["くなかったです", "polite negative past"],
      ["くありません", "polite negative"],
      ["くありませんでした", "polite negative past"],
      ["くなくて", "negative te-form"],
      ["くなければ", "negative conditional"],
      ["くなかったら", "negative conditional (~tara)"],
      ["くなかったり", "negative alternative (~tari)"],
      ["くて", "te-form"],
      ["ければ", "conditional"],
      ["かろう", "volitional"],
      ["く", "adverbial"],
    ])
      add(suffix(root, s), label, prefix);
    add(suffix(p, "です"), "polite", prefix);
    add(suffix(p, "でしょう"), "polite conjectural", prefix);
    if (!derived) {
      add(root, "adjective stem", prefix, true);
      add(suffix(root, "き"), "literary", prefix, true);
      const causative = suffix(root, "くさせる");
      add(causative, "causative", prefix);
      const v = verb(causative, "v1");
      if (v) inflect(v, [...prefix, "causative"], false);
    }
  }
  function inflect(v: Verb, prefix: string[] = [], productive = true) {
    const put = (p: Pair, label: string, weak = false) =>
      add(p, label, prefix, weak);
    put(v.stem, "continuative", true);
    put(v.past, "past");
    put(v.te, "te-form");
    put(v.conditional, "conditional");
    put(v.volitional, "volitional");
    for (const p of v.imperative) put(p, "imperative");
    put(suffix(v.stem, "なさい"), "polite imperative");
    put(suffix(v.dictionary, "まい"), "negative volitional", true);
    put(suffix(v.stem, "ますまい"), "polite negative volitional", true);
    for (const [s, label] of [
      ["ます", "polite"],
      ["ました", "polite past"],
      ["ません", "polite negative"],
      ["ませんでした", "polite negative past"],
      ["ましょう", "polite volitional"],
      ["まして", "polite te-form"],
      ["ますれば", "polite conditional"],
      ["ましたら", "polite conditional (~tara)"],
      ["ましたり", "polite alternative (~tari)"],
      ["ませんでしたら", "polite negative conditional (~tara)"],
      ["ませんでしたり", "polite negative alternative (~tari)"],
    ])
      put(suffix(v.stem, s), label);
    put(suffix(v.past, "ら"), "conditional (~tara)");
    put(suffix(v.past, "り"), "alternative (~tari)");
    put(v.negative, "negative");
    const negroot = trim(v.negative, 2);
    for (const [s, label] of [
      ["なかった", "negative past"],
      ["なくて", "negative te-form"],
      ["ないで", "negative te-form"],
      ["なければ", "negative conditional"],
      ["なかったら", "negative conditional (~tara)"],
      ["なかったり", "negative alternative (~tari)"],
      ["なく", "negative continuative"],
    ])
      put(suffix(negroot, s), label);
    for (const [s, label] of [
      ["ず", "negative classical"],
      ["ぬ", "negative classical"],
    ])
      put(suffix(v.classicalNegative ?? negroot, s), label);
    if (v.negativeStem) put(v.negativeStem, "negative stem", true);
    // Productive auxiliary forms are deliberately restricted to the base layer.
    if (productive) {
      const tai = suffix(v.stem, "たい");
      put(tai, "desiderative");
      adjective(tai, [...prefix, "desiderative"], false, true);
      for (const [s, label] of [
        ["いる", "progressive"],
        ["いた", "progressive past"],
        ["います", "progressive polite"],
        ["いました", "progressive polite past"],
        ["いない", "progressive negative"],
        ["いなかった", "progressive negative past"],
        ["いません", "progressive polite negative"],
        ["いませんでした", "progressive polite negative past"],
        ["いれば", "progressive conditional"],
        ["れば", "progressive contracted conditional"],
        ["る", "progressive contracted"],
        ["た", "progressive contracted past"],
      ]) {
        put(suffix(v.te, s), label);
      }
      for (const d of v.derivatives) {
        put(d.pair, d.name, d.name === "causative (~su)");
        const next = verb(d.pair, d.pos ?? "v1");
        if (next) inflect(next, [...prefix, d.name], false);
      }
    }
  }
  const v = verb(pair, pos);
  if (v) {
    inflect(v);
    if (pos === "v5aru")
      add(suffix(trim(pair), "り"), "continuative", [], true);
  } else if (
    (pos === "adj-i" || pos === "adj-ix") &&
    surface.endsWith("い") &&
    reading.endsWith("い")
  ) {
    adjective(pair, [], pos === "adj-ix" || reading === "いい");
  } else if (
    (pos === "cop" || pos === "cop-da") &&
    surface === "だ" &&
    reading === "だ"
  ) {
    for (const [s, label] of [
      ["です", "polite"],
      ["だった", "past"],
      ["でした", "polite past"],
      ["で", "te-form"],
      ["なら", "conditional"],
      ["ならば", "conditional"],
      ["であれば", "conditional"],
      ["だったら", "conditional (~tara)"],
      ["でしたら", "polite conditional (~tara)"],
      ["だったり", "alternative (~tari)"],
      ["だろう", "volitional"],
      ["でしょう", "polite volitional"],
    ])
      add([s, s], label);
    for (const p of ["では", "じゃ"])
      for (const [s, label] of [
        ["ない", "negative"],
        ["なかった", "negative past"],
        ["ありません", "polite negative"],
        ["ありませんでした", "polite negative past"],
        ["ないです", "polite negative"],
        ["なかったです", "polite negative past"],
        ["なくて", "negative te-form"],
        ["なければ", "negative conditional"],
        ["なかったら", "negative conditional (~tara)"],
        ["なかったり", "negative alternative (~tari)"],
      ])
        add([p + s, p + s], label);
  }
  return out;
}
