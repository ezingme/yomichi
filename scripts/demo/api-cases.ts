/** Live API test cases for a running Yomichi server with the Ichiran engine
 * (ICHIRAN_DATABASE_URL or an imported ichiran dataset). Expected values
 * are those of Ichiran over the ichiran-260118 release database.
 *
 *   YOMICHI_API_URL=http://127.0.0.1:3000 node --import tsx scripts/demo/api-cases.ts [OUT_DIR]
 *
 * Writes OUT_DIR/api-cases.json and OUT_DIR/api-cases.md; exits 1 on failure. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const base = (process.env.YOMICHI_API_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const out = process.argv[2] ?? "data/demo";
type Res = { status: number; body: any };
async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<Res> {
  const r = await fetch(base + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(process.env.YOMICHI_API_KEY ? { "x-api-key": process.env.YOMICHI_API_KEY } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}
const words = (b: any, i = 0) => b.candidates[i].tokens;
const pick = (t: any) => [t.surface, t.reading, t.romanization];

interface Case {
  name: string;
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  check: (r: Res) => void;
  /** Short excerpt of the response for the report. */
  show: (r: Res) => unknown;
}
const analyze = (text: string, extra: object = {}) => ({ text, ...extra });
const cases: Case[] = [
  {
    name: "Readiness reports the Ichiran database",
    method: "GET",
    path: "/readyz",
    check: (r) => {
      assert.equal(r.status, 200);
      assert.equal(r.body.ready, true);
      assert.ok(r.body.ichiran.capabilities.includes("ichiran"));
    },
    show: (r) => r.body.ichiran,
  },
  {
    name: "Sentence analysis: tokens, readings and romanization",
    method: "POST",
    path: "/v1/analyze",
    body: analyze("猫は魚を食べました。"),
    check: (r) => {
      assert.equal(r.status, 200);
      assert.match(r.body.engineVersion, /\+ichiran$/);
      assert.deepEqual(words(r.body).map(pick), [
        ["猫", "ねこ", "neko"],
        ["は", "は", "wa"],
        ["魚", "さかな", "sakana"],
        ["を", "を", "wo"],
        ["食べました", "たべました", "tabemashita"],
        ["。", null, null],
      ]);
      const verb = words(r.body)[4];
      assert.equal(verb.lemma, "食べる");
      assert.deepEqual(verb.conjugationSteps, ["Past (~ta), formal"]);
    },
    show: (r) => words(r.body).map((t: any) => `${t.surface}[${t.romanization ?? "-"}]`).join(" "),
  },
  {
    name: "Conjugation chain resolves to the dictionary form",
    method: "POST",
    path: "/v1/analyze",
    body: analyze("食べさせられなかった"),
    check: (r) => {
      const [t] = words(r.body);
      assert.equal(t.lemma, "食べる");
      assert.equal(t.entryId, "1358280");
      assert.deepEqual(t.conjugationSteps, ["Causative-Passive", "Past (~ta), negative"]);
      assert.ok(t.senses[0].glosses.some((g: any) => g.text === "to eat"));
    },
    show: (r) => ({ lemma: words(r.body)[0].lemma, steps: words(r.body)[0].conjugationSteps }),
  },
  {
    name: "Suffix compound with components and spans",
    method: "POST",
    path: "/v1/analyze",
    body: analyze("もう食べてしまった。"),
    check: (r) => {
      const t = words(r.body).find((x: any) => x.surface === "食べてしまった");
      assert.ok(t, "compound token");
      assert.deepEqual(
        t.components.map((c: any) => [c.surface, c.start, c.end]),
        [
          ["食べて", 2, 5],
          ["しまった", 5, 9],
        ],
      );
      assert.equal(t.components[1].conjugationSteps[0], "indicates completion (to finish ...)");
    },
    show: (r) =>
      words(r.body)
        .find((x: any) => x.surface === "食べてしまった")
        .components.map((c: any) => ({ surface: c.surface, steps: c.conjugationSteps })),
  },
  {
    name: "Counter reading with sound change",
    method: "POST",
    path: "/v1/analyze",
    body: analyze("猫が3匹いる"),
    check: (r) => {
      const t = words(r.body).find((x: any) => x.surface === "3匹");
      assert.deepEqual(pick(t), ["3匹", "さんびき", "sambiki"]);
    },
    show: (r) => words(r.body).map((t: any) => `${t.surface}[${t.romanization ?? "-"}]`).join(" "),
  },
  {
    name: "UTF-16 offsets, halfwidth katakana, emoji and unknown text",
    method: "POST",
    path: "/v1/analyze",
    body: analyze("ｶﾀｶﾅ😀でabc"),
    check: (r) => {
      const text = "ｶﾀｶﾅ😀でabc";
      let pos = 0;
      for (const t of words(r.body)) {
        assert.equal(t.start, pos);
        assert.equal(text.slice(t.start, t.end), t.surface);
        pos = t.end;
      }
      assert.equal(pos, text.length);
      assert.deepEqual(pick(words(r.body)[0]), ["ｶﾀｶﾅ", "カタカナ", "katakana"]);
      assert.equal(words(r.body).at(-1).kind, "unknown");
    },
    show: (r) => words(r.body).map((t: any) => [t.surface, t.start, t.end, t.kind]),
  },
  {
    name: "Romanization: Kunrei-shiki",
    method: "POST",
    path: "/v1/analyze",
    body: analyze("東京に行く", { romanization: "kunrei" }),
    check: (r) => assert.equal(words(r.body)[0].romanization, "tôkyô"),
    show: (r) => words(r.body).map((t: any) => t.romanization).join(" "),
  },
  {
    name: "Segmentation hint forces a boundary",
    method: "POST",
    path: "/v1/analyze",
    body: analyze("食べたい", { segmentationHints: [2] }),
    check: (r) => assert.deepEqual(words(r.body).map((t: any) => t.surface), ["食べ", "たい"]),
    show: (r) => words(r.body).map((t: any) => t.surface),
  },
  {
    name: "Top-K candidates are ordered by score",
    method: "POST",
    path: "/v1/analyze",
    body: analyze("東京都に住んでいる", { limit: 3 }),
    check: (r) => {
      const c = r.body.candidates;
      assert.ok(c.length >= 2);
      for (let i = 1; i < c.length; i++) assert.ok(c[i - 1].score >= c[i].score);
    },
    show: (r) =>
      r.body.candidates.map((c: any) => ({ score: c.score, tokens: c.tokens.map((t: any) => t.surface).join("|") })),
  },
  {
    name: "Reading endpoint",
    method: "POST",
    path: "/v1/reading",
    body: { text: "日本語を勉強しています" },
    check: (r) => assert.equal(r.body.reading, "にほんごをべんきょうしています"),
    show: (r) => r.body.reading,
  },
  {
    name: "Ichiran romanize with word info",
    method: "POST",
    path: "/v1/ichiran/romanize",
    body: { text: "今日は寿司を食べに行きませんか？", info: true },
    check: (r) => {
      assert.equal(r.body.romanization, "kyō wa sushi wo tabe ni ikimasen ka?");
      assert.match(r.body.info[0].gloss, /^今日 【きょう】/);
    },
    show: (r) => ({ romanization: r.body.romanization, first: r.body.info[0] }),
  },
  {
    name: "Ichiran romanize* JSON",
    method: "POST",
    path: "/v1/ichiran/segment",
    body: { text: "お茶" },
    check: (r) => {
      const [[[[[rom, info]]]]] = r.body.result;
      assert.equal(rom, "ocha");
      assert.equal(info.seq, 1002430);
    },
    show: (r) => r.body.result[0][0][0][0].slice(0, 2),
  },
  {
    name: "Ichiran word lookup",
    method: "GET",
    path: `/v1/ichiran/word?text=${encodeURIComponent("行く")}`,
    check: (r) => assert.ok(r.body.items.some((w: any) => w.seq === 1578850 && w.kana === "いく")),
    show: (r) => r.body.items.map((w: any) => ({ reading: w.reading, seq: w.seq })),
  },
  {
    name: "Ichiran kanji information",
    method: "GET",
    path: `/v1/ichiran/kanji/${encodeURIComponent("食")}`,
    check: (r) => {
      assert.equal(r.body.text, "食");
      assert.equal(r.body.strokes, 9);
      assert.ok(r.body.readings.some((x: any) => x.text === "しょく"));
    },
    show: (r) => ({
      text: r.body.text,
      strokes: r.body.strokes,
      grade: r.body.grade,
      readings: r.body.readings.slice(0, 4).map((x: any) => `${x.text} ${x.perc}`),
    }),
  },
  {
    name: "Ichiran kanji/reading alignment",
    method: "POST",
    path: "/v1/ichiran/match-readings",
    body: { word: "食べ物", reading: "たべもの" },
    check: (r) =>
      assert.deepEqual(
        r.body.items.map((m: any) => m.reading ?? m.text),
        ["た", "べ", "もの"],
      ),
    show: (r) => r.body.items.map((m: any) => (m.kanji ? `${m.kanji}=${m.reading} (${m.type})` : m.text)),
  },
  {
    name: "Validation: empty text is rejected",
    method: "POST",
    path: "/v1/analyze",
    body: { text: "" },
    check: (r) => assert.equal(r.status, 400),
    show: (r) => [r.status, r.body.error.code],
  },
  {
    name: "Validation: limit above 5 is rejected",
    method: "POST",
    path: "/v1/analyze",
    body: { text: "猫", limit: 9 },
    check: (r) => assert.equal(r.status, 400),
    show: (r) => [r.status, r.body.error.code],
  },
  {
    name: "Validation: hint inside a surrogate pair is rejected",
    method: "POST",
    path: "/v1/analyze",
    body: { text: "😀猫", segmentationHints: [1] },
    check: (r) => {
      assert.equal(r.status, 400);
      assert.equal(r.body.error.code, "INVALID_HINTS");
    },
    show: (r) => [r.status, r.body.error.code],
  },
  {
    name: "A character outside KANJIDIC returns 404",
    method: "GET",
    path: `/v1/ichiran/kanji/${encodeURIComponent("ア")}`,
    check: (r) => assert.equal(r.status, 404),
    show: (r) => [r.status, r.body.error.code],
  },
];

