/** Replays Ichiran database rows recorded by scripts/oracle/record-ichiran-rows.ts. */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import {
  IchiranStore,
  type IchiranEngine,
  type IchiranSource,
  type KanjiReadingRow,
  type ReadingRow,
  type SeqBundle,
} from "../packages/core/src/ichiran/index.js";

interface Recording {
  counters: number[];
  texts: Record<string, ReadingRow[]>;
  seqs: Record<string, SeqBundle>;
  kanji: Record<string, KanjiReadingRow[]>;
}
/** A request outside the recording fails, so a test cannot pass on missing data. */
export class ReplayIchiranSource implements IchiranSource {
  private r: Recording;
  constructor(file: URL) {
    this.r = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8"));
  }
  private miss(what: string): never {
    throw new Error(`Not in the recorded rows: ${what}; re-record the fixture`);
  }
  async version() {
    return "recorded";
  }
  async fetchTexts(texts: string[]) {
    return texts.flatMap((t) => this.r.texts[t] ?? this.miss(`text ${t}`));
  }
  async fetchSeqs(seqs: number[]) {
    // structuredClone: the store sorts and keeps the bundles it receives
    return seqs.flatMap((s) => (this.r.seqs[s] ? [structuredClone(this.r.seqs[s])] : this.miss(`seq ${s}`)));
  }
  async fetchKanjiReadings(chars: string[]) {
    return new Map(chars.map((c) => [c, this.r.kanji[c] ?? this.miss(`kanji ${c}`)]));
  }
  async fetchCounterSeqs() {
    return this.r.counters;
  }
}
export function replayEngine(): IchiranEngine {
  return {
    store: new IchiranStore(),
    source: new ReplayIchiranSource(new URL("./fixtures/ichimoe/ichiran-rows.json.gz", import.meta.url)),
    dictionary: { version: "ichiran-260118 (recorded rows)", source: "Ichiran release database", entryCount: 0, capabilities: ["ichiran"] },
  };
}
