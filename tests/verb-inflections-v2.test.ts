import { test } from "node:test";
import assert from "node:assert/strict";
import { generateVerbInflections } from "../packages/core/src/verb-inflections.js";
import { conjugatePair } from "../packages/core/src/morphology/paradigms.js";

test("ある never acquires a regular potential analysis, including kanji", () => {
  for (const word of ["ある", "有る", "在る"]) {
    assert.equal(
      conjugatePair(word, "ある", "v5r-i").some((f) =>
        f.steps.includes("potential"),
      ),
      false,
    );
    const result = generateVerbInflections(word, "ある", ["v5r-i"])!;
    assert.equal(
      result.forms.some((f) => f.form === "可能形"),
      false,
    );
  }
});
test("godan POS must agree with the ending rather than silently choosing another class", () => {
  assert.equal(generateVerbInflections("待つ", "まつ", ["v5k"]), null);
});
test("ambiguous supplied POS is not decided by row count", () => {
  assert.equal(generateVerbInflections("いる", "いる", ["v1", "v5r"]), null);
});
test("分かる has no routine potential form", () => {
  const result = generateVerbInflections("分かる", "わかる", ["v5r"])!;
  assert.equal(
    result.forms.some((f) => f.form === "可能形"),
    false,
  );
});

test("V2 preserves legacy rows and exposes distinct negative te variants with readings", () => {
  const r = generateVerbInflections("食べる", "たべる", ["v1"]) as any;
  const te = r.details.find((d: any) => d.id === "te");
  assert.deepEqual(
    te.negative.map((v: any) => [v.surface, v.reading]),
    [
      ["食べないで", "たべないで"],
      ["食べなくて", "たべなくて"],
    ],
  );
  assert.notEqual(te.negative[0].note, te.negative[1].note);
  assert.equal(r.details[0].label, "非过去（普通形）");
  assert.ok(
    r.extensions.some(
      (d: any) => d.id === "tara" && d.negative[0].surface === "食べなかったら",
    ),
  );
  assert.ok(
    r.extensions.some(
      (d: any) =>
        d.id === "desiderative" && d.negative[0].surface === "食べたくない",
    ),
  );
});
test("full and contracted causative passive variants both retain negatives and readings", () => {
  const r = generateVerbInflections("待つ", "まつ", ["v5t"]) as any;
  const d = r.details.find((d: any) => d.id === "causative-passive");
  assert.deepEqual(
    d.positive.map((v: any) => v.surface),
    ["待たせられる", "待たされる"],
  );
  assert.deepEqual(
    d.negative.map((v: any) => v.surface),
    ["待たせられない", "待たされない"],
  );
  assert.equal(d.positive[1].reading, "またされる");
  assert.equal(
    (generateVerbInflections("話す", "はなす", ["v5s"]) as any).details.find(
      (d: any) => d.id === "causative-passive",
    ).positive.length,
    1,
  );
});
test("来る allomorph readings are not copied from dictionary pronunciation", () => {
  const r = generateVerbInflections("来る", "くる", ["vk"]) as any;
  assert.equal(
    r.details.find((d: any) => d.id === "past").positive[0].reading,
    "きた",
  );
  assert.equal(
    r.details.find((d: any) => d.id === "imperative").positive[0].reading,
    "こい",
  );
});
test("lexical exclusions are visible and uncertain semantics are labelled", () => {
  const r = generateVerbInflections("ある", "ある", ["v5r-i"]) as any;
  const d = r.details.find((d: any) => d.id === "potential");
  assert.equal(d.availability, "not-applicable");
  assert.deepEqual(d.positive, []);
  assert.ok(d.note);
  assert.match(r.details.find((d: any) => d.id === "volitional").note, /推量/);
  assert.equal(
    (generateVerbInflections("待つ", "まつ", ["v5t"]) as any).details.find(
      (d: any) => d.id === "passive",
    ).availability,
    "context-dependent",
  );
});

test("kanji 為る retains the lexical できる potential", () => {
  assert.equal(
    generateVerbInflections("為る", "する", ["vs-i"])!.forms.find(
      (f) => f.form === "可能形",
    )?.positive,
    "できる",
  );
});

test("lexical teaching exclusions require the reading as well as the spelling", () => {
  const result = generateVerbInflections("見える", "まみえる", ["v1"])!;
  assert.equal(
    result.details.find((d) => d.id === "potential")!.positive[0]?.reading,
    "まみえられる",
  );
  assert.equal(
    generateVerbInflections("見える", "みえる", ["v1"])!.details.find(
      (d) => d.id === "potential",
    )!.availability,
    "not-applicable",
  );
});

test("unsupported forms never claim to be productive", () => {
  const row = generateVerbInflections("愛する", "あいする", [
    "vs-s",
  ])!.details.find((d) => d.id === "potential")!;
  assert.equal(row.availability, "not-applicable");
  assert.ok(row.note);
});
