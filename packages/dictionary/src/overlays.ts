import { randomUUID, createHash } from "node:crypto";
import type { Entry } from "../../core/src/types.js";
import { generateForms } from "../../core/src/conjugation.js";
import type { Sql } from "./schema.js";
export type EntryOverlay =
  { op: "add" | "replace"; entry: Entry } | { op: "delete"; id: string };
/** Independent custom-loader implementation informed by Ichiran dict-custom.lisp
 * (Timofei Shatrov, MIT). Creates a new immutable dataset; never edits its parent.
 * Dedicated SQL connection required. SHA256 hashes the parent digest + overlay
 * recipe, not upstream XML; the derived source explicitly records the parent ID. */
export async function applyEntryOverlays(
  db: Sql,
  baseId: string,
  overlays: EntryOverlay[],
  options: { version: string; source: string },
): Promise<{ id: string; count: number; sha256: string }> {
  if (!overlays.length || !options.source.trim() || !options.version.trim())
    throw new Error("Overlay, version and source are required");
  const seen = new Set<string>();
  for (const overlay of overlays) {
    if (!overlay || !["add", "replace", "delete"].includes(overlay.op))
      throw new Error("Unknown overlay operation");
    if (
      overlay.op !== "delete" &&
      (!overlay.entry ||
        !Array.isArray(overlay.entry.spellings) ||
        !Array.isArray(overlay.entry.readings) ||
        !Array.isArray(overlay.entry.senses) ||
        !Number.isFinite(overlay.entry.priority))
    )
      throw new Error("Invalid overlay entry shape");
    const id = overlay.op === "delete" ? overlay.id : overlay.entry.id;
    if (
      typeof id !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(id) ||
      seen.has(id)
    )
      throw new Error("Overlay IDs must be nonempty and unique");
    seen.add(id);
    if (
      overlay.op !== "delete" &&
      (!overlay.entry.readings.length ||
        !overlay.entry.senses.length ||
        overlay.entry.readings.some((r) => !r.text))
    )
      throw new Error("Invalid overlay entry");
  }
  const id = randomUUID();
  await db.query("BEGIN");
  try {
    const base = (
      await db.query<{ sha256: string }>(
        "SELECT sha256 FROM yomichi_datasets WHERE id=$1 AND kind='jmdict' FOR SHARE",
        [baseId],
      )
    ).rows[0];
    if (!base) throw new Error("Base JMdict dataset missing");
    const sha256 = createHash("sha256")
      .update(JSON.stringify({ parent: base.sha256, overlays }))
      .digest("hex");
    await db.query(
      "INSERT INTO yomichi_datasets(id,kind,version,source,sha256) VALUES($1,'jmdict',$2,$3,$4)",
      [
        id,
        options.version,
        `${options.source}; derived from dataset ${baseId}; digest=parent+overlay recipe`,
        sha256,
      ],
    );
    await db.query(
      "INSERT INTO yomichi_entries(dataset_id,id,data) SELECT $1,id,data FROM yomichi_entries WHERE dataset_id=$2",
      [id, baseId],
    );
    await db.query(
      "INSERT INTO yomichi_forms(dataset_id,entry_id,surface,reading,lemma,pos,sense_indices,priority,steps,cost) SELECT $1,entry_id,surface,reading,lemma,pos,sense_indices,priority,steps,cost FROM yomichi_forms WHERE dataset_id=$2",
      [id, baseId],
    );
    for (const overlay of overlays) {
      const entryId = overlay.op === "delete" ? overlay.id : overlay.entry.id;
      const exists =
        (
          await db.query(
            "SELECT id FROM yomichi_entries WHERE dataset_id=$1 AND id=$2",
            [id, entryId],
          )
        ).rows.length > 0;
      if ((overlay.op === "add") === exists)
        throw new Error(`Overlay ${overlay.op} conflict for ${entryId}`);
      if (exists)
        await db.query(
          "DELETE FROM yomichi_entries WHERE dataset_id=$1 AND id=$2",
          [id, entryId],
        );
      if (overlay.op === "delete") continue;
      const entry = overlay.entry;
      await db.query(
        "INSERT INTO yomichi_entries(dataset_id,id,data) VALUES($1,$2,$3::jsonb)",
        [id, entryId, JSON.stringify(entry)],
      );
      const forms = generateForms(entry);
      for (let n = 0; n < forms.length; n += 1000)
        await db.query(
          `INSERT INTO yomichi_forms(dataset_id,entry_id,surface,reading,lemma,pos,sense_indices,priority,steps,cost) SELECT $1,x."entryId",x.surface,x.reading,x.lemma,x.pos,x."senseIndices",x.priority,x."conjugationSteps",x.cost FROM jsonb_to_recordset($2::jsonb) AS x("entryId" text,surface text,reading text,lemma text,pos jsonb,"senseIndices" jsonb,priority integer,"conjugationSteps" jsonb,cost real)`,
          [id, JSON.stringify(forms.slice(n, n + 1000))],
        );
    }
    const count = (
      await db.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM yomichi_entries WHERE dataset_id=$1",
        [id],
      )
    ).rows[0].count;
    if (!count) throw new Error("Refusing empty overlay dataset");
    await db.query("UPDATE yomichi_datasets SET entry_count=$2 WHERE id=$1", [
      id,
      count,
    ]);
    await db.query(
      "INSERT INTO yomichi_active(kind,dataset_id) VALUES('jmdict',$1) ON CONFLICT(kind) DO UPDATE SET dataset_id=excluded.dataset_id",
      [id],
    );
    await db.query("COMMIT");
    return { id, count, sha256 };
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  }
}
