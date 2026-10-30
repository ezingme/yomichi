import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../packages/server/src/app.js";
import { MemoryDictionary } from "./helpers.js";
import type { SeqBundle } from "../packages/core/src/ichiran/store.js";

function bundle(
  seq: number,
  word: string,
  reading: string,
  pos: string,
): SeqBundle {
  const row = {
    id: seq,
    seq,
    text: word,
    ord: 0,
    common: 1,
    commonTags: "",
    conjugateP: true,
    nokanji: false,
    best: reading,
  };
  return {
    entry: { seq, rootP: true, nKanji: 1, nKana: 1, primaryNokanji: false },
    readings: [
      { ...row, table: "kanji" },
      { ...row, id: seq + 100, text: reading, table: "kana", best: word },
    ],
    senses: [{ id: seq, seq, ord: 0 }],
    props: [{ id: seq, seq, senseId: seq, tag: "pos", text: pos, ord: 0 }],
    glosses: [],
    conjugations: [],
    conjProps: [],
    conjSources: [],
    restricted: [],
    derived: [],
  };
}
async function withApp(
  bundles: SeqBundle[],
  run: (post: (body: any) => Promise<any>) => Promise<void>,
) {
  const repo: any = new MemoryDictionary([]);
  repo.ichiran = async () => ({
    store: {},
    dictionary: {
      version: "test",
      source: "test",
      entryCount: bundles.length,
      capabilities: ["ichiran"],
    },
    source: {
      fetchTexts: async (texts: string[]) =>
        bundles.flatMap((b) =>
          b.readings.filter((r) => texts.includes(r.text)),
        ),
      fetchSeqs: async (seqs: number[]) =>
        bundles.filter((b) => seqs.includes(b.entry.seq)),
    },
  });
  const app = await buildApp({ repository: () => repo });
  try {
    await run((body) =>
      app.inject({
        method: "POST",
        url: "/v1/verbs/inflections",
        payload: body,
      }),
    );
  } finally {
    await app.close();
  }
}

test("homographs return candidates and entryId resolves the intended verb", async () => {
  await withApp(
    [bundle(1, "居る", "いる", "v1"), bundle(2, "要る", "いる", "v5r")],
    async (post) => {
      const ambiguous = await post({ word: "いる" });
      assert.equal(ambiguous.statusCode, 409);
      assert.equal(ambiguous.json().error.code, "AMBIGUOUS_VERB");
      assert.equal(ambiguous.json().candidates.length, 2);
      const resolved = await post({ word: "いる", entryId: "2" });
      assert.equal(resolved.statusCode, 200);
      assert.equal(resolved.json().forms[0].negative, "いらない");
      assert.deepEqual(resolved.json().senseIds, ["2"]);
    },
  );
});
test("senseId narrows POS and cannot select another entry's sense", async () => {
  const b = bundle(1, "いる", "いる", "v1");
  b.senses.push({ id: 2, seq: 1, ord: 1 });
  b.props.push({ id: 2, seq: 1, senseId: 2, tag: "pos", text: "v5r", ord: 0 });
  await withApp([b], async (post) => {
    assert.equal((await post({ word: "いる" })).statusCode, 409);
    assert.equal(
      (await post({ word: "いる", senseId: "2" })).json().pos,
      "v5r",
    );
    assert.equal((await post({ word: "いる", senseId: "99" })).statusCode, 404);
    assert.equal((await post({ word: "いる", entryId: "99" })).statusCode, 404);
    assert.equal((await post({ word: "いる", pos: "v5k" })).statusCode, 422);
  });
});
test("reading restrictions reject impossible kanji/kana combinations", async () => {
  const b = bundle(1, "開く", "あく", "v5k");
  b.readings.push(
    { ...b.readings[1], id: 99, text: "ひらく", best: "拓く" },
    { ...b.readings[0], id: 98, text: "拓く" },
  );
  b.restricted.push({ reading: "ひらく", text: "拓く" });
  await withApp([b], async (post) => {
    assert.equal(
      (await post({ word: "開く", reading: "ヒラク" })).statusCode,
      400,
    );
    assert.equal(
      (await post({ word: "拓く", reading: "ヒラク" })).statusCode,
      200,
    );
  });
});
test("stagk, stagr, inherited POS and explicit sense selection are respected", async () => {
  const b = bundle(1, "居る", "いる", "v1");
  b.readings.push({ ...b.readings[0], id: 99, text: "入る" });
  b.senses.push({ id: 2, seq: 1, ord: 1 }, { id: 3, seq: 1, ord: 2 });
  b.props.push(
    { id: 2, seq: 1, senseId: 1, tag: "stagk", text: "居る", ord: 0 },
    { id: 3, seq: 1, senseId: 2, tag: "stagk", text: "入る", ord: 0 },
    { id: 4, seq: 1, senseId: 2, tag: "pos", text: "v5r", ord: 0 },
    { id: 5, seq: 1, senseId: 3, tag: "stagr", text: "いる", ord: 0 },
  );
  await withApp([b], async (post) => {
    assert.equal((await post({ word: "居る", senseId: "1" })).json().pos, "v1");
    assert.equal((await post({ word: "入る", senseId: "1" })).statusCode, 422);
    assert.equal(
      (await post({ word: "入る", senseId: "3" })).json().pos,
      "v5r",
    );
  });
});

