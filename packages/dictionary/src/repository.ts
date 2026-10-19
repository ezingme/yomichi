import type {
  DictionaryRepository,
  DictionaryMetadata,
  Entry,
  Kanji,
  Lexeme,
} from "../../core/src/types.js";
import type { Sql } from "./schema.js";
/** Each instance pins the first active dataset it reads, ensuring consistent analysis across imports. */
export class PostgresDictionary implements DictionaryRepository {
  private dataset: string | undefined;
  private kanjiSnapshot: Promise<string> | undefined;
  private snapshot: Promise<DictionaryMetadata | null> | undefined;
  constructor(private db: Sql) {}
  metadata(): Promise<DictionaryMetadata | null> {
    return (this.snapshot ??= this.loadMetadata());
  }
  private async loadMetadata(): Promise<DictionaryMetadata | null> {
    const result = await this.db.query<{
      id: string;
      version: string;
      source: string;
      entry_count: number;
    }>(
      `SELECT d.* FROM yomichi_datasets d JOIN yomichi_active a ON a.dataset_id=d.id WHERE a.kind='jmdict'`,
    );
    const d = result.rows[0];
    if (!d) return null;
    this.dataset = d.id;
    const k = await this.db.query(
      `SELECT kind FROM yomichi_active WHERE kind='kanji'`,
    );
    return {
      version: d.version,
      source: d.source,
      entryCount: d.entry_count,
      capabilities: ["words", ...(k.rows.length ? ["kanji"] : [])],
    };
  }
  private async id() {
    if (!this.dataset) await this.metadata();
    return this.dataset ?? "";
  }
  async lookup(forms: string[]): Promise<Lexeme[]> {
    if (!forms.length) return [];
    const id = await this.id();
    const out: Lexeme[] = [];
    for (let i = 0; i < forms.length; i += 1000) {
      const r = await this.db.query<Lexeme>(
        `SELECT surface,reading,entry_id AS "entryId",lemma,pos,sense_indices AS "senseIndices",priority,steps AS "conjugationSteps",cost FROM yomichi_forms WHERE dataset_id=$1 AND surface=ANY($2::text[])`,
        [id, forms.slice(i, i + 1000)],
      );
      out.push(...r.rows);
    }
    return out;
  }
  async entries(ids: string[]): Promise<Entry[]> {
    if (!ids.length) return [];
    return (
      await this.db.query<{ data: Entry }>(
        "SELECT data FROM yomichi_entries WHERE dataset_id=$1 AND id=ANY($2::text[])",
        [await this.id(), ids],
      )
    ).rows.map((r) => r.data);
  }
  async search(query: string, limit: number): Promise<Entry[]> {
    const escaped = query.replace(/[\\%_]/g, "\\$&");
    return (
      await this.db.query<{ data: Entry }>(
        `SELECT e.data FROM yomichi_entries e JOIN (SELECT DISTINCT entry_id FROM yomichi_forms WHERE dataset_id=$1 AND surface LIKE $2 AND cost=0 ORDER BY entry_id LIMIT $3) f ON f.entry_id=e.id WHERE e.dataset_id=$1 ORDER BY e.id`,
        [await this.id(), escaped + "%", Math.min(50, Math.max(1, limit))],
      )
    ).rows.map((r) => r.data);
  }
  private kanjiId(): Promise<string> {
    return (this.kanjiSnapshot ??= this.db
      .query<{ dataset_id: string }>(
        "SELECT dataset_id FROM yomichi_active WHERE kind='kanji'",
      )
      .then((r) => r.rows[0]?.dataset_id ?? ""));
  }
  async kanji(character: string): Promise<Kanji | null> {
    return (
      (
        await this.db.query<{ data: Kanji }>(
          "SELECT data FROM yomichi_kanji WHERE dataset_id=$1 AND character=$2",
          [await this.kanjiId(), character],
        )
      ).rows[0]?.data ?? null
    );
  }
  /** Dictionary entries containing the literal character; never generated forms. */
  async kanjiWords(character: string, limit = 20): Promise<Entry[]> {
    if (Array.from(character).length !== 1)
      throw new Error("Expected one character");
    const count = Number.isFinite(limit)
      ? Math.max(1, Math.min(50, Math.floor(limit)))
      : 20;
    return (
      await this.db.query<{ data: Entry }>(
        `SELECT e.data FROM yomichi_entries e WHERE e.dataset_id=$1 AND EXISTS
       (SELECT 1 FROM jsonb_array_elements_text(e.data->'spellings') s WHERE strpos(s.value,$2)>0)
       ORDER BY (e.data->>'priority')::integer DESC,e.id LIMIT $3`,
        [await this.id(), character, count],
      )
    ).rows.map((r) => r.data);
  }
  async kanjiStats(character: string): Promise<KanjiWordStatistics> {
    if (Array.from(character).length !== 1)
      throw new Error("Expected one character");
    const datasetId = await this.id();
    const metadata = await this.metadata();
    const row = (
      await this.db.query<{ total: number; common: number }>(
        `SELECT count(*)::integer AS total,count(*) FILTER (WHERE (e.data->>'priority')::integer > 0)::integer AS common
       FROM yomichi_entries e WHERE e.dataset_id=$1 AND EXISTS
       (SELECT 1 FROM jsonb_array_elements_text(e.data->'spellings') s WHERE strpos(s.value,$2)>0)`,
        [datasetId, character],
      )
    ).rows[0];
    return {
      character,
      entryCount: row.total,
      commonEntryCount: row.common,
      corpusFrequency: null,
      irregularReadingCount: null,
      provenance: {
        datasetId,
        version: metadata?.version ?? null,
        source: metadata?.source ?? null,
        method:
          "Distinct dictionary entries whose spelling contains the character; common means entry priority > 0. Not corpus frequency.",
      },
    };
  }
}
export interface KanjiWordStatistics {
  character: string;
  entryCount: number;
  commonEntryCount: number;
  corpusFrequency: null;
  irregularReadingCount: null;
  provenance: {
    datasetId: string;
    version: string | null;
    source: string | null;
    method: string;
  };
}
