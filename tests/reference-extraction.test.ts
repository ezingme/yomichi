import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extractTests, readLisp } from "../scripts/extract-ichiran-tests.js";
import { compareBoundaries } from "../scripts/parity.js";

test("reader handles multiline assertions, nested comments, quoted strings and Lisp escapes", () => {
  const source = `(define-test examples
    ; (assert-segment "disabled" "disabled")
    #| (assert-segment "disabled" "disabled") #| nested |# |#
    (assert-segment "猫;犬"
      "猫;" "犬")
    (assert-segment "a\\\"b" "a\\\"" "b"))`;
  const { cases } = extractTests(source);
  assert.equal(cases.length, 2);
  assert.deepEqual(cases[0].tokens, ["猫;", "犬"]);
  assert.deepEqual(cases[1].tokens, ['a"', "b"]);
  assert.equal(cases[0].line, 4);
  assert.throws(() => readLisp("#| unfinished"), /Unterminated/);
  assert.throws(() => readLisp("(unfinished"), /Unterminated/);
});

test("extracts generated counter expectations and respects upstream exception", () => {
  const source = `(define-parallel-test counter-test
    (dolist (ctr '("つ" "人"))
      (dolist (n '("1" "十一"))
        (let ((s (format nil "~a~a" n ctr)))
          (unless (and (equal ctr "つ") (equal n "十一")) (assert-segment s s))))))`;
  assert.deepEqual(
    extractTests(source).cases.map((c) => c.text),
    ["1つ", "1人", "十一人"],
  );
});

test("extracts literal number/romanization expectations in either assertion order without fabricating computed outputs", () => {
  const { cases, skipped } = extractTests(`(define-test values
    (assert-eql (parse-number "100万") 1000000)
    (assert-equal "neko" (romanize-word "ねこ"))
    (assert-eql (parse-number (number-to-kanji n)) n))`);
  assert.deepEqual(
    cases.map((c) => [c.kind, c.expected]),
    [
      ["number", 1000000],
      ["romanization", "neko"],
    ],
  );
  assert.equal(skipped.length, 1);
});

test("committed corpus retains provenance and no false live or romanization claim", async () => {
  const corpus = JSON.parse(
    await readFile("tests/fixtures/upstream/ichiran-tests.json", "utf8"),
  );
  assert.equal(
    corpus.provenance.commit,
    "002a695b3c86a9524e49354f04b7a915beb71270",
  );
  assert.equal(corpus.provenance.engineExecuted, false);
  assert.equal(corpus.cases.length, 743);
  assert.equal(
    corpus.cases.filter((c: { kind: string }) => c.kind === "romanization")
      .length,
    0,
  );
  for (const c of corpus.cases)
    if (c.kind === "segmentation" && !c.gap)
      assert.equal(c.tokens.join(""), c.text);
});

test("boundary metrics measure splits and merges in UTF-16 without trivial endpoint credit", () => {
  assert.deepEqual(
    compareBoundaries("猫は魚", ["猫", "は", "魚"], ["猫は", "魚"]),
    { exact: false, truePositive: 1, predicted: 1, reference: 2 },
  );
  assert.deepEqual(compareBoundaries("😀猫", ["😀", "猫"], ["😀猫"]), {
    exact: false,
    truePositive: 0,
    predicted: 0,
    reference: 1,
  });
  assert.deepEqual(compareBoundaries("猫", ["猫"], ["猫"]), {
    exact: true,
    truePositive: 0,
    predicted: 0,
    reference: 0,
  });
  assert.throws(() => compareBoundaries("猫", ["猫"], ["犬"]), /reconstruct/);
});

test("offline runner evaluates captured candidates and reports exclusions without treating missing rows as passes", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { runParity } = await import("../scripts/parity.js");
  const dir = await mkdtemp(join(tmpdir(), "yomichi-parity-test-"));
  const log = console.log;
  console.log = () => {};
  try {
    const corpus = join(dir, "corpus.json"),
      predictions = join(dir, "predictions.json");
    await writeFile(
      corpus,
      JSON.stringify({
        provenance: { kind: "synthetic-unit-test", engineExecuted: false },
        cases: [
          {
            id: "test-1",
            kind: "segmentation",
            text: "猫は魚",
            tokens: ["猫", "は", "魚"],
            line: 1,
          },
          {
            id: "gap-1",
            kind: "segmentation",
            text: "ぁ",
            tokens: [":gap"],
            gap: true,
            line: 2,
          },
        ],
      }),
    );
    await writeFile(
      predictions,
      JSON.stringify([
        { id: "test-1", text: "猫は魚", tokens: ["猫は", "魚"] },
      ]),
    );
    const summary = await runParity([
      "--corpus",
      corpus,
      "--predictions",
      predictions,
    ]);
    assert.equal(summary.evaluated, 1);
    assert.equal(summary.excludedGapCases, 1);
    assert.equal(summary.exactRate, 0);
    assert.equal(summary.boundaryPrecision, 1);
    assert.equal(summary.boundaryRecall, 0.5);
    await writeFile(predictions, "[]");
    await assert.rejects(
      runParity(["--corpus", corpus, "--predictions", predictions]),
      /Missing/,
    );
  } finally {
    console.log = log;
    await rm(dir, { recursive: true, force: true });
  }
});
