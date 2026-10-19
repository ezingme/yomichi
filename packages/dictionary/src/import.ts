import { randomUUID, createHash } from "node:crypto";
import { parseEntries } from "./xml.js";
import type { Sql } from "./schema.js";
import { generateForms } from "../../core/src/conjugation.js";
import type { Entry, Kanji } from "../../core/src/types.js";
export interface ImportOptions {
  kind: "jmdict" | "kanji";
  version: string;
  onProgress?: (count: number) => void;
}
/** Supply a dedicated SQL connection: transaction must never span pooled connections. */
export async function importDictionary(
  db: Sql,
  source: AsyncIterable<Buffer | string>,
  options: ImportOptions,
) {
  const id = randomUUID(),
    hash = createHash("sha256");
  let count = 0;
  const batch: (Entry | Kanji)[] = [];
  async function* hashed() {
    for await (const c of source) {
      hash.update(c);
      yield c;
    }
  }
  await db.query("BEGIN");
  try {
    await db.query(
      "INSERT INTO yomichi_datasets(id,kind,version,source) VALUES($1,$2,$3,$4)",
      [
        id,
        options.kind,
        options.version,
        options.kind === "jmdict" ? "EDRDG JMdict" : "EDRDG KANJIDIC2",
      ],
    );
    const flush = async () => {
      if (!batch.length) return;
      if (options.kind === "jmdict") {
        const words = batch as Entry[];
        await db.query(
          `INSERT INTO yomichi_entries(dataset_id,id,data) SELECT $1,x.id,x.data FROM jsonb_to_recordset($2::jsonb) AS x(id text,data jsonb)`,
          [id, JSON.stringify(words.map((w) => ({ id: w.id, data: w })))],
        );
        const forms = words.flatMap(generateForms);
        for (let n = 0; n < forms.length; n += 1000)
          await db.query(
            `INSERT INTO yomichi_forms(dataset_id,entry_id,surface,reading,lemma,pos,sense_indices,priority,steps,cost) SELECT $1,x."entryId",x.surface,x.reading,x.lemma,x.pos,x."senseIndices",x.priority,x."conjugationSteps",x.cost FROM jsonb_to_recordset($2::jsonb) AS x("entryId" text,surface text,reading text,lemma text,pos jsonb,"senseIndices" jsonb,priority integer,"conjugationSteps" jsonb,cost real)`,
            [id, JSON.stringify(forms.slice(n, n + 1000))],
          );
      } else
        await db.query(
          `INSERT INTO yomichi_kanji(dataset_id,character,data) SELECT $1,x.character,x.data FROM jsonb_to_recordset($2::jsonb) AS x(character text,data jsonb)`,
          [
            id,
            JSON.stringify(
              (batch as Kanji[]).map((k) => ({
                character: k.character,
                data: k,
              })),
            ),
          ],
        );
      batch.length = 0;
      options.onProgress?.(count);
    };
    for await (const entry of parseEntries(hashed(), options.kind)) {
      batch.push(entry);
      count++;
      if (batch.length >= 100) await flush();
    }
    await flush();
    if (!count) throw new Error("Refusing to activate an empty dictionary");
    const sha256 = hash.digest("hex");
    await db.query(
      "UPDATE yomichi_datasets SET entry_count=$2,sha256=$3 WHERE id=$1",
      [id, count, sha256],
    );
    await db.query(
      `INSERT INTO yomichi_active(kind,dataset_id) VALUES($1,$2) ON CONFLICT(kind) DO UPDATE SET dataset_id=excluded.dataset_id`,
      [options.kind, id],
    );
    await db.query("COMMIT");
    return { id, count, sha256 };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}
