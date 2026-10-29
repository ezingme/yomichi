import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../packages/server/src/app.js";
import { MemoryDictionary } from "./helpers.js";

test("verb inflections endpoint reads verb POS from sense_prop.text", async () => {
  const kanjiRow = {
    table: "kanji",
    id: 1,
    seq: 1,
    text: "食べる",
    ord: 0,
    common: 1,
    commonTags: "",
    conjugateP: true,
    nokanji: false,
    best: "たべる",
    phys: 1,
  };
  const kanaRow = {
    ...kanjiRow,
    table: "kana",
    id: 2,
    text: "たべる",
    best: "食べる",
  };
  const bundle = {
    entry: { seq: 1, rootP: true, nKanji: 1, nKana: 1, primaryNokanji: false },
    readings: [kanjiRow, kanaRow],
    senses: [{ id: 1, seq: 1, ord: 0 }],
    props: [
      { id: 1, senseId: 1, seq: 1, tag: "pos", text: "v1", ord: 0 },
      { id: 2, senseId: 1, seq: 1, tag: "pos", text: "n", ord: 1 },
      { id: 3, senseId: 1, seq: 1, tag: "misc", text: "adj-i", ord: 2 },
    ],
    glosses: [],
    conjugations: [],
    conjProps: [],
    conjSources: [],
    restricted: [],
    derived: [],
  };
  const repo: any = new MemoryDictionary([]);
  repo.ichiran = async () => ({
    store: {},
    dictionary: { version: "test", source: "test", entryCount: 1, capabilities: ["ichiran"] },
    source: {
      fetchTexts: async (texts: string[]) => texts.includes("食べる") ? [kanjiRow] : [],
      fetchSeqs: async (seqs: number[]) => seqs.includes(1) ? [bundle] : [],
    },
  });

  const app = await buildApp({ repository: () => repo });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/verbs/inflections",
      payload: { word: "食べる" },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.pos, "v1");
    assert.deepEqual(body.posCandidates, ["v1"]);
    assert.equal(body.entryId, "1");
    assert.equal(
      body.forms.find((item: { form: string }) => item.form === "て形").negative,
      "食べないで",
    );
  } finally {
    await app.close();
  }
});

test("verb inflections endpoint reports missing entries and non-verbs", async () => {
  const row = {
    table: "kanji", id: 2, seq: 2, text: "猫", ord: 0, common: 1,
    commonTags: "", conjugateP: true, nokanji: false, best: "ねこ", phys: 2,
  };
  const bundle = {
    entry: { seq: 2, rootP: true, nKanji: 1, nKana: 1, primaryNokanji: false },
    readings: [row, { ...row, table: "kana", id: 3, text: "ねこ" }],
    senses: [{ id: 2, seq: 2, ord: 0 }],
    props: [{ id: 4, senseId: 2, seq: 2, tag: "pos", text: "n", ord: 0 }],
    glosses: [], conjugations: [], conjProps: [], conjSources: [], restricted: [], derived: [],
  };
  const repo: any = new MemoryDictionary([]);
  repo.ichiran = async () => ({
    store: {},
    dictionary: { version: "test", source: "test", entryCount: 1, capabilities: ["ichiran"] },
    source: {
      fetchTexts: async (texts: string[]) => texts.includes("猫") ? [row] : [],
      fetchSeqs: async (seqs: number[]) => seqs.includes(2) ? [bundle] : [],
    },
  });
  const app = await buildApp({ repository: () => repo });
  try {
    assert.equal((await app.inject({
      method: "POST", url: "/v1/verbs/inflections", payload: { word: "missing" },
    })).statusCode, 404);
    const notVerb = await app.inject({
      method: "POST", url: "/v1/verbs/inflections", payload: { word: "猫" },
    });
    assert.equal(notVerb.statusCode, 422);
    assert.equal(notVerb.json().error.code, "NOT_A_VERB");
  } finally {
    await app.close();
  }
});
