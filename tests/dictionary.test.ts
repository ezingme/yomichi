import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { migrate } from "../packages/dictionary/src/schema.js";
import { importDictionary } from "../packages/dictionary/src/import.js";
import { PostgresDictionary } from "../packages/dictionary/src/repository.js";
import { parseEntries } from "../packages/dictionary/src/xml.js";
const fixture = await readFile(
  new URL("./fixtures/jmdict.xml", import.meta.url),
  "utf8",
);
test("XML parser preserves POS entities, reading restrictions and language", async () => {
  const words = [];
  for await (const w of parseEntries(Readable.from([fixture]), "jmdict"))
    words.push(w as any);
  assert.equal(words[0].senses[0].pos[0], "v1");
  assert.equal(words[0].senses[0].glosses[1].language, "dut");
  assert.deepEqual(words[1].readings[0].restrictions, ["明日"]);
  assert.deepEqual(words[1].senses[1].pos, ["n"]);
});
test("SQL import activates atomically; failed replacement preserves working data", async () => {
  const db = new PGlite();
  try {
    await migrate(db);
    assert.equal(await new PostgresDictionary(db).metadata(), null);
    const repo = new PostgresDictionary(db);
    await importDictionary(db, Readable.from([fixture]), {
      kind: "jmdict",
      version: "test-v1",
    });
    assert.equal((await repo.metadata())?.entryCount, 2);
    assert.equal((await repo.lookup(["食べました"]))[0].reading, "たべました");
    assert.ok(!(await repo.lookup(["朝"])).some((f) => f.reading === "あした"));
    assert.equal((await repo.search("食", 10))[0].id, "100");
    assert.equal(
      (await repo.entries(["100"]))[0].senses[0].glosses[0].text,
      "to eat",
    );
    await assert.rejects(() =>
      importDictionary(db, Readable.from(["<JMdict><entry>"]), {
        kind: "jmdict",
        version: "bad",
      }),
    );
    assert.equal((await repo.metadata())?.version, "test-v1");
    await assert.rejects(() =>
      importDictionary(db, Readable.from(["<JMdict/>"]), {
        kind: "jmdict",
        version: "empty",
      }),
    );
    assert.equal((await repo.metadata())?.version, "test-v1");
    const kanji = await readFile(
      new URL("./fixtures/kanji.xml", import.meta.url),
    );
    await importDictionary(db, Readable.from([kanji]), {
      kind: "kanji",
      version: "kanji-test",
    });
    assert.equal((await repo.kanji("猫"))?.strokeCounts[0], 11);
    assert.equal((await repo.kanji("猫"))?.meanings[1].language, "fr");
    assert.ok(
      (await new PostgresDictionary(db).metadata())?.capabilities.includes(
        "kanji",
      ),
    );
  } finally {
    await db.close();
  }
});
test("a repository pins its original dataset across active version switches", async () => {
  const db = new PGlite();
  try {
    await migrate(db);
    await importDictionary(db, Readable.from([fixture]), {
      kind: "jmdict",
      version: "old",
    });
    const old = new PostgresDictionary(db);
    assert.equal((await old.metadata())?.version, "old");
    await importDictionary(
      db,
      Readable.from([fixture.replaceAll("食べる", "飲べる")]),
      { kind: "jmdict", version: "new" },
    );
    assert.equal((await old.metadata())?.version, "old");
    assert.equal((await old.lookup(["食べる"]))[0].lemma, "食べる");
    assert.equal((await new PostgresDictionary(db).metadata())?.version, "new");
  } finally {
    await db.close();
  }
});
