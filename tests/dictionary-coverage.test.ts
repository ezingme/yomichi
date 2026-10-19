import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { PGlite } from "@electric-sql/pglite";
import {
  parseEntries,
  type RichEntry,
  type RichKanji,
} from "../packages/dictionary/src/xml.js";
import { importDictionary } from "../packages/dictionary/src/import.js";
import { PostgresDictionary } from "../packages/dictionary/src/repository.js";
import { migrate } from "../packages/dictionary/src/schema.js";
import { matchKanjiReading } from "../packages/dictionary/src/kanji.js";
import {
  listDatasets,
  activateDataset,
} from "../packages/dictionary/src/maintenance.js";
async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const value of source) out.push(value);
  return out;
}
const words = `<JMdict><entry><ent_seq>1</ent_seq><k_ele><keb>食べる</keb><ke_inf>rare</ke_inf><ke_pri>ichi1</ke_pri></k_ele><r_ele><reb>たべる</reb><re_inf>old</re_inf><re_pri>nf01</re_pri></r_ele><sense><pos>v1</pos><field>food</field><misc>uk</misc><dial>ksb</dial><s_inf>note</s_inf><xref>食う・1</xref><ant>飲む</ant><lsource xml:lang="fre" ls_type="part" ls_wasei="y">manger</lsource><gloss g_type="lit" g_gend="m">eat</gloss></sense></entry></JMdict>`;
const kanji = `<kanjidic2><character><literal>食</literal><codepoint><cp_value cp_type="ucs">98DF</cp_value></codepoint><radical><rad_value rad_type="classical">184</rad_value></radical><misc><stroke_count>9</stroke_count><jlpt>4</jlpt><rad_name>しょく</rad_name><variant var_type="jis208">1-1</variant></misc><dic_number><dic_ref dr_type="nelson_c" m_vol="1">2</dic_ref></dic_number><query_code><q_code qc_type="skip">2-2-7</q_code></query_code><reading_meaning><rmgroup><reading r_type="ja_on">ショク</reading><reading r_type="ja_kun">た.べる</reading><meaning>eat</meaning></rmgroup><nanori>じき</nanori></reading_meaning></character></kanjidic2>`;
test("rich JMdict and KANJIDIC metadata survive streaming parsing", async () => {
  const w = (
    await collect(parseEntries(Readable.from([words]), "jmdict"))
  )[0] as RichEntry;
  assert.deepEqual(w.spellingInfo, { 食べる: ["rare"] });
  assert.deepEqual(w.readings[0].priorityTags, ["nf01"]);
  assert.deepEqual(w.senses[0].fields, ["food"]);
  assert.deepEqual(w.senses[0].crossReferences, ["食う・1"]);
  assert.deepEqual(w.senses[0].loanwordSources, [
    { language: "fre", text: "manger", type: "part", wasei: true },
  ]);
  assert.equal(w.senses[0].glosses[0].type, "lit");
  const k = (
    await collect(parseEntries(Readable.from([kanji]), "kanji"))
  )[0] as RichKanji;
  assert.deepEqual(k.nanori, ["じき"]);
  assert.deepEqual(k.radicals, [{ type: "classical", value: 184 }]);
  assert.equal(k.jlpt, 4);
  assert.equal(k.dictionaryReferences[0].volume, "1");
  assert.equal(matchKanjiReading(k, "タベル")[0].stem, "た");
  assert.equal(matchKanjiReading(k, "じき")[0].type, "nanori");
  assert.deepEqual(matchKanjiReading(k, "unknown"), []);
});
test("SQL kanji snapshots, word statistics and rollback use actual immutable datasets", async () => {
  const db = new PGlite();
  try {
    await migrate(db);
    const a = await importDictionary(db, Readable.from([words]), {
      kind: "jmdict",
      version: "a",
    });
    await importDictionary(db, Readable.from([kanji]), {
      kind: "kanji",
      version: "k1",
    });
    const repo = new PostgresDictionary(db);
    assert.equal((await repo.kanji("食"))?.meanings[0].text, "eat");
    assert.equal((await repo.kanjiWords("食", 10))[0].id, "1");
    const stats = await repo.kanjiStats("食");
    assert.equal(stats.entryCount, 1);
    assert.equal(stats.commonEntryCount, 1);
    assert.equal(stats.corpusFrequency, null);
    assert.equal(stats.provenance.datasetId, a.id);
    await importDictionary(
      db,
      Readable.from([kanji.replace(">eat<", ">changed<")]),
      { kind: "kanji", version: "k2" },
    );
    assert.equal((await repo.kanji("食"))?.meanings[0].text, "eat");
    await importDictionary(
      db,
      Readable.from([words.replace("食べる", "飲べる")]),
      { kind: "jmdict", version: "b" },
    );
    await activateDataset(db, a.id);
    assert.equal((await new PostgresDictionary(db).metadata())?.version, "a");
    assert.equal((await listDatasets(db)).length, 4);
    await assert.rejects(() => activateDataset(db, "missing"));
    assert.equal((await new PostgresDictionary(db).metadata())?.version, "a");
  } finally {
    await db.close();
  }
});
test("custom overlays create an independently activated snapshot and regenerate forms", async () => {
  const { applyEntryOverlays } =
    await import("../packages/dictionary/src/overlays.js");
  const db = new PGlite();
  try {
    await migrate(db);
    const base = await importDictionary(db, Readable.from([words]), {
      kind: "jmdict",
      version: "base",
    });
    const old = new PostgresDictionary(db);
    const original = (await old.entries(["1"]))[0];
    const replacement = structuredClone(original);
    replacement.spellings = ["飲べる"];
    replacement.readings[0].text = "のべる";
    await applyEntryOverlays(
      db,
      base.id,
      [{ op: "replace", entry: replacement }],
      { version: "custom", source: "synthetic test" },
    );
    const current = new PostgresDictionary(db);
    assert.equal((await current.lookup(["飲べる"]))[0].reading, "のべる");
    assert.equal((await current.lookup(["食べる"])).length, 0);
    assert.equal((await old.lookup(["食べる"]))[0].reading, "たべる");
    await assert.rejects(() =>
      applyEntryOverlays(db, base.id, [{ op: "add", entry: original }], {
        version: "bad",
        source: "test",
      }),
    );
    assert.equal(
      (await new PostgresDictionary(db).metadata())?.version,
      "custom",
    );
  } finally {
    await db.close();
  }
});
