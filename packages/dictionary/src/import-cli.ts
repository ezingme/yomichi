import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createPool } from "./connection.js";
import { migrate } from "./schema.js";
import { importDictionary } from "./import.js";
const [kind, path, version] = process.argv.slice(2);
if (!["jmdict", "kanji"].includes(kind) || !path || !version) {
  console.error(
    "Usage: import:jmdict|import:kanji -- /path/to/dictionary.xml[.gz] VERSION",
  );
  process.exit(1);
}
const pool = createPool();
const client = await pool.connect();
try {
  await migrate(client);
  await client.query("SET statement_timeout=0");
  const file = createReadStream(path);
  const source = path.endsWith(".gz") ? file.pipe(createGunzip()) : file;
  file.on("error", (e) => source.destroy(e));
  const result = await importDictionary(client, source, {
    kind: kind as "jmdict" | "kanji",
    version,
    onProgress: (n) => {
      if (n % 10000 === 0) console.error(`${n} entries imported`);
    },
  });
  console.log(JSON.stringify(result));
} finally {
  client.release();
  await pool.end();
}
