import test from "node:test";
import assert from "node:assert/strict";
import * as kana from "../packages/core/src/kana.js";

test("Ichiran Hepburn modes preserve their distinct long vowels and nasal rules", () => {
  assert.equal(
    kana.romanizeKana(
      "しんばし とうきょう まっちゃ",
      "hepburn-traditional" as never,
    ),
    "shimbashi tōkyō matcha",
  );
  assert.equal(
    kana.romanizeKana("おおさか", "hepburn-passport" as never),
    "ohsaka",
  );
  assert.equal(
    kana.romanizeKana("とうきょう", "hepburn-simple" as never),
    "tokyo",
  );
  assert.equal(
    kana.romanizeKana("を おばあさん", "hepburn-modified" as never),
    "o obāsan",
  );
  assert.equal(
    kana.romanizeKana("しゅうちゅう", "kunrei-shiki" as never),
    "syûtyû",
  );
});
test("kana normalization, iteration and inverse suggestions retain ambiguity", async () => {
  assert.equal(kana.toHiragana("ﾊﾟｰﾃｨｰ"), "ぱーてぃー");
  assert.equal(kana.romanizeKana("いすゞ"), "isuzu");
  const module = kana as typeof kana & {
    deromanize: (s: string) => { canonical: string; pattern: string } | null;
  };
  assert.equal(typeof module.deromanize, "function");
  const inverse = module.deromanize("tokyo");
  assert.equal(inverse?.canonical, "ときょ");
  assert.match("とうきょう", new RegExp(inverse!.pattern));
});
test("exact number parsing and rendering covers mixed script and large units", async () => {
  const n = await import("../packages/core/src/numbers.js");
  for (const value of [0n, 10001n, 20020001n, 12423000430n, 10000000000000001n])
    assert.equal(n.parseJapaneseNumber(n.numberToKanji(value)), value);
  assert.equal(n.parseJapaneseNumber("１００万500"), 1000500n);
  assert.equal(n.parseJapaneseNumber("二〇二六"), 2026n);
  assert.equal(n.parseJapaneseNumber("壱万弐千参百拾"), 12310n);
  assert.equal(n.parseJapaneseNumber("猫"), null);
  assert.equal(n.parseJapaneseNumber(""), null);
  assert.equal(n.numberToKana(38600), "さんまんはっせんろっぴゃく");
  assert.equal(n.numberToKana(1000000000000n), "いっちょう");
});
test("character utilities preserve original UTF-16 offsets", async () => {
  const c = await import("../packages/core/src/characters.js");
  assert.equal(c.normalizeJapanese("ﾊﾟﾝ　Ａ１"), "パン　A1");
  assert.equal(c.rendaku("ひき"), "びき");
  assert.equal(c.rendaku("ひき", true), "ぴき");
  assert.equal(c.unrendaku("ピカ"), "ヒカ");
  assert.equal(c.expandIterationMarks("いすゞ サヽ"), "いすず ササ");
  assert.equal(c.moraLength("きょう"), 2);
  assert.deepEqual(c.consecutiveCharacterGroups("😀漢字かな", "kanji"), [
    { start: 2, end: 4 },
  ]);
  assert.deepEqual(
    c.basicSplit("😀猫３匹！").map((x) => [x.surface, x.start, x.end]),
    [
      ["😀", 0, 2],
      ["猫３匹", 2, 5],
      ["！", 5, 6],
    ],
  );
});
test("counter sandhi, exceptions, ambiguity and ordinal suffixes", async () => {
  const c = await import("../packages/core/src/counters.js");
  for (const [surface, reading] of [
    ["三本", "さんぼん"],
    ["六匹", "ろっぴき"],
    ["八杯", "はっぱい"],
    ["四分", "よんぷん"],
    ["一人", "ひとり"],
    ["二十歳", "はたち"],
    ["四月", "しがつ"],
    ["二十四日", "にじゅうよっか"],
    ["三階", "さんがい"],
    ["一冊目", "いっさつめ"],
    ["四時半", "よじはん"],
    ["一年間", "いちねんかん"],
  ]) {
    assert.ok(
      c
        .findCounterCandidates(surface)
        .some((x) => x.surface === surface && x.reading === reading),
      surface,
    );
  }
  assert.deepEqual(
    c
      .findCounterCandidates("一日")
      .filter((x) => x.surface === "一日")
      .map((x) => x.reading)
      .sort(),
    ["いちにち", "ついたち"],
  );
  assert.equal(
    c.findCounterCandidates("十一つ").some((x) => x.counter === "つ"),
    false,
  );
  const result = c
    .findCounterCandidates("😀三本", 2)
    .find((x) => x.counter === "本")!;
  assert.equal(result.start, 2);
  assert.equal(result.end, 4);
  assert.equal(result.value, "3");
  assert.equal(result.components.map((x) => x.surface).join(""), "三本");
});
test("romanization keeps legacy katakana long vowels and handles loanword modifiers", () => {
  assert.equal(kana.romanizeKana("スーパー"), "suupaa");
  assert.equal(kana.romanizeKana("ヴァイオリン"), "vaiorin");
  assert.equal(kana.romanizeKana("っ", "hepburn-basic"), "!");
  assert.equal(kana.romanizeKana("ー", "hepburn-basic"), "~");
  // Ichiran's raw kana romanizer drops the long-vowel modifier. Dictionary
  // reading hints are a separate analysis layer, not guessed here.
  assert.equal(kana.romanizeKana("スーパー", "hepburn-basic"), "supa");
});

