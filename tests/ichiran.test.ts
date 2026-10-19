/** Ichiran engine regression tests over a verbatim JMdict/KANJIDIC2 subset
 * (tests/fixtures/*-ichiran-subset.xml, extracted with
 * scripts/ichiran-build/extract-*fixture.ts). Expected romanizations were
 * recorded from the same analyzer over the complete JMdict 2026-10-19
 * Ichiran-model dataset; the subset reproduces them. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import {
  analyzeIchiran,
  findWordInfoJson,
  IchiranStore,
  kanjiInfo,
  matchReadingsInfo,
  romanize,
  romanizeStar,
  type IchiranEngine,
} from "../packages/core/src/ichiran/index.js";
import {
  buildKanji,
  buildLexicon,
  readCustomSources,
} from "../packages/dictionary/src/ichiran-build/build.js";
import { MemoryIchiranSource } from "../packages/dictionary/src/ichiran-build/memory-source.js";
import { parseNodes } from "../packages/dictionary/src/xml.js";
import { migrate } from "../packages/dictionary/src/schema.js";
import {
  importIchiranDataset,
  writeIchiranDataset,
} from "../packages/dictionary/src/ichiran-pg.js";
import { PostgresDictionary } from "../packages/dictionary/src/repository.js";
import { buildApp } from "../packages/server/src/app.js";
import type { Token } from "../packages/core/src/types.js";

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const built = (async () => {
  const lex = await buildLexicon(
    parseNodes(createReadStream(fixture("jmdict-ichiran-subset.xml")), "jmdict"),
    {
      custom: await readCustomSources(
        fileURLToPath(
          new URL("../packages/dictionary/data/ichiran", import.meta.url),
        ),
      ),
    },
  );
  const kanji = await buildKanji(
    lex,
    parseNodes(createReadStream(fixture("kanjidic-ichiran-subset.xml")), "kanji"),
  );
  return { lex, kanji };
})();
async function engine(): Promise<IchiranEngine> {
  const { lex, kanji } = await built;
  return {
    store: new IchiranStore(),
    source: new MemoryIchiranSource(lex, kanji.matcherReadings(), "subset", kanji),
    dictionary: {
      version: "subset",
      source: "JMdict subset",
      entryCount: lex.entries.size,
      capabilities: ["words", "ichiran", "kanji"],
    },
  };
}

const RECORDED: [string, string][] = [
  ["私は寿司を食べたい", "watashi wa sushi wo tabetai"],
  ["今日は寿司を食べに行きませんか？", "kyō wa sushi wo tabe ni ikimasen ka?"],
  // upstream join-parts leaves a space after final punctuation
  ["行きたいけど、もう食べてしまった。", "ikitai kedo, mō tabeteshimatta. "],
  ["3匹の猫", "sambiki no neko"],
  ["東京に住んでいます", "tōkyō ni sundeimasu"],
  ["本を読んでいる学生です", "hon/moto wo yondeiru gakusei desu"],
  ["日本語を勉強しています", "nihongo wo benkyō shiteimasu"],
  ["部屋は静かで綺麗だ", "heya wa shizuka de kirei da"],
  ["高くなかった", "takakunakatta"],
  ["食べさせられなかった", "tabesaserarenakatta"],
  ["書いてある", "kaitearu"],
];

test("Ichiran romanize reproduces recorded full-dictionary results", async () => {
  const e = await engine();
  for (const [text, expected] of RECORDED)
    assert.equal(
      (await romanize(e.store, e.source, text)).text,
      expected,
      text,
    );
});

function covers(input: string, tokens: Token[]) {
  let pos = 0;
  for (const t of tokens) {
    assert.equal(t.start, pos, `gap before ${t.surface}`);
    assert.equal(t.surface, input.slice(t.start, t.end));
    pos = t.end;
  }
  assert.equal(pos, input.length);
}

test("analysis keeps original UTF-16 offsets and preserves unknown text", async () => {
  const input = "ﾈｺ😀でabc書いてある";
  const a = await analyzeIchiran(await engine(), { text: input });
  assert.equal(a.offsetUnit, "utf16");
  const tokens = a.candidates[0].tokens;
  covers(input, tokens);
  // halfwidth katakana is normalized for lookup but reported as written
  assert.deepEqual([tokens[0].surface, tokens[0].reading, tokens[0].entryId], ["ﾈｺ", "ネコ", "1467640"]);
  assert.deepEqual(
    tokens.filter((t) => t.kind !== "word").map((t) => [t.surface, t.kind, t.start, t.end]),
    [
      ["😀", "separator", 2, 4],
      ["abc", "unknown", 5, 8],
    ],
  );
});

test("conjugation chains report the root entry and each step", async () => {
  const a = await analyzeIchiran(await engine(), { text: "食べさせられなかった" });
  const [t] = a.candidates[0].tokens;
  assert.equal(t.lemma, "食べる");
  assert.equal(t.entryId, "1358280");
  assert.deepEqual(t.conjugationSteps, [
    "Causative-Passive",
    "Past (~ta), negative",
  ]);
  assert.ok(t.senses[t.senseIndices[0]].glosses.some((g) => g.text === "to eat"));
});

test("suffix compounds expose components with spans and suffix roles", async () => {
  const input = "行きたいけど、もう食べてしまった。";
  const a = await analyzeIchiran(await engine(), { text: input });
  const tokens = a.candidates[0].tokens;
  covers(input, tokens);
  const comp = tokens.find((t) => t.surface === "食べてしまった")!;
  assert.equal(comp.lemma, "食べる");
  assert.deepEqual(
    comp.components.map((c) => [c.surface, c.start, c.end, c.lemma]),
    [
      ["食べて", 9, 12, "食べる"],
      ["しまった", 12, 16, "仕舞う"],
    ],
  );
  assert.equal(
    comp.components[1].conjugationSteps[0],
    "indicates completion (to finish ...)",
  );
  assert.equal(tokens.find((t) => t.surface === "、")!.kind, "separator");
});

test("counters, romanization methods, hints and projections", async () => {
  const e = await engine();
  const counter = await analyzeIchiran(e, { text: "3匹の猫" });
  const [three] = counter.candidates[0].tokens;
  assert.deepEqual([three.surface, three.reading, three.romanization], ["3匹", "さんびき", "sambiki"]);
  assert.deepEqual(three.pos, ["ctr"]);
  const kunrei = await analyzeIchiran(e, { text: "東京", romanization: "kunrei" });
  assert.equal(kunrei.candidates[0].tokens[0].romanization, "tôkyô");
  // a hint is a forced boundary inside a Japanese run
  const hinted = await analyzeIchiran(e, { text: "食べたい", segmentationHints: [2] });
  assert.deepEqual(hinted.candidates[0].tokens.map((t) => t.surface), ["食べ", "たい"]);
  const bare = await analyzeIchiran(e, {
    text: "食べたい",
    includeGlosses: false,
    includeConjugation: false,
  });
  assert.deepEqual(bare.candidates[0].tokens[0].senses, []);
  assert.deepEqual(bare.candidates[0].tokens[0].conjugationSteps, []);
  const two = await analyzeIchiran(e, { text: "本を読む", limit: 3 });
  assert.ok(two.candidates.length >= 1 && two.candidates.length <= 3);
  for (let i = 1; i < two.candidates.length; i++)
    assert.ok(two.candidates[i - 1].score >= two.candidates[i].score);
});

test("romanize* JSON, word lookup and kanji information", async () => {
  const e = await engine();
  const star = (await romanizeStar(e.store, e.source, "猫")) as any;
  assert.equal(star[0][0][0][0][0], "neko");
  assert.equal(star[0][0][0][0][1].seq, 1467640);
  const words = (await findWordInfoJson(e, "行く")) as any[];
  assert.ok(words.some((w) => w.seq === 1578850 && w.kana === "いく"));
  const k = (await kanjiInfo(e, "食")) as any;
  assert.equal(k.text, "食");
  assert.ok(k.readings.some((r: any) => r.text === "た" && r.type === "ja_kun"));
  assert.equal(await kanjiInfo(e, "鬱"), null);
  const match = (await matchReadingsInfo(e, "食べ物", "たべもの")) as any[];
  assert.deepEqual(
    match.map((m) => m.kanji ?? m.text),
    ["食", "べ", "物"],
  );
  assert.equal(match[0].reading, "た");
});

test("Ichiran datasets import atomically into PostgreSQL and drive the API", async () => {
  const { lex, kanji } = await built;
  const db = new PGlite();
  await migrate(db as any);
  const result = await importIchiranDataset(
    db as any,
    { version: "subset", source: "JMdict subset" },
    (id) => writeIchiranDataset(db as any, id, lex, kanji),
  );
  assert.equal(result.entries, lex.entries.size);
  const repo = new PostgresDictionary(db as any);
  const pgEngine = (await repo.ichiran())!;
  assert.ok(pgEngine.dictionary.capabilities.includes("kanji"));
  const memory = await engine();
  for (const [text] of RECORDED.slice(0, 4))
    assert.deepEqual(
      await romanizeStar(pgEngine.store, pgEngine.source, text),
      await romanizeStar(memory.store, memory.source, text),
      text,
    );
  // a failed import leaves the active dataset untouched
  await assert.rejects(
    importIchiranDataset(db as any, { version: "empty", source: "x" }, async () => 0),
  );
  assert.equal(
    (await new PostgresDictionary(db as any).ichiran())!.dictionary.version,
    "subset",
  );
  const app = await buildApp({ repository: () => new PostgresDictionary(db as any) });
  const analyzed = await app.inject({
    method: "POST",
    url: "/v1/analyze",
    payload: { text: "私は寿司を食べたい" },
  });
  assert.equal(analyzed.statusCode, 200);
  assert.match(analyzed.json().engineVersion, /\+ichiran$/);
  const rom = await app.inject({
    method: "POST",
    url: "/v1/ichiran/romanize",
    payload: { text: "私は寿司を食べたい", info: true },
  });
  assert.equal(rom.json().romanization, "watashi wa sushi wo tabetai");
  assert.equal(rom.json().info.length, 5);
  const ready = await app.inject({ method: "GET", url: "/readyz" });
  assert.equal(ready.statusCode, 200);
  const kanjiRes = await app.inject({ method: "GET", url: "/v1/ichiran/kanji/%E7%8C%AB" });
  assert.equal(kanjiRes.json().text, "猫");
  const legacy = await app.inject({
    method: "POST",
    url: "/v1/analyze",
    payload: { text: "猫", engine: "legacy" },
  });
  assert.equal(legacy.statusCode, 503);
  await app.close();
  await db.close();
});

test("ICHIRAN_DATABASE_URL mode reads Ichiran's own schema in place", async () => {
  const { lex, kanji } = await built;
  // An Ichiran-schema database: upstream table and column names, no dataset
  // key, rows stored in physical (ctid) order.
  const ichiranDb = new PGlite();
  await migrate(ichiranDb as any);
  const { id } = await importIchiranDataset(
    ichiranDb as any,
    { version: "subset", source: "JMdict subset" },
    (dataset) => writeIchiranDataset(ichiranDb as any, dataset, lex, kanji),
  );
  const upstream: [string, string, string][] = [
    ["entry", "seq,root_p,n_kanji,n_kana,primary_nokanji", "seq"],
    ["kanji_text", "id,seq,text,ord,common,common_tags,conjugate_p,nokanji,best_kana", "phys"],
    ["kana_text", "id,seq,text,ord,common,common_tags,conjugate_p,nokanji,best_kanji", "phys"],
    ["sense", "id,seq,ord", "id"],
    ["gloss", "id,sense_id,text,ord", "id"],
    ["sense_prop", "id,tag,sense_id,text,ord,seq", "id"],
    ["restricted_readings", "id,seq,reading,text", "id"],
    ["conjugation", 'id,seq,"from",via', "id"],
    ["conj_prop", "id,conj_id,conj_type,pos,neg,fml", "id"],
    ["conj_source_reading", "id,conj_id,text,source_text", "id"],
    ["kanji", "id,text,radical_c,radical_n,grade,strokes,freq,stat_common,stat_irregular", "id"],
    ["reading", "id,kanji_id,type,text,suffixp,prefixp,stat_common", "phys"],
    ["okurigana", "id,reading_id,text", "id"],
    ["meaning", "id,kanji_id,text", "id"],
  ];
  for (const [table, cols, order] of upstream)
    await ichiranDb.query(
      // id is a generated UUID; CREATE TABLE AS takes no bind parameters
      `CREATE TABLE ${table} AS SELECT ${cols} FROM yomichi_ij_${table} WHERE dataset_id='${id}' ORDER BY ${order}`,
    );
  // The Yomichi database has no Ichiran dataset of its own.
  const yomichiDb = new PGlite();
  await migrate(yomichiDb as any);
  const repo = () =>
    new PostgresDictionary(yomichiDb as any, {
      ichiranDatabase: ichiranDb as any,
      ichiranVersion: "ichiran-subset",
    });
  const direct = (await repo().ichiran())!;
  assert.equal(direct.dictionary.version, "ichiran-subset");
  assert.equal(direct.dictionary.entryCount, lex.entries.size);
  assert.ok(direct.dictionary.capabilities.includes("kanji"));
  const memory = await engine();
  for (const [text, expected] of RECORDED) {
    assert.equal((await romanize(direct.store, direct.source, text)).text, expected, text);
    assert.deepEqual(
      await romanizeStar(direct.store, direct.source, text),
      await romanizeStar(memory.store, memory.source, text),
      text,
    );
  }
  assert.deepEqual(await kanjiInfo(direct, "食"), await kanjiInfo(memory, "食"));
  const app = await buildApp({ repository: repo });
  const ready = await app.inject({ method: "GET", url: "/readyz" });
  assert.equal(ready.json().ichiran.version, "ichiran-subset");
  const analyzed = await app.inject({
    method: "POST",
    url: "/v1/analyze",
    payload: { text: "食べさせられなかった" },
  });
  assert.equal(analyzed.json().candidates[0].tokens[0].lemma, "食べる");
  await app.close();
  await ichiranDb.close();
  await yomichiDb.close();
});
