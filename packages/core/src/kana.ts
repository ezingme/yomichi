/** Romanization modes adapted from Ichiran romanize.lisp / deromanize.lisp,
 * Copyright Timofei Shatrov, MIT. WanaKana supplies the base kana table. */
import { toRomaji } from "wanakana";
import { normalizeJapanese, expandIterationMarks } from "./characters.js";
export type RomanizationScheme =
  | "hepburn"
  | "kunrei"
  | "hepburn-basic"
  | "hepburn-simple"
  | "hepburn-passport"
  | "hepburn-traditional"
  | "hepburn-modified"
  | "kunrei-shiki";
export function toHiragana(text: string): string {
  return normalizeJapanese(text).replace(/[ァ-ヶヽヾ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0x60),
  );
}
export function toKatakana(text: string): string {
  return normalizeJapanese(text).replace(/[ぁ-ゖゝゞ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) + 0x60),
  );
}
/** Legacy hepburn/kunrei preserve orthographic long vowels for compatibility.
 * Explicit named modes implement upstream long-vowel simplification rules. */
export function romanizeKana(
  text: string,
  scheme: RomanizationScheme = "hepburn",
): string {
  const normalized = expandIterationMarks(normalizeJapanese(text));
  return normalized.replace(/[ぁ-ゖァ-ヶー]+/g, (chunk) => {
    const explicit = scheme !== "hepburn" && scheme !== "kunrei";
    if (explicit && chunk === "っ") return "!";
    if (explicit && chunk === "ー") return "~";
    let result = toRomaji(explicit ? chunk.replace(/ー/g, "") : chunk, {
      customRomajiMapping: {
        を: "wo",
        ゐ: "wi",
        ゑ: "we",
        ゔぁ: "va",
        ゔぃ: "vi",
        ゔぇ: "ve",
        ゔぉ: "vo",
        ゔゅ: "vyu",
      },
    });
    if (scheme === "kunrei" || scheme === "kunrei-shiki")
      result = result
        .replace(/sha/g, "sya")
        .replace(/shu/g, "syu")
        .replace(/sho/g, "syo")
        .replace(/cha/g, "tya")
        .replace(/chu/g, "tyu")
        .replace(/cho/g, "tyo")
        .replace(/shi/g, "si")
        .replace(/chi/g, "ti")
        .replace(/tsu/g, "tu")
        .replace(/fu/g, "hu")
        .replace(/ji/g, "zi")
        .replace(/ja/g, "zya")
        .replace(/ju/g, "zyu")
        .replace(/jo/g, "zyo")
        .replace(/tch/g, "tt")
        .replace(/wi/g, "i")
        .replace(/we/g, "e")
        .replace(/wo/g, "o");
    const mode = scheme.replace("hepburn-", "");
    const replacements: Record<string, string> =
      mode === "simple"
        ? { oo: "o", ou: "o", uu: "u" }
        : mode === "passport"
          ? { oo: "oh", ou: "oh", uu: "u" }
          : mode === "traditional" || mode === "modified"
            ? {
                oo: "ō",
                ou: "ō",
                uu: "ū",
                ...(mode === "modified" ? { aa: "ā", ee: "ē" } : {}),
              }
            : mode === "kunrei-shiki"
              ? { oo: "ô", ou: "ô", uu: "û" }
              : {};
    result = result.replace(/oo|ou|uu|aa|ee/g, (s) => replacements[s] ?? s);
    if (mode === "traditional")
      result = result
        .replace(/n'(?=[aeiouy])/g, "n-")
        .replace(/n(?=[mbp])/g, "m");
    if (mode === "modified") result = result.replace(/wo/g, "o");
    return result;
  });
}
export interface KanaRepresentation {
  canonical: string;
  pattern: string;
  hiragana: string[];
  katakana: string[];
}
/** Ichiran data/romaji-map.csv, copyright Timofei Shatrov, MIT.
 * The complete table is embedded so production requires no Lisp/Python runtime.
 * Tab column 3 is input carried forward after consuming column 1. */
const ROMAJI_RULES_TEXT = `a	あ
ba	ば
bb	っ	b
be	べ
bi	び
bo	ぼ
bu	ぶ
bya	びゃ
bye	びぇ
byi	びぃ
byo	びょ
byu	びゅ
ca	か
cc	っ	c
ce	せ
cha	ちゃ
che	ちぇ
chi	ち
cho	ちょ
chu	ちゅ
ci	し
co	こ
cu	く
cya	ちゃ
cye	ちぇ
cyi	ちぃ
cyo	ちょ
cyu	ちゅ
da	だ
dd	っ	d
de	で
dha	でゃ
dhe	でぇ
dhi	でぃ
dho	でょ
dhu	でゅ
di	ぢ
d'i	でぃ
do	ど
du	づ
d'u	どぅ
dwa	どぁ
dwe	どぇ
dwi	どぃ
dwo	どぉ
dwu	どぅ
dya	ぢゃ
dye	ぢぇ
dyi	ぢぃ
dyo	ぢょ
dyu	ぢゅ
d'yu	でゅ
e	え
fa	ふぁ
fe	ふぇ
ff	っ	f
fi	ふぃ
fo	ふぉ
fu	ふ
fu	ふ
fya	ふゃ
fyo	ふょ
fyu	ふゅ
ga	が
ge	げ
gg	っ	g
gi	ぎ
go	ご
gu	ぐ
gwa	ぐぁ
gwe	ぐぇ
gwi	ぐぃ
gwo	ぐぉ
gwu	ぐぅ
gya	ぎゃ
gye	ぎぇ
gyi	ぎぃ
gyo	ぎょ
gyu	ぎゅ
ha	は
he	へ
hh	っ	h
hi	ひ
ho	ほ
hu	ふ
hwa	ふぁ
hwe	ふぇ
hwi	ふぃ
hwo	ふぉ
hwyu	ふゅ
hya	ひゃ
hye	ひぇ
hyi	ひぃ
hyo	ひょ
hyu	ひゅ
i	い
ja	じゃ
je	じぇ
ji	じ
jj	っ	j
jo	じょ
ju	じゅ
jya	じゃ
jye	じぇ
jyi	じぃ
jyo	じょ
jyu	じゅ
ka	か
ke	け
ki	き
kk	っ	k
ko	こ
ku	く
kwa	くぁ
kwe	くぇ
kwi	くぃ
kwo	くぉ
kwu	くぅ
kya	きゃ
kye	きぇ
kyi	きぃ
kyo	きょ
kyu	きゅ
la	ら
le	れ
li	り
lo	ろ
ll	っ	r
lu	る
lya	りゃ
lye	りぇ
lyi	りぃ
lyo	りょ
lyu	りゅ
ma	ま
me	め
mi	み
mm	ん	m
mb	ん	b
mp	ん	p
mo	も
mu	む
mya	みゃ
mye	みぇ
myi	みぃ
myo	みょ
myu	みゅ
n	ん
n'	ん
n-	ん
na	な
ne	ね
ni	に
no	の
nu	ぬ
nya	にゃ
nye	にぇ
nyi	にぃ
nyo	にょ
nyu	にゅ
o	お
pa	ぱ
pe	ぺ
pi	ぴ
po	ぽ
pp	っ	p
pu	ぷ
pya	ぴゃ
pye	ぴぇ
pyi	ぴぃ
pyo	ぴょ
pyu	ぴゅ
qa	くぁ
qe	くぇ
qi	くぃ
qo	くぉ
qq	っ	q
qu	く
ra	ら
re	れ
ri	り
ro	ろ
rr	っ	r
ru	る
rya	りゃ
rye	りぇ
ryi	りぃ
ryo	りょ
ryu	りゅ
sa	さ
se	せ
sha	しゃ
she	しぇ
shi	し
sho	しょ
shu	しゅ
si	し
so	そ
ss	っ	s
su	す
sya	しゃ
sye	しぇ
syi	しぃ
syo	しょ
syu	しゅ
ta	た
te	て
tha	てゃ
the	てぇ
thi	てぃ
tho	てょ
thu	てゅ
ti	ち
t'i	てぃ
to	と
tsa	つぁ
tse	つぇ
tsi	つぃ
tso	つぉ
tsu	つ
tt	っ	t
tu	つ
t'u	とぅ
twa	とぁ
twe	とぇ
twi	とぃ
two	とぉ
twu	とぅ
tya	ちゃ
tye	ちぇ
tyi	ちぃ
tyo	ちょ
tyu	ちゅ
t'yu	てゅ
u	う
va	ゔぁ
ve	ゔぇ
vi	ゔぃ
vo	ゔぉ
vu	ゔ
vv	っ	v
vya	ゔゃ
vye	ゔぇ
vyi	ゔぃ
vyo	ゔょ
vyu	ゔゅ
wa	わ
we	うぇ
wha	うぁ
whe	うぇ
whi	うぃ
who	うぉ
whu	う
wi	うぃ
wo	を
wu	う
ww	っ	w
wye	ゑ
wyi	ゐ
xa	ぁ
xe	ぇ
xi	ぃ
xka	ヵ
xke	ヶ
xn	ん
xo	ぉ
xtsu	っ
xtu	っ
xu	ぅ
xwa	ゎ
xx	っ	x
xya	ゃ
xye	ぇ
xyi	ぃ
xyo	ょ
xyu	ゅ
ya	や
ye	いぇ
yo	よ
yu	ゆ
yy	っ	y
za	ざ
ze	ぜ
zi	じ
zo	ぞ
zu	ず
zya	じゃ
zye	じぇ
zyi	じぃ
zyo	じょ
zyu	じゅ
zz	っ	z
-	ー`;
interface RomajiRule {
  text: string;
  kana: string;
  carry: string;
}
const romajiRules: RomajiRule[] = [
  ...new Map(
    ROMAJI_RULES_TEXT.split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [text, kana, carry = ""] = line.split("\t");
        return [text, { text, kana, carry }] as const;
      }),
  ).values(),
];
interface ReverseBranch {
  canonical: string;
  tokens: string[];
  variants: string[];
}
function normalizeRomaji(text: string): string | null {
  const normalized = text
    .toLowerCase()
    .replace(/[ōô]/g, "ou")
    .replace(/[ūû]/g, "uu")
    .replace(/ā/g, "aa")
    .replace(/ē/g, "ee")
    .replace(/ī/g, "ii");
  return normalized.length > 0 &&
    normalized.length <= 500 &&
    /^[a-z'-]+$/.test(normalized)
    ? normalized
    : null;
}
function mergeBranches(
  a: ReverseBranch,
  b: ReverseBranch,
  limit: number,
): ReverseBranch {
  let prefix = 0;
  while (
    prefix < Math.min(a.tokens.length, b.tokens.length) &&
    a.tokens[prefix] === b.tokens[prefix]
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < Math.min(a.tokens.length, b.tokens.length) - prefix &&
    a.tokens[a.tokens.length - 1 - suffix] ===
      b.tokens[b.tokens.length - 1 - suffix]
  )
    suffix++;
  const middleA = a.tokens.slice(prefix, a.tokens.length - suffix).join(""),
    middleB = b.tokens.slice(prefix, b.tokens.length - suffix).join("");
  const tokens =
    middleA === middleB
      ? a.tokens
      : [
          ...a.tokens.slice(0, prefix),
          "(?:" + middleA + "|" + middleB + ")",
          ...(suffix ? a.tokens.slice(-suffix) : []),
        ];
  const canonical =
    a.canonical.length <= b.canonical.length ? a.canonical : b.canonical;
  return {
    canonical,
    tokens,
    variants: [...new Set([canonical, ...a.variants, ...b.variants])].slice(
      0,
      limit,
    ),
  };
}
function applyRule(
  branch: ReverseBranch,
  rule: RomajiRule,
  limit: number,
): ReverseBranch {
  const long = /[ou]$/.test(rule.text);
  return {
    canonical: branch.canonical + rule.kana,
    tokens: [...branch.tokens, rule.kana + (long ? "う?" : "")],
    variants: branch.variants
      .flatMap((v) =>
        long ? [v + rule.kana, v + rule.kana + "う"] : [v + rule.kana],
      )
      .slice(0, limit),
  };
}
function reverseRomaji(
  text: string,
  partial: boolean,
  limit: number,
): KanaRepresentation | null {
  const input = normalizeRomaji(text);
  if (input === null) return null;
  const pending = new Map<string, ReverseBranch>([
    [input, { canonical: "", tokens: [], variants: [""] }],
  ]);
  let finished: ReverseBranch | undefined;
  const add = (rest: string, branch: ReverseBranch) => {
    if (!rest) {
      finished = finished ? mergeBranches(finished, branch, limit) : branch;
      return;
    }
    const old = pending.get(rest);
    pending.set(rest, old ? mergeBranches(old, branch, limit) : branch);
  };
  // Process the longest remaining input first: all paths converging on a suffix
  // merge before that suffix is expanded. No exponential list of parse paths.
  while (pending.size) {
    let rest = "";
    for (const key of pending.keys()) if (key.length > rest.length) rest = key;
    const branch = pending.get(rest)!;
    pending.delete(rest);
    for (const rule of romajiRules) {
      if (rest.startsWith(rule.text)) {
        add(
          rule.carry + rest.slice(rule.text.length),
          applyRule(branch, rule, limit),
        );
      }
    }
    if (partial)
      for (const rule of romajiRules) {
        if (!rule.carry && rule.text.startsWith(rest))
          add("", applyRule(branch, rule, limit));
      }
  }
  if (!finished) return null;
  const hiragana = [
    ...new Set([finished.canonical, ...finished.variants]),
  ].slice(0, limit);
  return {
    canonical: finished.canonical,
    pattern: "^" + finished.tokens.join("") + "$",
    hiragana,
    katakana: hiragana.map(toKatakana),
  };
}
/** Complete upstream mapping and carry rules, retaining alternative parses in
 * the regex. Concrete kana examples are bounded; the pattern is not truncated.
 * Long-vowel optionality is Ichiran's search heuristic, not a reading guarantee. */
export function deromanize(text: string): KanaRepresentation | null {
  return reverseRomaji(text, false, 32);
}
/** Complete an unfinished final romaji syllable. Results are kana expansions,
 * never invented dictionary matches. Invalid input returns null. */
export function partialSuggestions(
  text: string,
  limit = 32,
): KanaRepresentation | null {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new RangeError("limit must be between 1 and 100");
  return reverseRomaji(text, true, limit);
}