test("all counter surfaces in upstream counter-test accept the same number domain", async () => {
  const c = await import("../packages/core/src/counters.js");
  const counters =
    "倍 晩 秒 着 挺 丁 台 段 度 円 服 幅 分 杯 発 遍 篇 匹 本 時 畳 帖 条 課 日 回 ヵ月 階 軒 機 個 脚 間 枚 巻 名 年 人 列 輪 輌 才 歳 棹 冊 隻 章 首 足 艘 反 滴 点 頭 つ 通 対 羽 把 割 膳 時間 週間 人中 番目 期目 巻目".split(
      " ",
    );
  for (const counter of counters)
    for (const n of ["1", "三", "十一"]) {
      if (counter === "つ" && n === "十一") continue;
      const surface = n + counter;
      assert.ok(
        c.findCounterCandidates(surface).some((x) => x.surface === surface),
        surface,
      );
    }
});

test("inverse romanization follows upstream carry and alternative parsing rules", () => {
  assert.equal(kana.deromanize("shimbashi")?.canonical, "しんばし");
  assert.equal(kana.deromanize("lla")?.canonical, "っら");
  assert.equal(kana.deromanize("d'i")?.canonical, "でぃ");
  assert.equal(kana.deromanize("la")?.canonical, "ら");
  const inverse = kana.deromanize("na")!;
  assert.equal(inverse.canonical, "な");
  assert.match("な", new RegExp(inverse.pattern));
  assert.match("んあ", new RegExp(inverse.pattern));
  assert.ok(inverse.hiragana.includes("んあ"));
  assert.equal(kana.deromanize("ky"), null);
  assert.equal(kana.deromanize("foo!"), null);
});
test("partial romaji suggestions complete trailing syllables without dictionary invention", () => {
  const mod = kana as typeof kana & {
    partialSuggestions: (
      s: string,
      limit?: number,
    ) => { hiragana: string[]; pattern: string } | null;
  };
  assert.equal(typeof mod.partialSuggestions, "function");
  const suggestions = mod.partialSuggestions("toky")!;
  assert.ok(suggestions.hiragana.includes("ときょ"));
  assert.match("とうきょう", new RegExp(suggestions.pattern));
  assert.ok(mod.partialSuggestions("sh", 2)!.hiragana.length <= 2);
  assert.equal(mod.partialSuggestions("!"), null);
});

test("partial prefix retains nasal branch ambiguity and long inputs remain compact", () => {
  const suggestions = kana.partialSuggestions("ny")!;
  assert.ok(suggestions.hiragana.includes("にゃ"));
  assert.ok(suggestions.hiragana.includes("んや"));
  const source = "na".repeat(100),
    result = kana.deromanize(source)!;
  assert.equal(result.canonical, "な".repeat(100));
  assert.ok(result.pattern.length < 10000);
  assert.match("んあ".repeat(100), new RegExp(result.pattern));
});
