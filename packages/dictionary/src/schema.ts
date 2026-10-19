export interface Sql {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
}
export async function migrate(db: Sql): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS yomichi_datasets(id text PRIMARY KEY,kind text NOT NULL,version text NOT NULL,source text NOT NULL,sha256 text NOT NULL DEFAULT '',entry_count integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS yomichi_active(kind text PRIMARY KEY,dataset_id text NOT NULL REFERENCES yomichi_datasets(id))`,
    `CREATE TABLE IF NOT EXISTS yomichi_entries(dataset_id text NOT NULL REFERENCES yomichi_datasets(id) ON DELETE CASCADE,id text NOT NULL,data jsonb NOT NULL,PRIMARY KEY(dataset_id,id))`,
    `CREATE TABLE IF NOT EXISTS yomichi_forms(dataset_id text NOT NULL,entry_id text NOT NULL,surface text NOT NULL,reading text NOT NULL,lemma text NOT NULL,pos jsonb NOT NULL,sense_indices jsonb NOT NULL,priority integer NOT NULL,steps jsonb NOT NULL,cost real NOT NULL,FOREIGN KEY(dataset_id,entry_id) REFERENCES yomichi_entries(dataset_id,id) ON DELETE CASCADE)`,
    `CREATE INDEX IF NOT EXISTS yomichi_forms_lookup ON yomichi_forms(dataset_id,surface text_pattern_ops)`,
    `CREATE TABLE IF NOT EXISTS yomichi_kanji(dataset_id text NOT NULL REFERENCES yomichi_datasets(id) ON DELETE CASCADE,character text NOT NULL,data jsonb NOT NULL,PRIMARY KEY(dataset_id,character))`,
  ];
  for (const sql of statements) await db.query(sql);
}
