/** Imports an Ichiran-model dataset (kind "ichiran") and activates it.
 *
 *   import:ichiran -- JMdict_e.gz VERSION [--kanjidic kanjidic2.xml.gz]
 *                     [--jmdictdb DIR] [--ichiran-data DIR]
 *   import:ichiran-db -- postgres://.../ichiran VERSION
 *
 * The first form builds the model from JMdict like Ichiran's full-init (needs
 * about 5 GB of memory for the complete JMdict). The second copies an existing
 * Ichiran database, e.g. a restored upstream release dump. */
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { createGunzip } from "node:zlib";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createPool } from "./connection.js";
import { migrate } from "./schema.js";
import { parseNodes } from "./xml.js";
import { buildKanji, buildLexicon, loadJmdictdbRules, readCustomSources } from "./ichiran-build/build.js";
import { copyIchiranDatabase, importIchiranDataset, writeIchiranDataset } from "./ichiran-pg.js";

const args = process.argv.slice(2);
const mode = args[0];
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const positional = args.slice(1).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
const [input, version] = positional;
if (!["jmdict", "database"].includes(mode) || !input || !version) {
  console.error(
    "Usage: import:ichiran -- JMdict_e.gz VERSION [--kanjidic kanjidic2.xml.gz] [--jmdictdb DIR] [--ichiran-data DIR]\n" +
      "       import:ichiran-db -- postgres://user@host/ichiran VERSION",
  );
  process.exit(1);
}
const log = (o: object) => console.error(JSON.stringify(o));
const open = (path: string) => {
  const file = createReadStream(path);
  return path.endsWith(".gz") ? file.pipe(createGunzip()) : file;
};
async function sha256(path: string) {
  const h = createHash("sha256");
  for await (const c of createReadStream(path)) h.update(c);
  return h.digest("hex");
}

const pool = createPool();
const client = await pool.connect();
try {
  await migrate(client);
  await client.query("SET statement_timeout=0");
  if (mode === "jmdict") {
    const started = performance.now();
    const dataDir = opt("--ichiran-data") ?? fileURLToPath(new URL("../data/ichiran", import.meta.url));
    const lex = await buildLexicon(parseNodes(open(input), "jmdict"), {
      custom: await readCustomSources(dataDir),
      rules: opt("--jmdictdb") ? await loadJmdictdbRules(opt("--jmdictdb")!) : undefined,
      onProgress: (phase, detail) => log({ phase, detail, ms: Math.round(performance.now() - started) }),
    });
    const kanjidic = opt("--kanjidic");
    const kanji = kanjidic ? await buildKanji(lex, parseNodes(open(kanjidic), "kanji")) : null;
    const result = await importIchiranDataset(
      client,
      {
        version,
        source: `EDRDG JMdict${kanjidic ? " + KANJIDIC2" : ""}; Ichiran-model build${opt("--jmdictdb") ? " (JMdictDB conjugation rules)" : ""}`,
        sha256: await sha256(input),
      },
      (id) => writeIchiranDataset(client, id, lex, kanji, (table, rows) => log({ table, rows })),
    );
    console.log(JSON.stringify(result));
  } else {
    const source = new pg.Client({ connectionString: input });
    await source.connect();
    try {
      const result = await importIchiranDataset(client, { version, source: `Ichiran database copy (${new URL(input).pathname.slice(1)})` }, (id) =>
        copyIchiranDatabase(client, source, id, (table, rows) => log({ table, rows })),
      );
      console.log(JSON.stringify(result));
    } finally {
      await source.end();
    }
  }
} finally {
  client.release();
  await pool.end();
}
