import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../packages/server/src/app.js";
import { YomichiClient } from "../packages/client/src/index.js";
import { MemoryDictionary, entry } from "./helpers.js";

test("conversion endpoints validate and preserve large integers", async () => {
  const app = await buildApp({ repository: () => new MemoryDictionary([]) });
  try {
    const post = (url: string, payload: unknown) =>
      app.inject({ method: "POST", url, payload: payload as object });
    const n = await post("/v1/numbers", { text: "9007199254740993" });
    assert.equal(n.statusCode, 200);
    assert.equal(n.json().value, "9007199254740993");
    assert.equal(
      (await post("/v1/numbers", { text: "三百" })).json().reading,
      "さんびゃく",
    );
    for (const payload of [
      { text: "-1" },
      { text: "1.5" },
      { text: "100000000000000000000" },
      { text: 1 },
      { text: "1", legal: "yes" },
    ])
      assert.equal((await post("/v1/numbers", payload)).statusCode, 400);
    assert.equal(
      (await post("/v1/deromanize", { text: "neko" })).json().canonical,
      "ねこ",
    );
    assert.equal(
      (await post("/v1/deromanize", { text: "123" })).statusCode,
      400,
    );
    assert.equal(
      (await post("/v1/deromanize", { text: "a".repeat(101) })).statusCode,
      400,
    );
    assert.equal((await post("/v1/suggest", { text: "neko" })).statusCode, 503);
    const chars = (await post("/v1/characters", { text: "ﾈｺ𠮷" })).json();
    assert.equal(chars.normalized, "ネコ𠮷");
    assert.equal(chars.offsetUnit, "utf16");
    assert.equal(chars.segments.at(-1).end, 4);
  } finally {
    await app.close();
  }
});

test("SDK suggestions are real entries and kanji capability absence is explicit", async () => {
  const repo = new MemoryDictionary([entry("1", "猫", "ねこ", "n")]);
  const app = await buildApp({ repository: () => repo });
  const api = new YomichiClient("http://local", {
    fetch: (async (url, init) => {
      const r = await app.inject({
        method: init?.method as "GET" | "POST",
        url: new URL(String(url)).pathname + new URL(String(url)).search,
        headers: init?.headers as Record<string, string>,
        payload: init?.body as string,
      });
      return new Response(r.body, {
        status: r.statusCode,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  });
  try {
    assert.equal((await api.suggest("neko", 1)).items[0].id, "1");
    assert.deepEqual(
      await api.suggest("123").catch((e) => ({ code: e.code })),
      { code: "INVALID_ROMAJI" },
    );
    assert.equal((await api.numbers("三百")).value, "300");
    assert.equal((await api.deromanize("neko")).canonical, "ねこ");
    await assert.rejects(api.kanjiStats("猫"), {
      status: 501,
      code: "CAPABILITY_UNAVAILABLE",
    });
    await assert.rejects(api.kanjiWords("a"), { status: 400 });
    await assert.rejects(api.kanjiWords("猫", 51), { status: 400 });
    await assert.rejects(api.suggest("neko", 51), { status: 400 });
    await assert.rejects(api.kanjiReadings("猫", "ねこ"), {
      status: 503,
      code: "KANJI_NOT_READY",
    });
  } finally {
    await app.close();
  }
});

test("kanji endpoints expose dictionary-derived statistics and reading matches", async () => {
  class ExtendedMemory extends MemoryDictionary {
    override async metadata() {
      return { ...(await super.metadata()), capabilities: ["words", "kanji"] };
    }
    override async kanji(character: string) {
      return {
        character,
        strokeCounts: [11],
        grade: null,
        frequency: null,
        readings: [{ type: "ja_kun", text: "ねこ" }],
        meanings: [{ language: "en", text: "cat" }],
      };
    }
    async kanjiWords(_character: string, limit = 20) {
      return this.words.slice(0, limit);
    }
    async kanjiStats(character: string) {
      return {
        character,
        entryCount: 1,
        commonEntryCount: 1,
        corpusFrequency: null,
        irregularReadingCount: null,
        provenance: {
          datasetId: "synthetic",
          version: "test",
          source: "synthetic",
          method: "dictionary entry counts",
        },
      };
    }
  }
  const app = await buildApp({
    repository: () => new ExtendedMemory([entry("1", "猫", "ねこ", "n")]),
  });
  try {
    const words = await app.inject("/v1/kanji/猫/words?limit=1");
    assert.equal(words.statusCode, 200);
    assert.equal(words.json().items[0].id, "1");
    const stats = await app.inject("/v1/kanji/猫/stats");
    assert.equal(stats.json().entryCount, 1);
    assert.equal(stats.json().corpusFrequency, null);
    const readings = await app.inject("/v1/kanji/猫/readings?reading=ネコ");
    assert.equal(readings.json().items[0].stem, "ねこ");
    assert.equal((await app.inject("/v1/kanji/猫/readings")).statusCode, 400);
    assert.equal(
      (await app.inject("/v1/kanji/猫/stats?limit=1")).statusCode,
      400,
    );
  } finally {
    await app.close();
  }
});

test("alignment is bounded, loads distinct kanji once, and reports unmatched spans", async () => {
  let lookups = 0;
  class AlignmentMemory extends MemoryDictionary {
    override async metadata() {
      return { ...(await super.metadata()), capabilities: ["words", "kanji"] };
    }
    override async kanji(character: string) {
      lookups++;
      return {
        character,
        strokeCounts: [11],
        grade: null,
        frequency: null,
        readings: [{ type: "ja_kun", text: "ねこ" }],
        meanings: [],
      };
    }
  }
  const app = await buildApp({
    repository: () =>
      new AlignmentMemory([
        entry("custom-cat", "猫", "ねこ", "n"),
        entry("2", "客", "きゃく", "n"),
      ]),
  });
  try {
    const send = (payload: object) =>
      app.inject({ method: "POST", url: "/v1/kanji/align", payload });
    const result = await send({ word: "猫猫", reading: "ねこねこ" });
    assert.equal(result.statusCode, 200);
    assert.equal(result.json().status, "matched");
    assert.equal(lookups, 1);
    const unmatched = await send({ word: "猫", reading: "いぬ" });
    assert.notEqual(unmatched.json().status, "matched");
    assert.ok(unmatched.json().warnings.length > 0);
    for (const payload of [
      { word: "猫".repeat(101), reading: "ねこ" },
      { word: "猫", reading: "ねこ", maxStates: 1000000 },
      { word: "猫", reading: "" },
    ])
      assert.equal((await send(payload)).statusCode, 400);
    const partial = await app.inject({
      method: "POST",
      url: "/v1/suggest",
      payload: { text: "ky" },
    });
    assert.equal(partial.statusCode, 200);
    assert.equal(partial.json().items[0].id, "2");
    const custom = await app.inject("/v1/words/custom-cat");
    assert.equal(custom.statusCode, 200);
    assert.equal(custom.json().id, "custom-cat");
  } finally {
    await app.close();
  }
});
