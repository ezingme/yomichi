import { test } from "node:test";
import assert from "node:assert/strict";
import { generateForms } from "../packages/core/src/conjugation.js";
import { entry } from "./helpers.js";

function forms(word: string, reading: string, pos: string) {
  return generateForms(entry("synthetic", word, reading, pos));
}
function includes(
  word: string,
  reading: string,
  pos: string,
  expected: string[],
  absent: string[] = [],
) {
  const result = forms(word, reading, pos);
  for (const surface of expected)
    assert.ok(
      result.some((f) => f.surface === surface),
      `${word}/${pos}: missing ${surface}`,
    );
  for (const surface of absent)
    assert.ok(
      !result.some((f) => f.surface === surface),
      `${word}/${pos}: false ${surface}`,
    );
  assert.ok(result.length < 1200, "bounded morphology per spelling/reading");
}
test("regular verb paradigms include negative/polite tara/tari and continuative forms", () => {
  includes("食べる", "たべる", "v1", [
    "食べ",
    "食べたら",
    "食べたり",
    "食べなかったら",
    "食べませんでしたら",
    "食べなくて",
    "食べず",
    "食べぬ",
    "食べなければ",
    "食べられなかったら",
    "食べさせられませんでした",
  ]);
  includes(
    "買う",
    "かう",
    "v5u",
    [
      "買い",
      "買ったら",
      "買ったり",
      "買わなかったら",
      "買わせられた",
      "買わされた",
    ],
    ["買うなかったら"],
  );
});
test("all godan rows retain correct te allomorphs and readings", () => {
  for (const [w, k, p, t] of [
    ["書く", "かく", "v5k", "書いて"],
    ["泳ぐ", "およぐ", "v5g", "泳いで"],
    ["話す", "はなす", "v5s", "話して"],
    ["待つ", "まつ", "v5t", "待って"],
    ["死ぬ", "しぬ", "v5n", "死んで"],
    ["遊ぶ", "あそぶ", "v5b", "遊んで"],
    ["読む", "よむ", "v5m", "読んで"],
    ["帰る", "かえる", "v5r", "帰って"],
  ])
    includes(w, k, p, [t]);
});
test("kuru irregular readings survive all secondary transformations", () => {
  includes(
    "来る",
    "くる",
    "vk",
    [
      "来れば",
      "来い",
      "来ませんでした",
      "来られなかった",
      "来させられた",
      "来たら",
    ],
    ["来ろ", "来れる"],
  );
  const result = forms("来る", "くる", "vk");
  for (const [w, k] of [
    ["来れば", "くれば"],
    ["来い", "こい"],
    ["来させられた", "こさせられた"],
    ["来ました", "きました"],
  ])
    assert.ok(result.some((f) => f.surface === w && f.reading === k));
  includes("くる", "くる", "vk", [
    "くれば",
    "こい",
    "きました",
    "こさせられた",
  ]);
});
test("suru and special suru do not produce false ichidan forms", () => {
  includes(
    "する",
    "する",
    "vs-i",
    [
      "すれば",
      "しろ",
      "せよ",
      "しよう",
      "しなかったら",
      "せず",
      "されませんでした",
      "させられた",
      "できなかった",
    ],
    ["しれば", "しられる"],
  );
  includes(
    "愛する",
    "あいする",
    "vs-s",
    ["愛すれば", "愛せよ", "愛さない", "愛される"],
    ["愛できる", "愛しられる"],
  );
});
test("exceptional ichidan and godan classes are distinct", () => {
  includes(
    "くれる",
    "くれる",
    "v1-s",
    ["くれ", "くれたら", "くれません"],
    ["くれろ"],
  );
  includes(
    "下さる",
    "くださる",
    "v5aru",
    ["下さい", "下さいます", "下さり", "下さった"],
    ["下さります"],
  );
  includes("行く", "いく", "v5k-s", ["行ったら", "行って"], ["行いて"]);
  includes("問う", "とう", "v5u-s", ["問うたら", "問うて"], ["問った"]);
  includes(
    "ある",
    "ある",
    "v5r-i",
    ["ない", "なかったら", "なくて", "ありません"],
    ["あらない", "あらなかったら"],
  );
});
test("good adjective allomorphs apply within compounds and preserve kanji", () => {
  includes(
    "いい",
    "いい",
    "adj-ix",
    ["よかった", "よくない", "よければ", "よき"],
    ["いかった"],
  );
  includes(
    "かっこいい",
    "かっこいい",
    "adj-ix",
    ["かっこよかった", "かっこよくない"],
    ["かっこいかった"],
  );
  includes("良い", "いい", "adj-ix", ["良かった", "良くない"]);
  assert.ok(
    forms("良い", "いい", "adj-ix").some(
      (f) => f.surface === "良かった" && f.reading === "よかった",
    ),
  );
  includes("高い", "たかい", "adj-i", [
    "高かったら",
    "高かったり",
    "高くありませんでした",
    "高くなくて",
    "高く",
    "高き",
  ]);
});
test("copula paradigms and contractions are generated only for da", () => {
  includes("だ", "だ", "cop", [
    "だった",
    "でした",
    "ではない",
    "じゃない",
    "じゃなかった",
    "であれば",
    "だったら",
    "だったり",
    "だろう",
    "でしょう",
  ]);
  assert.equal(forms("です", "です", "cop").length, 1);
  assert.equal(forms("静か", "しずか", "adj-na").length, 2);
});
test("potential and passive are separate analyses and sense POS restrictions survive", () => {
  const analyses = forms("食べる", "たべる", "v1").filter(
    (f) => f.surface === "食べられた",
  );
  assert.ok(analyses.some((f) => f.conjugationSteps.includes("potential")));
  assert.ok(analyses.some((f) => f.conjugationSteps.includes("passive")));
  const e = entry("synthetic", "切る", "きる", "v5r");
  e.senses.push({ ...e.senses[0], pos: ["n"] });
  for (const f of generateForms(e).filter((f) => f.conjugationSteps.length))
    assert.deepEqual(f.senseIndices, [0]);
});
test("zuru and kanji suru preserve morphological readings", () => {
  includes(
    "信ずる",
    "しんずる",
    "vz",
    ["信じた", "信じられる", "信じさせる", "信ずれば"],
    ["信じれる"],
  );
  assert.ok(
    forms("為る", "する", "vs-i").some(
      (f) => f.surface === "為ました" && f.reading === "しました",
    ),
  );
});
test("finite expansion never yields blank strings or duplicated analyses", () => {
  for (const [w, k, p] of [
    ["食べる", "たべる", "v1"],
    ["読む", "よむ", "v5m"],
    ["する", "する", "vs-i"],
    ["来る", "くる", "vk"],
    ["だ", "だ", "cop"],
  ]) {
    const all = forms(w, k, p);
    assert.ok(
      all.every((f) => f.surface && f.reading && Number.isFinite(f.cost)),
    );
    assert.equal(new Set(all.map((f) => JSON.stringify(f))).size, all.length);
    assert.ok(all.every((f) => f.conjugationSteps.length <= 2));
  }
});
