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
import { romanizeKana, toHiragana } from "../../core/src/kana.js";
import {
  YomichiError,
  type AnalyzeOptions,
  type DictionaryRepository,
} from "../../core/src/types.js";
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
  romanization: { type: "string", enum: ["hepburn", "kunrei"] },
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
    reply
      .status(status)
      .send({
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
          properties: { seq: { type: "string", pattern: "^[0-9]{1,12}$" } },
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
  return app;
}
