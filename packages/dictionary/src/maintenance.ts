import type { Sql } from "./schema.js";
export interface DatasetRecord {
  id: string;
  kind: string;
  version: string;
  source: string;
  sha256: string;
  entryCount: number;
  active: boolean;
}
export async function listDatasets(db: Sql): Promise<DatasetRecord[]> {
  return (
    await db.query<DatasetRecord>(
      `SELECT d.id,d.kind,d.version,d.source,d.sha256,d.entry_count AS "entryCount",(a.dataset_id IS NOT NULL) AS active FROM yomichi_datasets d LEFT JOIN yomichi_active a ON a.dataset_id=d.id ORDER BY d.created_at,d.id`,
    )
  ).rows;
}
/** Atomic rollback/activation of a retained snapshot. Never mutates dataset contents.
 * Supply a dedicated connection, as with importDictionary. */
export async function activateDataset(
  db: Sql,
  datasetId: string,
): Promise<void> {
  await db.query("BEGIN");
  try {
    const result = await db.query<{ kind: string; entry_count: number }>(
      "SELECT kind,entry_count FROM yomichi_datasets WHERE id=$1 FOR SHARE",
      [datasetId],
    );
    const d = result.rows[0];
    if (!d || !["jmdict", "kanji", "ichiran"].includes(d.kind) || d.entry_count < 1)
      throw new Error("Dataset is missing, unsupported or empty");
    await db.query(
      "INSERT INTO yomichi_active(kind,dataset_id) VALUES($1,$2) ON CONFLICT(kind) DO UPDATE SET dataset_id=excluded.dataset_id",
      [d.kind, datasetId],
    );
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  }
}
