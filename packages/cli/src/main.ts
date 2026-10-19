#!/usr/bin/env node
import { YomichiClient } from "../../client/src/index.js";
const [command, ...args] = process.argv.slice(2);
const text = args.join(" ");
if (
  !text ||
  !["analyze", "reading", "romanize", "word", "search", "kanji"].includes(
    command,
  )
) {
  console.error(
    "Usage: yomichi analyze|reading|romanize|word|search|kanji TEXT\nEnvironment: YOMICHI_API_URL (default http://localhost:3000), YOMICHI_API_KEY",
  );
  process.exit(1);
}
const api = new YomichiClient(
  process.env.YOMICHI_API_URL ?? "http://localhost:3000",
  { apiKey: process.env.YOMICHI_API_KEY },
);
try {
  const result =
    command === "analyze"
      ? await api.analyze({ text, limit: 5 })
      : command === "reading"
        ? await api.reading(text)
        : command === "romanize"
          ? await api.romanize(text)
          : command === "word"
            ? await api.word(text)
            : command === "kanji"
              ? await api.kanji(text)
              : await api.search(text);
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
