/** Ichiran-compatible lexicon rows and a synchronous, query-driven store.
 *
 * The ported algorithm (dict.lisp and friends) issues many small database
 * queries. Here it runs synchronously against an in-memory snapshot; any text
 * or sequence number that has not been loaded yet is recorded as a miss and the
 * analysis is re-run after the misses have been fetched from an asynchronous
 * source (PostgreSQL, a captured index, ...). Rows are immutable once loaded. */
import { testWord } from "./chars.js";

export type ReadingTable = "kanji" | "kana";
export interface ReadingRow {
  table: ReadingTable;
  id: number;
  seq: number;
  text: string;
  ord: number;
  common: number | null;
  commonTags: string;
  conjugateP: boolean;
  nokanji: boolean;
  /** best_kana for kanji rows, best_kanji for kana rows */
  best: string | null;
  /** Physical/scan order used to mirror database result order; defaults to id. */
  phys?: number;
}
export interface EntryRow {
  seq: number;
  rootP: boolean;
  nKanji: number;
  nKana: number;
  primaryNokanji: boolean;
}
export interface SenseRow {
  id: number;
  seq: number;
  ord: number;
}
export interface SensePropRow {
  id: number;
  senseId: number;
  seq: number;
  tag: string;
  text: string;
  ord: number;
}
export interface GlossRow {
  senseId: number;
  text: string;
  ord: number;
}
export interface ConjugationRow {
  id: number;
  seq: number;
  from: number;
  via: number | null;
}
export interface ConjPropRow {
  id: number;
  conjId: number;
  conjType: number;
  pos: string;
  neg: boolean | null;
  fml: boolean | null;
}
export interface ConjSourceRow {
  id: number;
  conjId: number;
  text: string;
  sourceText: string;
}
export interface RestrictedRow {
  reading: string;
  text: string;
}
/** Everything the analyzer may ask about one sequence number. */
export interface SeqBundle {
  entry: EntryRow;
  readings: ReadingRow[];
  senses: SenseRow[];
  props: SensePropRow[];
  glosses?: GlossRow[];
  conjugations: ConjugationRow[];
  conjProps: ConjPropRow[];
  conjSources: ConjSourceRow[];
  restricted: RestrictedRow[];
  /** seq values of entries with a conjugation row whose `from` is this seq */
  derived: number[];
}

/** A row of Ichiran's kanji `reading` table (ja_on, ja_kun, ja_onkun, ja_na). */
export interface KanjiReadingRow {
  text: string;
  type: string;
}

export interface IchiranSource {
  fetchTexts(texts: string[]): Promise<ReadingRow[]>;
  fetchSeqs(seqs: number[]): Promise<SeqBundle[]>;
  /** KANJIDIC readings per character, in table order. */
  fetchKanjiReadings(chars: string[]): Promise<Map<string, KanjiReadingRow[]>>;
  /** Distinct seqs having a sense-prop pos=ctr (get-counter-ids). */
  fetchCounterSeqs(): Promise<number[]>;
  /** KANJIDIC character details for kanji-info JSON (optional). */
  fetchKanjiInfo?(char: string): Promise<import("./output.js").KanjiInfo | null>;
  /** Identifies the immutable data snapshot (cache key). */
  version(): Promise<string>;
}

export class MissingData extends Error {
  constructor() {
    super("Ichiran store miss");
  }
}

const byPhys = (a: ReadingRow, b: ReadingRow) =>
  (a.phys ?? a.id) - (b.phys ?? b.id);

export class IchiranStore {
  private texts = new Map<string, ReadingRow[]>();
  private seqs = new Map<number, SeqBundle | null>();
  private counterSeqs: number[] | null = null;
  missingTexts = new Set<string>();
  missingSeqs = new Set<number>();
  missingCounters = false;
  missingKanji = new Set<string>();
  private kanji = new Map<string, KanjiReadingRow[]>();
  private conjById = new Map<number, ConjugationRow>();
  /** Derived per-snapshot caches (suffix cache, counters), built on demand. */
  extras = new Map<string, unknown>();

  hasMisses(): boolean {
    return (
      this.missingTexts.size > 0 ||
      this.missingSeqs.size > 0 ||
      this.missingKanji.size > 0 ||
      this.missingCounters
    );
  }
  clearMisses(): void {
    this.missingTexts.clear();
    this.missingSeqs.clear();
    this.missingKanji.clear();
    this.missingCounters = false;
  }
  addTextRows(texts: string[], rows: ReadingRow[]): void {
    for (const t of texts) if (!this.texts.has(t)) this.texts.set(t, []);
    for (const r of rows) {
      const bucket = this.texts.get(r.text);
      if (bucket && !bucket.some((x) => x.table === r.table && x.id === r.id))
        bucket.push(r);
      else if (!bucket) this.texts.set(r.text, [r]);
    }
    for (const t of texts) this.texts.get(t)!.sort(byPhys);
  }
  addSeqs(seqs: number[], bundles: SeqBundle[]): void {
    for (const b of bundles) {
      b.readings.sort(byPhys);
      this.seqs.set(b.entry.seq, b);
      for (const c of b.conjugations) this.conjById.set(c.id, c);
    }
    for (const s of seqs) if (!this.seqs.has(s)) this.seqs.set(s, null);
  }
  setCounterSeqs(seqs: number[]): void {
    this.counterSeqs = [...seqs].sort((a, b) => a - b);
  }

