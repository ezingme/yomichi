/** Yomichi reproduces what ichi.moe displays. tests/fixtures/ichimoe holds
 * ichi.moe result pages parsed into the shared view model (views.json) and the
 * Ichiran database rows those sentences read (ichiran-rows.json.gz), both
 * recorded by the scripts in scripts/oracle. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cardView, ichiranResult, type IchiranResult } from "../packages/core/src/ichiran/index.js";
import { normalizeChars } from "../packages/core/src/ichiran/chars.js";
import { buildApp } from "../packages/server/src/app.js";
import { replayEngine } from "./helpers-ichiran.js";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/ichimoe/views.json", import.meta.url), "utf8")) as {
  cases: { text: string; view: any }[];
};
function view(r: IchiranResult) {
  const words = r.parts.filter((p) => p.type === "word");
  return {
    parts: r.parts.map((p) => ({ type: p.type, text: p.display })),
    picks: words.map((p) => p.paths.map((x) => ({ score: x.score, romanization: x.romanization }))),
    cards: words.map((p) => (p.paths[0]?.words ?? []).map((w) => cardView(w.romanization, w.gloss, w.skipped))),
  };
}

test("ichi.moe pages are reproduced: runs, all paths with scores, word cards", async () => {
  const engine = replayEngine();
  assert.equal(fixtures.cases.length, 5);
  for (const c of fixtures.cases) {
    const r = await ichiranResult(engine, c.text, { limit: 5 });
    assert.deepEqual(view(r), c.view, c.text);
  }
});

test("ichi.moe display rules", async () => {
  const engine = replayEngine();
  // characters normalized, punctuation kept
  assert.equal(normalizeChars("ｶﾀｶﾅで３人、！？"), "カタカナで3人、！?");
  const r = await ichiranResult(engine, "べんきょう しています", { limit: 5 });
  const [first, , second] = r.parts;
  assert.equal(r.romanization, "benkyō shiteimasu");
  assert.equal(second.type, "word");
  if (second.type !== "word" || first.type !== "word") return;
  assert.deepEqual([first.start, first.end, second.start, second.end], [0, 5, 6, 11]);
  const card = cardView(second.paths[0].words[0].romanization, second.paths[0].words[0].gloss);
  const [suru, iru] = card.entries[0].compound!.parts;
  // a suffix shows its role and conjugation, not the root's senses
  assert.equal(iru.suffix, "indicates continuing action (to be ...ing)");
  assert.deepEqual(iru.conjugations[0].senses, []);
  assert.ok(suru.conjugations[0].senses!.length > 10);
  // several entries for one word: numbered alternatives on ichi.moe
  const book = await ichiranResult(engine, "本を読んでいる学生が3人います。食べさせられなかった", { limit: 5 });
  const hon = book.parts[0].type === "word" ? book.parts[0].paths[0].words[0] : null;
  assert.equal(hon!.romanization, "hon/moto");
  assert.deepEqual(cardView(hon!.romanization, hon!.gloss).entries.map((e) => e.reading), ["本 【ほん】", "本 【もと】"]);
});

test("POST /v1/ichiran/analyze returns the ichi.moe data", async () => {
  const engine = replayEngine();
  const app = await buildApp({
    repository: () => ({
      metadata: async () => null,
      lookup: async () => [],
      entries: async () => [],
      search: async () => [],
      kanji: async () => null,
      ichiran: async () => engine,
    }),
  });
  const res = await app.inject({
    method: "POST",
    url: "/v1/ichiran/analyze",
    payload: { text: "べんきょう しています" },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as IchiranResult;
  assert.deepEqual(view(body), fixtures.cases[0].view);
  const bad = await app.inject({ method: "POST", url: "/v1/ichiran/analyze", payload: { text: "猫", method: "x" } });
  assert.equal(bad.statusCode, 400);
  await app.close();
});