test("SDK returns V2 data and preserves ambiguity candidates in typed failures", async () => {
  const { YomichiClient, YomichiClientError } =
    await import("../packages/client/src/index.js");
  await withApp(
    [bundle(1, "居る", "いる", "v1"), bundle(2, "要る", "いる", "v5r")],
    async (post) => {
      const client = new YomichiClient("http://test", {
        fetch: (async (_url, init) => {
          const r = await post(JSON.parse(String(init?.body)));
          return new Response(r.body, {
            status: r.statusCode,
            headers: { "content-type": "application/json" },
          });
        }) as typeof fetch,
      });
      assert.equal(typeof (client as any).verbInflections, "function");
      await assert.rejects(
        () => (client as any).verbInflections({ word: "いる" }),
        (e: any) =>
          e instanceof YomichiClientError &&
          e.code === "AMBIGUOUS_VERB" &&
          e.candidates.length === 2,
      );
      const r = await (client as any).verbInflections({
        word: "いる",
        entryId: "2",
      });
      assert.equal(r.schemaVersion, "2.0");
      assert.equal(
        r.details.find((d: any) => d.id === "potential").availability,
        "not-applicable",
      );
    },
  );
});

test("kana lookup of まみえる is not confused with the excluded potential of みえる", async () => {
  await withApp([bundle(1, "見える", "まみえる", "v1")], async (post) => {
    const r = await post({ word: "まみえる" });
    assert.equal(r.statusCode, 200);
    assert.equal(
      r.json().details.find((d: any) => d.id === "potential").positive[0]
        .surface,
      "まみえられる",
    );
  });
});

test("multiple readings remain ambiguous and stagr selects only the matching sense", async () => {
  const b = bundle(1, "開く", "あく", "v5k");
  b.readings.push({ ...b.readings[1], id: 9, text: "ひらく" });
  b.senses.push({ id: 2, seq: 1, ord: 1 });
  b.props.push(
    { id: 2, seq: 1, senseId: 1, tag: "stagr", text: "あく", ord: 0 },
    { id: 3, seq: 1, senseId: 2, tag: "stagr", text: "ひらく", ord: 0 },
  );
  await withApp([b], async (post) => {
    const r = await post({ word: "開く" });
    assert.equal(r.statusCode, 409);
    assert.deepEqual(
      r
        .json()
        .candidates.map((c: any) => c.reading)
        .sort(),
      ["あく", "ひらく"],
    );
    const selected = await post({ word: "開く", reading: "ヒラク" });
    assert.deepEqual(selected.json().senseIds, ["2"]);
    assert.equal(
      (await post({ word: "開く", reading: "あく", senseId: "2" })).statusCode,
      422,
    );
  });
});
test("re_nokanji and derived entries are not used as kanji dictionary roots", async () => {
  const b = bundle(1, "居る", "いる", "v1");
  b.readings[1].nokanji = true;
  const derived = bundle(2, "居る", "いる", "v1");
  derived.entry.rootP = false;
  await withApp([b, derived], async (post) => {
    assert.equal(
      (await post({ word: "居る", reading: "いる" })).statusCode,
      400,
    );
    assert.equal((await post({ word: "いる", entryId: "2" })).statusCode, 404);
    assert.equal((await post({ word: "いる", entryId: "1" })).statusCode, 200);
  });
});

test("plain する defaults to the unique dictionary-backed vs-i paradigm despite godan homophones", async () => {
  const entries = [
    bundle(1157170, "為る", "する", "vs-i"),
    bundle(1298670, "刷る", "する", "v5r"),
    bundle(1567440, "掏る", "する", "v5r"),
    bundle(1581900, "剃る", "する", "v5r"),
    bundle(1595910, "擦る", "する", "v5r"),
  ];
  await withApp(entries.reverse(), async (post) => {
    for (const body of [{ word: "する" }, { word: "する", reading: "スル" }]) {
      const response = await post(body);
      assert.equal(response.statusCode, 200);
      const result = response.json();
      assert.equal(result.entryId, "1157170");
      assert.equal(result.pos, "vs-i");
      assert.equal(
        result.forms.find((f: any) => f.form === "现在（普通体）").negative,
        "しない",
      );
      assert.equal(
        result.forms.find((f: any) => f.form === "过去（普通体）").positive,
        "した",
      );
      assert.equal(
        result.forms.find((f: any) => f.form === "可能形").positive,
        "できる",
      );
    }
    const exact = await post({ word: "する", entryId: "1298670" });
    assert.equal(exact.statusCode, 200);
    assert.equal(exact.json().forms[0].negative, "すらない");
    assert.equal(
      (await post({ word: "する", senseId: "1298670" })).json().pos,
      "v5r",
    );
    assert.equal((await post({ word: "する", pos: "v5r" })).statusCode, 409);
  });
});

test("する default never invents a missing vs-i entry or picks among multiple vs-i entries", async () => {
  await withApp(
    [bundle(1, "刷る", "する", "v5r"), bundle(2, "擦る", "する", "v5r")],
    async (post) => {
      assert.equal((await post({ word: "する" })).statusCode, 409);
    },
  );
  await withApp(
    [bundle(1, "為る", "する", "vs-i"), bundle(2, "する", "する", "vs-i")],
    async (post) => {
      assert.equal((await post({ word: "する" })).statusCode, 409);
    },
  );
});
