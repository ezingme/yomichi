import { test } from "node:test";
import assert from "node:assert/strict";
import { alignKanjiReadings } from "../packages/dictionary/src/alignment.js";
import type { Kanji } from "../packages/core/src/types.js";
// Synthetic, deliberately limited test readings. Not a production KANJIDIC snapshot.
const data: Record<string, Kanji> = {};
for (const [character, type, text] of [
  ["取", "ja_kun", "と.る"],
  ["取", "ja_kun", "とり"],
  ["次", "ja_kun", "つぎ"],
  ["店", "ja_on", "テン"],
  ["助", "ja_kun", "すけ"],
  ["人", "ja_kun", "と"],
  ["頑", "ja_on", "ガン"],
  ["張", "ja_kun", "ば.る"],
  ["肝", "ja_on", "カン"],
  ["心", "ja_on", "シン"],
  ["決", "ja_on", "ケツ"],
  ["行", "ja_kun", "ゆ.く"],
  ["方", "ja_on", "ホウ"],
  ["時", "ja_on", "ジ"],
  ["計", "ja_on", "ケイ"],
  ["指", "ja_kun", "さ.す"],
  ["図", "ja_on", "ズ"],
  ["竹", "ja_kun", "たけ"],
  ["刀", "ja_kun", "かたな"],
  ["小", "ja_kun", "こ"],
  ["売", "ja_kun", "う.る"],
  ["上", "ja_kun", "あ.げる"],
  ["北", "ja_on", "ホク"],
  ["明", "ja_kun", "あ.ける"],
  ["後", "ja_on", "ゴ"],
  ["日", "ja_on", "ニチ"],
  ["𠮷", "ja_kun", "よし"],
]) {
  data[character] ??= {
    character,
    readings: [],
    meanings: [],
    strokeCounts: [],
    grade: null,
    frequency: null,
  };
  data[character].readings.push({ type, text });
}
test("upstream 13 match-readings scenarios preserve dictionary matches and label irregular assignments", () => {
  const cases = [
    ["取次店", "とりつぎてん", true],
    ["助っ人", "すけっと", true],
    ["頑張って", "がんばって", true],
    ["肝心", "かんじん", true],
    ["決心", "けっしん", true],
    ["行方", "ゆくえ", false],
    ["時計", "とけい", false],
    ["指図", "さしず", false],
    ["竹刀", "しない", false],
    ["小売店", "こうりてん", false],
    ["売上げ", "うりあげ", false],
    ["北方", "ほっぽう", true],
    ["明後日", "あさって", false],
  ] as const;
  for (const [word, reading, matched] of cases) {
    const r = alignKanjiReadings(word, reading, data);
    assert.equal(r.status === "matched", matched, word);
    assert.equal(r.segments.map((s) => s.surface).join(""), word);
    assert.equal(r.segments.map((s) => s.reading).join(""), reading);
    for (const s of r.segments) {
      assert.equal(word.slice(s.start, s.end), s.surface);
      assert.equal(reading.slice(s.readingStart, s.readingEnd), s.reading);
    }
  }
  const voiced = alignKanjiReadings("肝心", "かんじん", data);
  assert.equal(voiced.segments[1].candidates[0].rendaku, true);
  const geminated = alignKanjiReadings("北方", "ほっぽう", data);
  assert.equal(geminated.segments[0].candidates[0].geminated, true);
  assert.equal(geminated.segments[1].candidates[0].rendaku, true);
  assert.equal(
    alignKanjiReadings("竹刀", "しない", data).segments.every(
      (s) => s.status === "unmatched",
    ),
    true,
  );
});
test("alignment preserves supplementary and normalized reading offsets, okurigana and explicit bounds", () => {
  const r = alignKanjiReadings("𠮷取る", "ヨシトル", data);
  assert.equal(r.status, "matched");
  assert.deepEqual(
    r.segments.map((s) => [s.start, s.end]),
    [
      [0, 2],
      [2, 3],
      [3, 4],
    ],
  );
  assert.equal(r.segments[1].candidates[0].okurigana, "る");
  assert.equal(alignKanjiReadings("肝心", "ｶﾝｼﾞﾝ", data).status, "matched");
  assert.equal(alignKanjiReadings("未知", "みち", {}).status, "unmatched");
  assert.equal(alignKanjiReadings("かな", "べつ", data).status, "unmatched");
  const bounded = alignKanjiReadings(
    "未知未知",
    "みちみちみち",
    {},
    { maxStates: 2 },
  );
  assert.equal(bounded.status, "limit");
  assert.ok(bounded.statesVisited <= 2);
  assert.equal(
    alignKanjiReadings("𠮷", "よし", data, { maxWordLength: 0 }).status,
    "limit",
  );
});
