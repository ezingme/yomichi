#!/usr/bin/env node
import { YomichiClient } from "../../client/src/index.js";
import type { Romanization } from "../../core/src/types.js";
const [command, ...raw] = process.argv.slice(2);
const usage =
  "Usage: yomichi analyze|reading|romanize|word|search|kanji|deromanize|suggest|numbers|characters|kanji-words|kanji-stats|kanji-readings|kanji-align TEXT [--limit N] [--scheme NAME] [--kana] [--legal]\nkanji-readings expects CHARACTER READING; kanji-align expects WORD READING.\nEnvironment: YOMICHI_API_URL (default http://localhost:3000), YOMICHI_API_KEY";
const api = new YomichiClient(
  process.env.YOMICHI_API_URL ?? "http://localhost:3000",
  { apiKey: process.env.YOMICHI_API_KEY },
);
try {
  const args: string[] = [];
  let limit: number | undefined,
    scheme: Romanization = "hepburn",
    kana = false,
    legal = false;
  for (let i = 0; i < raw.length; i++) {
    const value = raw[i];
    if (value === "--limit") {
      const next = raw[++i];
      if (!next || !/^[1-9][0-9]*$/.test(next))
        throw new Error("--limit expects a positive integer");
      limit = Number(next);
    } else if (value === "--scheme") {
      const next = raw[++i];
      if (!next) throw new Error("--scheme expects a romanization name");
      scheme = next as Romanization;
    } else if (value === "--kana") kana = true;
    else if (value === "--legal") legal = true;
    else if (value.startsWith("--"))
      throw new Error(`Unknown option: ${value}`);
    else args.push(value);
  }
  const text = args.join(" ");
  if (!text) throw new Error(usage);
  let result: unknown;
  switch (command) {
    case "analyze":
      result = await api.analyze({
        text,
        limit: limit ?? 5,
        romanization: scheme,
      });
      break;
    case "reading":
      result = await api.reading(text, kana ? "kana" : "analyze");
      break;
    case "romanize":
      result = await api.romanize(text, scheme, kana ? "kana" : "analyze");
      break;
    case "word":
      result = await api.word(text);
      break;
    case "search":
      result = await api.search(text, limit);
      break;
    case "kanji":
      result = await api.kanji(text);
      break;
    case "deromanize":
      result = await api.deromanize(text);
      break;
    case "suggest":
      result = await api.suggest(text, limit);
      break;
    case "numbers":
      result = await api.numbers(text, legal);
      break;
    case "characters":
      result = await api.characters(text);
      break;
    case "kanji-words":
      result = await api.kanjiWords(text, limit);
      break;
    case "kanji-stats":
      result = await api.kanjiStats(text);
      break;
    case "kanji-align":
      if (args.length !== 2)
        throw new Error("kanji-align expects WORD READING");
      result = await api.alignKanji(args[0], args[1]);
      break;
    case "kanji-readings":
      if (args.length !== 2)
        throw new Error("kanji-readings expects CHARACTER READING");
      result = await api.kanjiReadings(args[0], args[1]);
      break;
    default:
      throw new Error(usage);
  }
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
