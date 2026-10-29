import { test } from "node:test";
import assert from "node:assert/strict";
import { generateVerbInflections } from "../packages/core/src/verb-inflections.js";

test("generates the Jisho-style 食べる affirmative/negative paradigm", () => {
  const result = generateVerbInflections("食べる", "タベル", ["n", "v1"]);
  assert.ok(result);
  assert.equal(result.pos, "v1");
  assert.deepEqual(result.posCandidates, ["v1"]);
  assert.deepEqual(result.forms, [
    { form: "现在（普通体）", positive: "食べる", negative: "食べない" },
    { form: "现在（敬体）", positive: "食べます", negative: "食べません" },
    { form: "过去（普通体）", positive: "食べた", negative: "食べなかった" },
    { form: "过去（敬体）", positive: "食べました", negative: "食べませんでした" },
    { form: "て形", positive: "食べて", negative: "食べないで" },
    { form: "意志形", positive: "食べよう", negative: "食べまい" },
    { form: "假定形（ば形）", positive: "食べれば", negative: "食べなければ" },
    { form: "命令形", positive: "食べろ", negative: "食べるな" },
    { form: "可能形", positive: "食べられる", negative: "食べられない" },
    { form: "被动形", positive: "食べられる", negative: "食べられない" },
    { form: "使役形", positive: "食べさせる", negative: "食べさせない" },
    { form: "使役被动", positive: "食べさせられる", negative: "食べさせられない" },
  ]);
});

test("uses the supplied sense_prop POS text and supports godan/irregular verbs", () => {
  assert.equal(generateVerbInflections("食べる", "たべる", ["n", "adj-i"]), null);

  const godan = generateVerbInflections("買う", "かう", ["v5u", "n"]);
  assert.ok(godan);
  assert.equal(godan.forms.find((f) => f.form === "现在（普通体）")?.negative, "買わない");
  assert.equal(godan.forms.find((f) => f.form === "て形")?.positive, "買って");
  assert.equal(godan.forms.find((f) => f.form === "可能形")?.positive, "買える");

  const suru = generateVerbInflections("する", "する", ["vs-i"]);
  assert.ok(suru);
  assert.equal(suru.forms.find((f) => f.form === "过去（敬体）")?.positive, "しました");
  assert.equal(suru.forms.find((f) => f.form === "使役被动")?.negative, "させられない");

  const kuru = generateVerbInflections("来る", "くる", ["vk"]);
  assert.ok(kuru);
  assert.equal(kuru.forms.find((f) => f.form === "过去（普通体）")?.positive, "来た");
});
