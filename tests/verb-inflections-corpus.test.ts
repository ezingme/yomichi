import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateVerbInflections } from "../packages/core/src/verb-inflections.js";
const cases = readFileSync(
  new URL("./fixtures/verb-inflections/modern.tsv", import.meta.url),
  "utf8",
)
  .split("\n")
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => l.split("|"));
test("regression corpus contains at least 100 distinct verbs", () =>
  assert.ok(new Set(cases.map((c) => c[0])).size >= 100));
for (const [
  word,
  reading,
  pos,
  negative,
  past,
  te,
  polite,
  potential,
] of cases) {
  test(`literal paradigm reference: ${word} (${pos})`, () => {
    const r = generateVerbInflections(word, reading, [pos]);
    assert.ok(r);
    const get = (id: string) => r.details.find((d) => d.id === id)!;
    assert.equal(get("nonpast").negative[0].surface, negative);
    assert.equal(get("past").positive[0].surface, past);
    assert.equal(get("te").positive[0].surface, te);
    assert.equal(get("nonpast-polite").positive[0].surface, polite);
    assert.equal(get("potential").positive[0]?.surface ?? "-", potential);
    for (const row of [...r.details, ...r.extensions]) {
      for (const v of [...row.positive, ...row.negative]) {
        assert.match(v.reading, /^[\u3041-\u3096ー]+$/u);
        assert.ok(v.surface);
      }
    }
  });
}

const secondary = readFileSync(
  new URL("./fixtures/verb-inflections/secondary.tsv", import.meta.url),
  "utf8",
)
  .split("\n")
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => l.split("|"));
for (const [word, reading, pos, ...expected] of secondary) {
  test(`literal secondary paradigm reference: ${word} (${pos})`, () => {
    const r = generateVerbInflections(word, reading, [pos])!;
    [
      "volitional",
      "ba",
      "imperative",
      "passive",
      "causative",
      "causative-passive",
    ].forEach((id, i) => {
      const d = r.details.find((d) => d.id === id)!;
      assert.deepEqual(
        [d.positive[0]?.surface, d.negative[0]?.surface],
        expected[i].split("/"),
        id,
      );
    });
  });
}
