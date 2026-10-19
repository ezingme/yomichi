export type Romanization = import("./kana.js").RomanizationScheme;
export interface Sense {
  pos: string[];
  glosses: { language: string; text: string }[];
  restrictions: string[];
  readingRestrictions: string[];
}
export interface Entry {
  id: string;
  spellings: string[];
  spellingPriorities?: Record<string, number>;
  readings: {
    text: string;
    restrictions: string[];
    priority?: number;
    noKanji?: boolean;
  }[];
  senses: Sense[];
  priority: number;
}
export interface Lexeme {
  surface: string;
  reading: string;
  entryId: string;
  lemma: string;
  pos: string[];
  priority: number;
  senseIndices: number[];
  conjugationSteps: string[];
  cost: number;
}
export interface Kanji {
  character: string;
  strokeCounts: number[];
  grade: number | null;
  frequency: number | null;
  readings: { type: string; text: string }[];
  meanings: { language: string; text: string }[];
}
export interface DictionaryMetadata {
  version: string;
  source: string;
  entryCount: number;
  capabilities: string[];
}
export interface DictionaryRepository {
  metadata(): Promise<DictionaryMetadata | null>;
  lookup(forms: string[]): Promise<Lexeme[]>;
  entries(ids: string[]): Promise<Entry[]>;
  search(query: string, limit: number): Promise<Entry[]>;
  kanji(character: string): Promise<Kanji | null>;
}
export interface AnalyzeOptions {
  text: string;
  limit?: number;
  romanization?: Romanization;
  includeGlosses?: boolean;
  includeConjugation?: boolean;
  segmentationHints?: number[];
  /** Server engine selection: Ichiran when its dataset is active ("auto"). */
  engine?: "auto" | "ichiran" | "legacy";
}
export interface Token {
  surface: string;
  start: number;
  end: number;
  kind: "word" | "unknown" | "separator";
  lemma: string | null;
  reading: string | null;
  romanization: string | null;
  entryId: string | null;
  pos: string[];
  senses: Sense[];
  senseIndices: number[];
  conjugationSteps: string[];
  components: Token[];
  alternatives: Lexeme[];
}
export interface Candidate {
  score: number;
  tokens: Token[];
}
export interface Analysis {
  text: string;
  offsetUnit: "utf16";
  dictionary: DictionaryMetadata;
  engineVersion: string;
  candidates: Candidate[];
  warnings: string[];
}
export class YomichiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "YomichiError";
  }
}
