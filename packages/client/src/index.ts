import type {
  Analysis,
  AnalyzeOptions,
  Entry,
  Kanji,
  Romanization,
} from "../../core/src/types.js";
export type { Analysis, AnalyzeOptions, Entry, Kanji };
export class YomichiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
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
      );
    return data as T;
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
}
