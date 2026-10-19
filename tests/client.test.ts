import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildApp } from "../packages/server/src/app.js";
import {
  YomichiClient,
  YomichiClientError,
} from "../packages/client/src/index.js";
import { MemoryDictionary, entry } from "./helpers.js";

test("SDK and CLI use the live HTTP API including typed failures", async () => {
  const app = await buildApp({
    repository: () =>
      new MemoryDictionary([entry("1", "食べる", "たべる", "v1")]),
    apiKey: "test-key",
  });
  const url = await app.listen({ host: "127.0.0.1", port: 0 });
  try {
    const api = new YomichiClient(url, { apiKey: "test-key" });
    assert.equal(
      (await api.analyze({ text: "食べました" })).candidates[0].tokens[0].lemma,
      "食べる",
    );
    assert.equal((await api.search("食")).items[0].id, "1");
    assert.equal((await api.reading("ネコ", "kana")).reading, "ねこ");
    await assert.rejects(
      () => new YomichiClient(url).word("1"),
      (e: unknown) => e instanceof YomichiClientError && e.status === 401,
    );
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "packages/cli/src/main.ts", "analyze", "食べました"],
      {
        env: {
          ...process.env,
          YOMICHI_API_URL: url,
          YOMICHI_API_KEY: "test-key",
        },
      },
    );
    assert.equal(
      JSON.parse(stdout).candidates[0].tokens[0].reading,
      "たべました",
    );
  } finally {
    await app.close();
  }
});