  /** Rows of the kana_text or kanji_text table (chosen as upstream) with this text. */
  byText(text: string): ReadingRow[] {
    const rows = this.texts.get(text);
    if (rows === undefined) {
      this.missingTexts.add(text);
      return [];
    }
    const table: ReadingTable = testWord(text, "kana") ? "kana" : "kanji";
    return rows.filter((r) => r.table === table);
  }
  /** Rows in either table (used for get-all-readings style queries). */
  byTextAnyTable(text: string): ReadingRow[] {
    const rows = this.texts.get(text);
    if (rows === undefined) {
      this.missingTexts.add(text);
      return [];
    }
    return rows;
  }
  bundle(seq: number): SeqBundle | null {
    const b = this.seqs.get(seq);
    if (b === undefined) {
      this.missingSeqs.add(seq);
      return null;
    }
    return b;
  }
  /** Like bundle() but throws MissingData so callers need not handle partial state. */
  need(seq: number): SeqBundle | null {
    const b = this.seqs.get(seq);
    if (b === undefined) {
      this.missingSeqs.add(seq);
      throw new MissingData();
    }
    return b;
  }
  kanjiReadings(char: string): KanjiReadingRow[] {
    const rows = this.kanji.get(char);
    if (rows === undefined) {
      this.missingKanji.add(char);
      return [];
    }
    return rows;
  }
  addKanji(chars: string[], rows: Map<string, KanjiReadingRow[]>): void {
    for (const c of chars) this.kanji.set(c, rows.get(c) ?? []);
  }
  conjugation(id: number): ConjugationRow | undefined {
    return this.conjById.get(id);
  }
  counterSeqList(): number[] {
    if (!this.counterSeqs) {
      this.missingCounters = true;
      throw new MissingData();
    }
    return this.counterSeqs;
  }
  size(): { texts: number; seqs: number } {
    return { texts: this.texts.size, seqs: this.seqs.size };
  }

  /** Take (and clear) the recorded misses synchronously. Concurrent analyses
   * share one store, so misses must be captured before any await. */
  takeMisses(): Misses {
    const m: Misses = {
      texts: [...this.missingTexts],
      seqs: [...this.missingSeqs],
      kanji: [...this.missingKanji],
      counters: this.missingCounters,
    };
    this.clearMisses();
    return m;
  }
  /** Fetch the given misses from the source. */
  async fill(source: IchiranSource, m: Misses = this.takeMisses()): Promise<void> {
    const [counters, rows, bundles, kanji] = await Promise.all([
      m.counters ? source.fetchCounterSeqs() : null,
      m.texts.length ? source.fetchTexts(m.texts) : null,
      m.seqs.length ? source.fetchSeqs(m.seqs) : null,
      m.kanji.length ? source.fetchKanjiReadings(m.kanji) : null,
    ]);
    if (counters) this.setCounterSeqs(counters);
    if (rows) this.addTextRows(m.texts, rows);
    if (bundles) this.addSeqs(m.seqs, bundles);
    if (kanji) this.addKanji(m.kanji, kanji);
  }
  /** Drop cached rows (keeping derived caches) once the cache grows large. */
  trim(maxTexts = 300000, maxSeqs = 200000): void {
    if (this.texts.size > maxTexts || this.seqs.size > maxSeqs) {
      this.texts.clear();
      this.seqs.clear();
      this.conjById.clear();
    }
  }
}
export interface Misses {
  texts: string[];
  seqs: number[];
  kanji: string[];
  counters: boolean;
}

/** Run a synchronous computation, fetching missing rows until it completes. */
export async function runWithStore<T>(
  store: IchiranStore,
  source: IchiranSource,
  fn: () => T,
  maxRounds = 40,
): Promise<T> {
  for (let round = 0; round < maxRounds; round++) {
    store.clearMisses();
    let result: T | undefined;
    let error: unknown;
    try {
      result = fn();
    } catch (e) {
      error = e;
    }
    if (!store.hasMisses()) {
      if (error !== undefined) throw error;
      return result as T;
    }
    await store.fill(source, store.takeMisses());
  }
  throw new Error("Ichiran store did not converge");
}
