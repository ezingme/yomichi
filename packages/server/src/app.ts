import { alignKanjiReadings } from "../../dictionary/src/alignment.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";
import { timingSafeEqual } from "node:crypto";
import {
  analyze,
  ENGINE_VERSION,
  validateOptions,
} from "../../core/src/engine.js";
import {
  deromanize,
  partialSuggestions,
  romanizeKana,
  toHiragana,
} from "../../core/src/kana.js";
import {
  YomichiError,
  type AnalyzeOptions,
  type DictionaryRepository,
} from "../../core/src/types.js";
import {
  basicSplit,
  normalizeJapanese,
  moraLength,
  kanjiMask,
} from "../../core/src/characters.js";
import {
  numberToKana,
  numberToKanji,
  parseJapaneseNumber,
} from "../../core/src/numbers.js";
import { matchKanjiReading } from "../../dictionary/src/kanji.js";
import type { KanjiWordStatistics } from "../../dictionary/src/repository.js";
import type { Entry } from "../../core/src/types.js";
type ExtendedRepository = DictionaryRepository & {
  kanjiWords?: (character: string, limit?: number) => Promise<Entry[]>;
  kanjiStats?: (character: string) => Promise<KanjiWordStatistics>;
};
export interface ServerOptions {
  repository: () => DictionaryRepository;
  apiKey?: string;
  origins?: string[];
  rateMax?: number;
}
const text = { type: "string", minLength: 1, maxLength: 1000 };
const fields = {
  text,
  limit: { type: "integer", minimum: 1, maximum: 5 },
  romanization: {
    type: "string",
    enum: [
      "hepburn",
      "kunrei",
      "hepburn-basic",
      "hepburn-simple",
      "hepburn-passport",
      "hepburn-traditional",
      "hepburn-modified",
      "kunrei-shiki",
    ],
  },
  includeGlosses: { type: "boolean" },
  includeConjugation: { type: "boolean" },
  segmentationHints: {
    type: "array",
    maxItems: 501,
    uniqueItems: true,
    items: { type: "integer", minimum: 0 },
  },
};
const body = {
  type: "object",
  required: ["text"],
  additionalProperties: false,
  properties: fields,
};
export async function buildApp(options: ServerOptions) {
  const app = Fastify({
    bodyLimit: 16384,
    logger: false,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
    requestTimeout: 20000,
  });
  await app.register(cors, {
    origin: options.origins ?? [],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["content-type", "x-api-key"],
  });
  await app.register(rateLimit, {
    max: options.rateMax ?? 60,
    timeWindow: "1 minute",
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Yomichi API",
        description:
          "Japanese text analysis — alpha; not yet Ichiran equivalent.",
        version: ENGINE_VERSION,
      },
      components: {
        securitySchemes: {
          apiKey: { type: "apiKey", in: "header", name: "x-api-key" },
        },
      },
      ...(options.apiKey ? { security: [{ apiKey: [] }] } : {}),
    },
  });
  await app.register(swaggerUI, { routePrefix: "/docs" });
  app.setErrorHandler((e, _req, reply) => {
    const error = e as Error & { validation?: unknown; statusCode?: number };
    const status =
      error instanceof YomichiError
        ? error.status
        : error.validation
          ? 400
          : (error.statusCode ?? 500);
    reply.status(status).send({
      error: {
        code:
          error instanceof YomichiError
            ? error.code
            : status === 400
              ? "INVALID_REQUEST"
              : status === 429
                ? "RATE_LIMITED"
                : status >= 500
                  ? "INTERNAL_ERROR"
                  : "REQUEST_ERROR",
        message:
          status >= 500 && !(error instanceof YomichiError)
            ? "Service unavailable. Check server configuration."
            : error.message,
      },
    });
  });
  app.addHook("onRequest", async (req) => {
    if (
      !options.apiKey ||
      !req.url.startsWith("/v1/") ||
      req.method === "OPTIONS"
    )
      return;
    const supplied = req.headers["x-api-key"];
    const expected = Buffer.from(options.apiKey),
      actual = Buffer.from(typeof supplied === "string" ? supplied : "");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new YomichiError(
        "UNAUTHORIZED",
        "A valid API key is required.",
        401,
      );
  });
  let active = 0;
  async function run(input: AnalyzeOptions) {
    if (active >= 8)
      throw new YomichiError(
        "BUSY",
        "Analysis capacity reached; retry shortly.",
        429,
      );
    active++;
    try {
      return await analyze(options.repository(), input);
    } finally {
      active--;
    }
  }
  app.get("/healthz", async () => ({ status: "ok", version: ENGINE_VERSION }));
  app.get("/readyz", async (_req, reply) => {
    const d = await options.repository().metadata();
    return reply
      .code(d?.entryCount ? 200 : 503)
      .send({ ready: !!d?.entryCount, dictionary: d });
  });
  app.get("/openapi.json", async () => app.swagger());
  app.post<{ Body: AnalyzeOptions }>(
    "/v1/analyze",
    { schema: { body, summary: "Analyze Japanese text", tags: ["analysis"] } },
    async (req) => run(req.body),
  );
  for (const route of ["reading", "romanize"] as const) {
    app.post<{ Body: AnalyzeOptions & { mode?: "analyze" | "kana" } }>(
      "/v1/" + route,
      {
        schema: {
          body: {
            ...body,
            properties: {
              ...fields,
              mode: { type: "string", enum: ["analyze", "kana"] },
            },
          },
          summary:
            route === "reading" ? "Get kana reading" : "Romanize Japanese",
          tags: ["analysis"],
        },
      },
      async (req) => {
        validateOptions(req.body);
        if (req.body.mode === "kana") {
          const reading = toHiragana(req.body.text);
          return route === "reading"
            ? { reading, mode: "kana" }
            : {
                romanization: romanizeKana(reading, req.body.romanization),
                mode: "kana",
              };
        }
        const result = await run({
          ...req.body,
          limit: 1,
          includeGlosses: false,
        });
        const tokens = result.candidates[0].tokens;
        return {
          ...(route === "reading"
            ? { reading: tokens.map((t) => t.reading ?? t.surface).join("") }
            : {
                romanization: tokens
                  .map((t) => t.romanization ?? t.surface)
                  .join(" "),
              }),
          tokens,
          warnings: result.warnings,
        };
      },
    );
  }
  app.get<{ Querystring: { q: string; limit?: string } }>(
    "/v1/words/search",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["q"],
          properties: {
            q: { type: "string", minLength: 1, maxLength: 100 },
            limit: { type: "string", pattern: "^(?:[1-9]|[1-4][0-9]|50)$" },
          },
        },
        tags: ["dictionary"],
      },
    },
    async (req) => {
      const repo = options.repository();
      if (!(await repo.metadata())?.entryCount)
        throw new YomichiError(
          "DICTIONARY_NOT_READY",
          "Import JMdict first.",
          503,
        );
      return {
        items: await repo.search(req.query.q, Number(req.query.limit ?? 20)),
      };
    },
  );
  app.get<{ Params: { seq: string } }>(
    "/v1/words/:seq",
    {
      schema: {
        params: {
          type: "object",
          required: ["seq"],
          properties: {
            seq: { type: "string", pattern: "^[A-Za-z0-9_-]{1,128}$" },
          },
        },
        tags: ["dictionary"],
      },
    },
    async (req) => {
      const repo = options.repository();
      if (!(await repo.metadata())?.entryCount)
        throw new YomichiError(
          "DICTIONARY_NOT_READY",
          "Import JMdict first.",
          503,
        );
      const e = (await repo.entries([req.params.seq]))[0];
      if (!e) throw new YomichiError("NOT_FOUND", "Word not found.", 404);
      return e;
    },
  );
  app.get<{ Params: { char: string } }>(
    "/v1/kanji/:char",
    {
      schema: {
        params: {
          type: "object",
          required: ["char"],
          properties: { char: { type: "string", minLength: 1, maxLength: 2 } },
        },
        tags: ["dictionary"],
      },
    },
    async (req) => {
      if (
        Array.from(req.params.char).length !== 1 ||
        !/^\p{Script=Han}$/u.test(req.params.char)
      )
        throw new YomichiError("INVALID_KANJI", "Supply one kanji character.");
      const repo = options.repository();
      if (!(await repo.metadata())?.capabilities.includes("kanji"))
        throw new YomichiError(
          "KANJI_NOT_READY",
          "Import KANJIDIC2 first.",
          503,
        );
      const k = await repo.kanji(req.params.char);
      if (!k) throw new YomichiError("NOT_FOUND", "Kanji not found.", 404);
      return k;
    },
  );
  const conversionBody = (
    properties: Record<string, unknown>,
    required = ["text"],
  ) => ({
    type: "object",
    additionalProperties: false,
    required,
    properties,
  });
  const shortText = { type: "string", minLength: 1, maxLength: 100 };
  app.post<{ Body: { text: string } }>(
    "/v1/deromanize",
    {
      schema: {
        body: conversionBody({ text: shortText }),
        tags: ["conversion"],
      },
    },
    async (req) => {
      const result = deromanize(req.body.text);
      if (!result)
        throw new YomichiError(
          "INVALID_ROMAJI",
          "Supply complete Latin romanized syllables.",
        );
      return result;
    },
  );
  app.post<{ Body: { text: string; limit?: number } }>(
    "/v1/suggest",
    {
      schema: {
        body: conversionBody({
          text: shortText,
          limit: { type: "integer", minimum: 1, maximum: 50 },
        }),
        tags: ["dictionary"],
      },
    },
    async (req) => {
      const representation =
        deromanize(req.body.text) ?? partialSuggestions(req.body.text);
      if (!representation)
        throw new YomichiError(
          "INVALID_ROMAJI",
          "Supply complete Latin romanized syllables.",
        );
      const repo = options.repository();
      if (!(await repo.metadata())?.entryCount)
        throw new YomichiError(
          "DICTIONARY_NOT_READY",
          "Import JMdict first.",
          503,
        );
      const limit = req.body.limit ?? 20;
      const found = new Map<string, Entry>();
      // Sequential, bounded dictionary queries; returned suggestions are real entries.
      for (const kana of [
        ...representation.hiragana,
        ...representation.katakana,
      ]) {
        for (const item of await repo.search(kana, limit))
          if (!found.has(item.id)) found.set(item.id, item);
        if (found.size >= limit) break;
      }
      return { representation, items: [...found.values()].slice(0, limit) };
    },
  );
  app.post<{ Body: { text: string; legal?: boolean } }>(
    "/v1/numbers",
    {
      schema: {
        body: conversionBody({
          text: { ...shortText, maxLength: 32 },
          legal: { type: "boolean" },
        }),
        tags: ["conversion"],
      },
    },
    async (req) => {
      const value = parseJapaneseNumber(req.body.text);
      if (value === null || value >= 10n ** 20n)
        throw new YomichiError(
          "INVALID_NUMBER",
          "Supply a nonnegative Japanese integer smaller than 10^20.",
        );
      return {
        value: value.toString(),
        kanji: numberToKanji(value, { legal: req.body.legal }),
        reading: numberToKana(value),
      };
    },
  );
  app.post<{ Body: { text: string } }>(
    "/v1/characters",
    {
      schema: { body: conversionBody({ text }), tags: ["conversion"] },
    },
    async (req) => ({
      normalized: normalizeJapanese(req.body.text),
      moraLength: moraLength(req.body.text),
      kanjiMask: kanjiMask(req.body.text),
      offsetUnit: "utf16",
      segments: basicSplit(req.body.text),
    }),
  );
  app.post<{
    Body: { word: string; reading: string; includeNanori?: boolean };
  }>(
    "/v1/kanji/align",
    {
      schema: {
        body: conversionBody(
          {
            word: shortText,
            reading: shortText,
            includeNanori: { type: "boolean" },
          },
          ["word", "reading"],
        ),
        tags: ["dictionary"],
      },
    },
    async (req) => {
      const repo = options.repository();
      if (!(await repo.metadata())?.capabilities.includes("kanji"))
        throw new YomichiError(
          "KANJI_NOT_READY",
          "Import KANJIDIC2 first.",
          503,
        );
      const characters = [
        ...new Set(
          [...req.body.word].filter((c) => /^\p{Script=Han}$/u.test(c)),
        ),
      ];
      const records = await Promise.all(
        characters.map(
          async (character) =>
            [character, await repo.kanji(character)] as const,
        ),
      );
      const dictionary = new Map(
        records.filter(
          (pair): pair is readonly [string, NonNullable<(typeof pair)[1]>] =>
            pair[1] !== null,
        ),
      );
      return alignKanjiReadings(req.body.word, req.body.reading, dictionary, {
        maxWordLength: 100,
        maxReadingLength: 100,
        maxStates: 20000,
        includeNanori: req.body.includeNanori,
      });
    },
  );
  for (const operation of ["words", "stats", "readings"] as const) {
    app.get<{
      Params: { char: string };
      Querystring: { limit?: string; reading?: string };
    }>(
      `/v1/kanji/:char/${operation}`,
      {
        schema: {
          params: {
            type: "object",
            required: ["char"],
            properties: {
              char: { type: "string", minLength: 1, maxLength: 2 },
            },
          },
          querystring: {
            type: "object",
            additionalProperties: false,
            ...(operation === "readings" ? { required: ["reading"] } : {}),
            properties:
              operation === "words"
                ? {
                    limit: {
                      type: "string",
                      pattern: "^(?:[1-9]|[1-4][0-9]|50)$",
                    },
                  }
                : operation === "readings"
                  ? { reading: shortText }
                  : {},
          },
          tags: ["dictionary"],
        },
      },
      async (req) => {
        if (!/^\p{Script=Han}$/u.test(req.params.char))
          throw new YomichiError(
            "INVALID_KANJI",
            "Supply one kanji character.",
          );
        const repo = options.repository() as ExtendedRepository;
        const metadata = await repo.metadata();
        if (operation === "readings") {
          if (!metadata?.capabilities.includes("kanji"))
            throw new YomichiError(
              "KANJI_NOT_READY",
              "Import KANJIDIC2 first.",
              503,
            );
          const kanji = await repo.kanji(req.params.char);
          if (!kanji)
            throw new YomichiError("NOT_FOUND", "Kanji not found.", 404);
          return { items: matchKanjiReading(kanji, req.query.reading!) };
        }
        if (!metadata?.entryCount)
          throw new YomichiError(
            "DICTIONARY_NOT_READY",
            "Import JMdict first.",
            503,
          );
        if (operation === "words" && repo.kanjiWords)
          return {
            items: await repo.kanjiWords(
              req.params.char,
              Number(req.query.limit ?? 20),
            ),
          };
        if (operation === "stats" && repo.kanjiStats)
          return repo.kanjiStats(req.params.char);
        throw new YomichiError(
          "CAPABILITY_UNAVAILABLE",
          "This repository does not support kanji word statistics.",
          501,
        );
      },
    );
  }
  return app;
}
