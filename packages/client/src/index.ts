import type {
  VerbInflectionRequest,
  DictionaryVerbInflections,
  VerbInflectionCandidate,
} from "../../core/src/verb-inflection-lookup.js";
export type {
  VerbInflectionRequest,
  DictionaryVerbInflections,
  VerbInflectionCandidate,
};
export type {
  VerbInflectionDetail,
  VerbVariant,
} from "../../core/src/verb-inflections.js";
import type { KanjiAlignment } from "../../dictionary/src/alignment.js";
import type { KanaRepresentation } from "../../core/src/kana.js";
import type { TextSegment } from "../../core/src/characters.js";
import type { KanjiReadingMatch } from "../../dictionary/src/kanji.js";
import type { KanjiWordStatistics } from "../../dictionary/src/repository.js";
import type {
  Analysis,
  AnalyzeOptions,
  Entry,
  Kanji,
  Romanization,
} from "../../core/src/types.js";
import type {
  IchiranMethodName,
  IchiranResult,
} from "../../core/src/ichiran/index.js";
export type { Analysis, AnalyzeOptions, Entry, Kanji, IchiranResult };
export class YomichiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public candidates: VerbInflectionCandidate[] = [],
  ) {
    super(message);
  }
}
export class YomichiClient {
  private base: string;
  constructor(
    baseUrl: string,
    private options: {
      apiKey?: string;
      fetch?: typeof fetch;
      timeoutMs?: number;
    } = {},
  ) {
    this.base = baseUrl.replace(/\/$/, "");
  }
  private async request<T>(path: string, body?: unknown): Promise<T> {
    const response = await (this.options.fetch ?? fetch)(this.base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(this.options.apiKey ? { "x-api-key": this.options.apiKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 20000),
    });
    const data = await response.json();
    if (!response.ok)
      throw new YomichiClientError(
        response.status,
        data.error?.code ?? "HTTP_ERROR",
        data.error?.message ?? `HTTP ${response.status}`,
        data.candidates ?? [],
      );
    return data as T;
  }
  verbInflections(options: VerbInflectionRequest) {
    return this.request<DictionaryVerbInflections>(
      "/v1/verbs/inflections",
      options,
    );
  }
  analyze(options: AnalyzeOptions) {
    return this.request<Analysis>("/v1/analyze", options);
  }
  search(q: string, limit = 20) {
    return this.request<{ items: Entry[] }>(
      `/v1/words/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    );
  }
  word(id: string) {
    return this.request<Entry>(`/v1/words/${encodeURIComponent(id)}`);
  }
  kanji(char: string) {
    return this.request<Kanji>(`/v1/kanji/${encodeURIComponent(char)}`);
  }
  reading(text: string, mode: "kana" | "analyze" = "analyze") {
    return this.request<{ reading: string }>("/v1/reading", { text, mode });
  }
  romanize(
    text: string,
    romanization: Romanization = "hepburn",
    mode: "kana" | "analyze" = "analyze",
  ) {
    return this.request<{ romanization: string }>("/v1/romanize", {
      text,
      romanization,
      mode,
    });
  }
  deromanize(text: string) {
    return this.request<KanaRepresentation>("/v1/deromanize", { text });
  }
  suggest(text: string, limit = 20) {
    return this.request<{ representation: KanaRepresentation; items: Entry[] }>(
      "/v1/suggest",
      { text, limit },
    );
  }
  numbers(text: string, legal = false) {
    return this.request<{ value: string; kanji: string; reading: string }>(
      "/v1/numbers",
      { text, legal },
    );
  }
  characters(text: string) {
    return this.request<{
      normalized: string;
      moraLength: number;
      kanjiMask: string;
      offsetUnit: "utf16";
      segments: TextSegment[];
    }>("/v1/characters", { text });
  }
  kanjiWords(char: string, limit = 20) {
    return this.request<{ items: Entry[] }>(
      `/v1/kanji/${encodeURIComponent(char)}/words?limit=${limit}`,
    );
  }
  kanjiStats(char: string) {
    return this.request<KanjiWordStatistics>(
      `/v1/kanji/${encodeURIComponent(char)}/stats`,
    );
  }
  kanjiReadings(char: string, reading: string) {
    return this.request<{ items: KanjiReadingMatch[] }>(
      `/v1/kanji/${encodeURIComponent(char)}/readings?reading=${encodeURIComponent(reading)}`,
    );
  }
  alignKanji(word: string, reading: string, includeNanori = true) {
    return this.request<KanjiAlignment>("/v1/kanji/align", {
      word,
      reading,
      includeNanori,
    });
  }
  /** Everything ichi.moe shows for a text (requires the Ichiran engine). */
  ichiranAnalyze(
    text: string,
    options: { method?: IchiranMethodName; limit?: number } = {},
  ) {
    return this.request<IchiranResult>("/v1/ichiran/analyze", {
      text,
      ...options,
    });
  }
  /** Ichiran romanize* JSON (requires an Ichiran-model dataset). */
  ichiranSegment(
    text: string,
    options: { method?: string; limit?: number } = {},
  ) {
    return this.request<{ result: unknown }>("/v1/ichiran/segment", {
      text,
      ...options,
    });
  }
  ichiranRomanize(
    text: string,
    options: { method?: string; info?: boolean } = {},
  ) {
    return this.request<{
      romanization: string;
      info?: { word: string; gloss: string }[];
    }>("/v1/ichiran/romanize", { text, ...options });
  }
  ichiranWord(
    text: string,
    options: { reading?: string; root?: boolean } = {},
  ) {
    const q = new URLSearchParams({ text });
    if (options.reading !== undefined) q.set("reading", options.reading);
    if (options.root !== undefined) q.set("root", String(options.root));
    return this.request<{ items: unknown[] }>(`/v1/ichiran/word?${q}`);
  }
  ichiranKanji(char: string) {
    return this.request<Record<string, unknown>>(
      `/v1/ichiran/kanji/${encodeURIComponent(char)}`,
    );
  }
  ichiranMatchReadings(word: string, reading: string) {
    return this.request<{ items: unknown[] }>("/v1/ichiran/match-readings", {
      word,
      reading,
    });
  }
}
