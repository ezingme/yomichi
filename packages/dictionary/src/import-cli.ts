import { createReadStream, existsSync } from "node:fs";
import type pg from "pg";
import { createGunzip } from "node:zlib";
import { createPool } from "./connection.js";
import { migrate } from "./schema.js";
import { importDictionary } from "./import.js";
import { describeError } from "./db-errors.js";
const [kind, path, version] = process.argv.slice(2);
if (!["jmdict", "kanji"].includes(kind) || !path || !version) {
  console.error(
    "Usage: npm run import:jmdict -- data/JMdict_e.gz VERSION\n" +
      "       npm run import:kanji -- data/kanjidic2.xml.gz VERSION\n" +
      "Download JMdict_e.gz / kanjidic2.xml.gz from https://www.edrdg.org/ first.",
  );
  process.exit(1);
}
if (!existsSync(path)) {
  console.error(`File not found: ${path}`);
  process.exit(1);
}
const started = performance.now();
const seconds = () => Math.round((performance.now() - started) / 1000);
console.error(
  `Importing ${kind} from ${path} into DATABASE_URL in one transaction. ` +
    "Nothing changes until it finishes; on a remote database this can take a long time.",
);
const pool = createPool();
let client: pg.PoolClient | undefined;
// Ctrl-C ends the session, so PostgreSQL rolls the transaction back
process.once("SIGINT", () => {
  console.error("\nInterrupted: the import was rolled back; nothing changed.");
  process.exit(130);
});
try {
  client = await pool.connect();
  await migrate(client);
  await client.query("SET statement_timeout=0");
  const file = createReadStream(path);
  const source = path.endsWith(".gz") ? file.pipe(createGunzip()) : file;
  file.on("error", (e) => source.destroy(e));
  const result = await importDictionary(client, source, {
    kind: kind as "jmdict" | "kanji",
    version,
    onProgress: (n) => {
      if (n % 10000 === 0) console.error(`${n} entries imported (${seconds()} s)`);
    },
  });
  console.log(JSON.stringify(result));
  console.error(
    `Done in ${seconds()} s: ${kind} dataset ${result.id} (version ${version}, ${result.count} entries) is now active. Restart the API to use it.`,
  );
} catch (e) {
  const d = describeError(e);
  console.error(`Import failed after ${seconds()} s and was rolled back; nothing changed.\n${d.code}: ${d.message}`);
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
