import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../packages/server/src/app.js";
import { MemoryDictionary, entry } from "./helpers.js";
const repo = new MemoryDictionary([entry("1", "食べる", "たべる", "v1")]);
test("API analyzes, exposes OpenAPI, validates input and applies projections", async () => {
  const app = await buildApp({ repository: () => repo });
  try {
    const r = await app.inject({
      method: "POST",
      url: "/v1/analyze",
      payload: { text: "食べました", includeGlosses: false },
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().candidates[0].tokens[0].lemma, "食べる");
    assert.deepEqual(r.json().candidates[0].tokens[0].senses, []);
    for (const payload of [
      { text: "" },
      { text: "a", limit: 8 },
      { text: "a", includeGlosses: "false" },
      { text: "a", unexpected: true },
    ])
      assert.equal(
        (await app.inject({ method: "POST", url: "/v1/analyze", payload }))
          .statusCode,
        400,
      );
    assert.equal((await app.inject("/openapi.json")).statusCode, 200);
    assert.equal((await app.inject("/v1/words/1")).json().id, "1");
    assert.equal((await app.inject("/v1/words/404")).statusCode, 404);
    assert.equal((await app.inject("/v1/kanji/ab")).statusCode, 400);
    assert.equal(
      (await app.inject("/v1/words/search?q=%25")).json().items.length,
      0,
    );
  } finally {
    await app.close();
  }
});
test("optional API key protects data; CORS does not reflect arbitrary origins", async () => {
  const app = await buildApp({
    repository: () => repo,
    apiKey: "private-test-secret",
    origins: ["https://demo.example"],
  });
  try {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/analyze",
          payload: { text: "食べる" },
        })
      ).statusCode,
      401,
    );
    const r = await app.inject({
      method: "POST",
      url: "/v1/analyze",
      payload: { text: "食べる" },
      headers: {
        "x-api-key": "private-test-secret",
        origin: "https://evil.example",
      },
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.headers["access-control-allow-origin"], undefined);
    assert.equal((await app.inject("/healthz")).statusCode, 200);
  } finally {
    await app.close();
  }
});
test("missing dictionary is explicit, kana-only conversion still works", async () => {
  const empty = new MemoryDictionary([]);
  const app = await buildApp({ repository: () => empty });
  try {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/analyze",
          payload: { text: "猫" },
        })
      ).statusCode,
      503,
    );
    assert.equal((await app.inject("/readyz")).statusCode, 503);
    const r = await app.inject({
      method: "POST",
      url: "/v1/reading",
      payload: { text: "ネコ", mode: "kana" },
    });
    assert.equal(r.json().reading, "ねこ");
  } finally {
    await app.close();
  }
});
