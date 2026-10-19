import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../packages/core/src/engine.js";
import { generateForms } from "../packages/core/src/conjugation.js";
import { romanizeKana, toHiragana } from "../packages/core/src/kana.js";
import { MemoryDictionary, entry } from "./helpers.js";

const repo = new MemoryDictionary([
  entry("1", "食べる", "たべる", "v1"),
  entry("2", "猫", "ねこ", "n"),
  entry("3", "は", "は", "prt"),
  entry("4", "学生", "がくせい", "n"),
  entry("5", "学", "がく", "n"),
  entry("6", "生", "せい", "n"),
  entry("7", "行く", "いく", "v5k-s"),
  entry("8", "高い", "たかい", "adj-i"),
  entry("9", "する", "する", "vs-i"),
]);
test("segments actual dictionary forms and traces polite past back to lemma", async () => {
  const r = await analyze(repo, { text: "猫は食べました。", limit: 3 });
  assert.deepEqual(
    r.candidates[0].tokens.map((t) => t.surface),
    ["猫", "は", "食べました", "。"],
  );
  const t = r.candidates[0].tokens[2];
  assert.equal(t.lemma, "食べる");
  assert.equal(t.reading, "たべました");
  assert.ok(t.conjugationSteps.some((s) => s.includes("past")));
});
test("Top K contains genuinely different segmentations", async () => {
  const r = await analyze(repo, { text: "学生", limit: 3 });
  assert.ok(
    r.candidates.some(
      (c) => c.tokens.map((t) => t.surface).join("|") === "学|生",
    ),
  );
  assert.equal(r.candidates[0].tokens[0].surface, "学生");
});
test("preserves UTF16 positions and unknowns including astral characters", async () => {
  const text = "😀猫 🦊";
  const r = await analyze(repo, { text });
  assert.equal(r.candidates[0].tokens.map((t) => t.surface).join(""), text);
  for (const t of r.candidates[0].tokens)
    assert.equal(text.slice(t.start, t.end), t.surface);
  assert.equal(r.candidates[0].tokens[1].start, 2);
  assert.equal(r.candidates[0].tokens[0].reading, null);
});
test("hints force boundaries, reject surrogate splits and invalid limits", async () => {
  const r = await analyze(repo, { text: "学生", segmentationHints: [1] });
  assert.deepEqual(
    r.candidates[0].tokens.map((t) => t.surface),
    ["学", "生"],
  );
  await assert.rejects(() =>
    analyze(repo, { text: "😀", segmentationHints: [1] }),
  );
  await assert.rejects(() => analyze(repo, { text: "猫", limit: 6 }));
  await assert.rejects(() => analyze(repo, { text: "猫".repeat(501) }));
});
test("spaces are preserved and constrain matches", async () => {
  const r = await analyze(repo, { text: "学 生" });
  assert.equal(r.candidates[0].tokens.map((t) => t.surface).join(""), "学 生");
  assert.ok(!r.candidates[0].tokens.some((t) => t.surface === "学生"));
});
test("generates ichidan/godan irregular te and adjective negative forms", () => {
  assert.ok(
    generateForms(entry("1", "食べる", "たべる", "v1")).some(
      (f) => f.surface === "食べられました",
    ),
  );
  assert.ok(
    generateForms(entry("7", "行く", "いく", "v5k-s")).some(
      (f) => f.surface === "行って",
    ),
  );
  assert.ok(
    generateForms(entry("8", "高い", "たかい", "adj-i")).some(
      (f) => f.surface === "高くない",
    ),
  );
  assert.ok(
    generateForms(entry("9", "する", "する", "vs-i")).some(
      (f) => f.surface === "しました",
    ),
  );
});
test("converts kana without inventing kanji readings", () => {
  assert.equal(toHiragana("ネコ"), "ねこ");
  assert.equal(romanizeKana("がっこう"), "gakkou");
  assert.equal(romanizeKana("しんぶん", "kunrei"), "sinbun");
});
test("sense reading restrictions do not leak another reading meaning", async () => {
  const e = entry("200", "生", "なま", "n");
  e.readings.push({ text: "せい", restrictions: [] });
  e.senses = [
    {
      pos: ["n"],
      glosses: [{ language: "eng", text: "raw" }],
      restrictions: [],
      readingRestrictions: ["なま"],
    },
    {
      pos: ["n"],
      glosses: [{ language: "eng", text: "life" }],
      restrictions: [],
      readingRestrictions: ["せい"],
    },
  ];
  const r = await analyze(new MemoryDictionary([e]), { text: "生" });
  const token = r.candidates[0].tokens[0];
  assert.equal(token.senses.length, 1);
  assert.equal(
    token.senses[0].glosses[0].text,
    token.reading === "なま" ? "raw" : "life",
  );
});
test("suru conditional is sureba and never shireba", () => {
  const forms = generateForms(entry("9", "する", "する", "vs-i"));
  assert.ok(forms.some((f) => f.surface === "すれば"));
  assert.ok(!forms.some((f) => f.surface === "しれば"));
});
test("exceptional godan forms do not follow incorrect regular stems", () => {
  const aru = generateForms(entry("10", "ある", "ある", "v5r-i"));
  assert.ok(aru.some((f) => f.surface === "ない"));
  assert.ok(!aru.some((f) => f.surface === "あらない"));
  const kudasaru = generateForms(entry("11", "下さる", "くださる", "v5aru"));
  assert.ok(kudasaru.some((f) => f.surface === "下さいます"));
  assert.ok(!kudasaru.some((f) => f.surface === "下さります"));
  const tou = generateForms(entry("12", "問う", "とう", "v5u-s"));
  assert.ok(tou.some((f) => f.surface === "問うて"));
  assert.ok(!tou.some((f) => f.surface === "問って"));
});
test("polite volitional forms support the Playground example", () => {
  assert.ok(
    generateForms(entry("20", "会う", "あう", "v5u")).some(
      (f) => f.surface === "会いましょう" && f.reading === "あいましょう",
    ),
  );
  assert.ok(
    generateForms(entry("21", "食べる", "たべる", "v1")).some(
      (f) => f.surface === "食べましょう",
    ),
  );
});
test("ranks a common standalone spelling ahead of alternate spelling and prefix readings", async () => {
  const alternate: any = entry("30", "先", "さき", "n");
  alternate.spellings.push("前");
  alternate.spellingPriorities = { 先: 2, 前: 0 };
  alternate.readings[0].priority = 2;
  const prefix: any = entry("31", "前", "ぜん", "n-pref");
  prefix.spellingPriorities = { 前: 2 };
  prefix.readings[0].priority = 2;
  const standalone: any = entry("32", "前", "まえ", "n");
  standalone.spellingPriorities = { 前: 2 };
  standalone.readings[0].priority = 2;
  const result = await analyze(
    new MemoryDictionary([alternate, prefix, standalone]),
    { text: "前" },
  );
  assert.equal(result.candidates[0].tokens[0].reading, "まえ");
});
