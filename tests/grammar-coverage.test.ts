import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../packages/core/src/engine.js";
import { MemoryDictionary, entry } from "./helpers.js";
const repo = new MemoryDictionary([
  entry("1", "書く", "かく", "v5k"),
  entry("2", "読む", "よむ", "v5m"),
  entry("3", "高い", "たかい", "adj-i"),
  entry("4", "勉強", "べんきょう", "vs"),
  entry("5", "猫", "ねこ", "n"),
]);
test("productive auxiliary chains preserve source components and inflection", async () => {
  for (const [text, reading] of [
    ["書いてみました", "かいてみました"],
    ["読んじゃった", "よんじゃった"],
    ["書きにくかった", "かきにくかった"],
    ["高すぎました", "たかすぎました"],
    ["勉強しました", "べんきょうしました"],
  ]) {
    const r = await analyze(repo, { text });
    const token = r.candidates[0].tokens[0];
    assert.equal(token.surface, text);
    assert.equal(token.reading, reading);
    assert.ok(token.components.length);
    const check = (t: typeof token) => {
      assert.equal(text.slice(t.start, t.end), t.surface);
      t.components.forEach(check);
    };
    check(token);
  }
});
test("numbers/counters and width normalization are integrated with original offsets", async () => {
  const r = await analyze(repo, { text: "猫３匹" });
  assert.deepEqual(
    r.candidates[0].tokens.map((t) => t.surface),
    ["猫", "３匹"],
  );
  assert.equal(r.candidates[0].tokens[1].reading, "さんびき");
  const half = new MemoryDictionary([entry("6", "カタカナ", "かたかな", "n")]);
  const n = await analyze(half, { text: "ｶﾀｶﾅ" });
  assert.equal(n.candidates[0].tokens[0].reading, "かたかな");
  assert.equal(n.candidates[0].tokens[0].end, 4);
});
test("grammar respects forced boundaries and removes nested glosses/conjugation on request", async () => {
  const r = await analyze(repo, {
    text: "書いてみました",
    segmentationHints: [3],
    includeGlosses: false,
    includeConjugation: false,
  });
  assert.ok(r.candidates[0].tokens.some((t) => t.end === 3));
  const s = await analyze(repo, {
    text: "書いてみました",
    includeGlosses: false,
    includeConjugation: false,
  });
  const check = (t: any) => {
    assert.deepEqual(t.senses, []);
    assert.deepEqual(t.conjugationSteps, []);
    t.components.forEach(check);
  };
  s.candidates[0].tokens.forEach(check);
});

test("forced boundaries retain numeric readings on both sides", async () => {
  const r = await analyze(repo, { text: "123匹", segmentationHints: [1] });
  assert.equal(r.candidates[0].tokens[0].reading, "いち");
  assert.equal(r.candidates[0].tokens[0].surface, "1");
});

test("ordinal prefix forms a complete number/counter span", async () => {
  const r = await analyze(repo, { text: "第３回" });
  const t = r.candidates[0].tokens[0];
  assert.equal(t.surface, "第３回");
  assert.equal(t.reading, "だいさんかい");
  assert.deepEqual(t.conjugationSteps, ["ordinal"]);
  assert.equal(t.components.map((c) => c.surface).join(""), t.surface);
});