const results: { name: string; request: string; status: number; ok: boolean; error?: string; excerpt?: unknown; ms: number }[] = [];
for (const c of cases) {
  const started = performance.now();
  let r: Res | undefined;
  try {
    r = await call(c.method, c.path, c.body);
    c.check(r);
    results.push({ name: c.name, request: `${c.method} ${c.path}`, status: r.status, ok: true, excerpt: c.show(r), ms: Math.round(performance.now() - started) });
  } catch (e) {
    results.push({
      name: c.name,
      request: `${c.method} ${c.path}`,
      status: r?.status ?? 0,
      ok: false,
      error: (e as Error).message.split("\n")[0],
      excerpt: r ? JSON.stringify(r.body).slice(0, 300) : undefined,
      ms: Math.round(performance.now() - started),
    });
  }
  const last = results.at(-1)!;
  console.log(`${last.ok ? "PASS" : "FAIL"} ${last.name} (${last.ms} ms)${last.ok ? "" : ": " + last.error}`);
}
const ready = (await call("GET", "/readyz")).body;
const passed = results.filter((r) => r.ok).length;
await mkdir(out, { recursive: true });
await writeFile(`${out}/api-cases.json`, JSON.stringify({ base, dictionary: ready.ichiran ?? ready.dictionary, passed, total: results.length, results }, null, 1));
const md = [
  `# Yomichi API cases`,
  ``,
  `Server: \`${base}\` · dictionary: ${(ready.ichiran ?? ready.dictionary)?.version ?? "?"} · **${passed}/${results.length} passed**`,
  ``,
  `| # | Case | Request | HTTP | Result | ms |`,
  `| - | ---- | ------- | ---- | ------ | -: |`,
  ...results.map(
    (r, i) =>
      `| ${i + 1} | ${r.name} | \`${decodeURIComponent(r.request)}\` | ${r.status} | ${r.ok ? "✅" : "❌ " + r.error} | ${r.ms} |`,
  ),
  ``,
  `## Response excerpts`,
  ``,
  ...results.flatMap((r, i) => [`**${i + 1}. ${r.name}**`, "", "```json", JSON.stringify(r.excerpt, null, 1), "```", ""]),
].join("\n");
await writeFile(`${out}/api-cases.md`, md);
console.log(`${passed}/${results.length} passed; report in ${out}/api-cases.md`);
process.exitCode = passed === results.length ? 0 : 1;
