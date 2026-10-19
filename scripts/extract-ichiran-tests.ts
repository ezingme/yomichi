import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Node = {
  kind: "string" | "symbol" | "list";
  value: string;
  children: Node[];
  line: number;
};
/** A non-evaluating reader for the test-source subset. Lisp strings escape the next
 * character literally; line comments and nested #| block comments are ignored. */
export function readLisp(source: string): Node[] {
  let i = 0,
    line = 1;
  const advance = () => {
    const c = source[i++];
    if (c === "\n") line++;
    return c;
  };
  const skip = () => {
    for (;;) {
      if (/\s/.test(source[i] ?? "") && i < source.length) {
        advance();
        continue;
      }
      if (source[i] === ";") {
        while (i < source.length && advance() !== "\n") {}
        continue;
      }
      if (source.slice(i, i + 2) === "#|") {
        i += 2;
        let depth = 1;
        while (depth && i < source.length) {
          if (source.slice(i, i + 2) === "#|") {
            depth++;
            i += 2;
          } else if (source.slice(i, i + 2) === "|#") {
            depth--;
            i += 2;
          } else advance();
        }
        if (depth) throw new Error("Unterminated block comment");
        continue;
      }
      break;
    }
  };
  const read = (): Node => {
    skip();
    const start = line,
      c = advance();
    if (c === "(") {
      const children: Node[] = [];
      for (;;) {
        skip();
        if (source[i] === ")") {
          i++;
          break;
        }
        if (i >= source.length) throw new Error("Unterminated list");
        children.push(read());
      }
      return { kind: "list", value: "", children, line: start };
    }
    if (c === ")") throw new Error("Unexpected closing parenthesis");
    if (c === '"') {
      let value = "",
        closed = false;
      while (i < source.length) {
        const ch = advance();
        if (ch === '"') {
          closed = true;
          break;
        }
        value += ch === "\\" ? advance() : ch;
      }
      if (!closed) throw new Error("Unterminated string");
      return { kind: "string", value, children: [], line: start };
    }
    if (c === "'" || c === "`" || c === ",")
      return {
        kind: "list",
        value: "",
        children: [
          {
            kind: "symbol",
            value: c === "'" ? "quote" : c,
            children: [],
            line: start,
          },
          read(),
        ],
        line: start,
      };
    let value = c;
    while (i < source.length && !/[\s();]/.test(source[i])) value += advance();
    return {
      kind: "symbol",
      value: value.toLowerCase(),
      children: [],
      line: start,
    };
  };
  const nodes: Node[] = [];
  while (true) {
    skip();
    if (i >= source.length) return nodes;
    nodes.push(read());
  }
}
const head = (n: Node) => n.children[0]?.value;
export type ReferenceCase = {
  id: string;
  kind: "segmentation" | "number" | "romanization";
  text: string;
  tokens?: string[];
  expected?: string | number;
  function?: string;
  line: number;
  generated?: boolean;
  gap?: boolean;
};
export function extractTests(source: string) {
  const cases: ReferenceCase[] = [],
    skipped: { line: number; reason: string }[] = [];
  const roots = readLisp(source);
  const literal = (n: Node, env: Record<string, string>): string | undefined =>
    n.kind === "string" ? n.value : env[n.value];
  const visit = (
    n: Node,
    env: Record<string, string> = {},
    generated = false,
  ) => {
    if (head(n) === "dolist") {
      const [variable, quoted] = n.children[1].children;
      if (
        head(quoted) === "quote" &&
        quoted.children[1]?.kind === "list" &&
        quoted.children[1].children.every((x) => x.kind === "string")
      ) {
        for (const x of quoted.children[1].children)
          for (const body of n.children.slice(2))
            visit(body, { ...env, [variable.value]: x.value }, true);
        return;
      }
    }
    // The sole generated segmentation test uses (let ((s (format nil "~a~a" n ctr)))).
    if (head(n) === "let" && n.children[1]?.children.length === 1) {
      const [v, expr] = n.children[1].children[0].children;
      if (head(expr) === "format" && expr.children[2]?.value === "~a~a") {
        const values = expr.children.slice(3).map((x) => literal(x, env));
        if (values.every((x) => x !== undefined)) {
          for (const body of n.children.slice(2))
            visit(body, { ...env, [v.value]: values.join("") }, generated);
          return;
        }
      }
    }
    if (head(n) === "unless" && generated) {
      const truth = (x: Node): boolean =>
        head(x) === "and"
          ? x.children.slice(1).every(truth)
          : head(x) === "equal" &&
            literal(x.children[1], env) === literal(x.children[2], env);
      if (!truth(n.children[1]))
        for (const body of n.children.slice(2)) visit(body, env, generated);
      return;
    }
    if (head(n) === "assert-segment") {
      const text = literal(n.children[1], env);
      const tokens = n.children
        .slice(2)
        .map((x) => (x.value === ":gap" ? ":gap" : literal(x, env)));
      if (text !== undefined && tokens.every((x) => x !== undefined))
        cases.push({
          id: `segment-${cases.length + 1}`,
          kind: "segmentation",
          text,
          tokens: tokens as string[],
          line: n.line,
          ...(generated ? { generated } : {}),
          ...(tokens.includes(":gap") ? { gap: true } : {}),
        });
      else
        skipped.push({
          line: n.line,
          reason: "Nonliteral segmentation expression",
        });
      return;
    }
    if (["assert-eql", "assert-equal"].includes(head(n) ?? "")) {
      const a = n.children[1],
        b = n.children[2];
      const call = a?.kind === "list" ? a : b,
        expected = call === a ? b : a;
      if (
        call &&
        [
          "parse-number",
          "number-to-kanji",
          "number-to-kana",
          "romanize",
          "romanize-word",
          "kunrei-siki",
        ].includes(head(call) ?? "")
      ) {
        const arg = call.children[1];
        if (
          arg?.kind === "string" &&
          expected &&
          (expected.kind === "string" || /^\d+$/.test(expected.value))
        )
          cases.push({
            id: `value-${cases.length + 1}`,
            kind: head(call)!.includes("number") ? "number" : "romanization",
            text: arg.value,
            expected:
              expected.kind === "string"
                ? expected.value
                : Number(expected.value),
            function: head(call),
            line: n.line,
          });
        else
          skipped.push({
            line: n.line,
            reason:
              "Property/computed expectation retained in upstream source, not a literal golden output",
          });
        return;
      }
    }
    // Only descend within actual test definitions, never helper definitions.
    for (const child of n.children)
      if (child.kind === "list") visit(child, env, generated);
  };
  for (const n of roots)
    if (["define-test", "define-parallel-test"].includes(head(n) ?? ""))
      visit(n);
  return { cases, skipped };
}
export async function extractRepository(repository: string, output: string) {
  const source = await readFile(resolve(repository, "tests.lisp"), "utf8");
  const commit = execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const result = {
    provenance: {
      kind: "published-test-expectations",
      engineExecuted: false,
      repository: "https://github.com/tshatrov/ichiran",
      commit,
      path: "tests.lisp",
      sha256: createHash("sha256").update(source).digest("hex"),
      license: "MIT",
      copyright: "Copyright (c) 2014 Timofei Shatrov",
    },
    ...extractTests(source),
  };
  await mkdir(output, { recursive: true });
  await writeFile(
    resolve(output, "ichiran-tests.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  await writeFile(
    resolve(output, "ICHIRAN-LICENSE.txt"),
    await readFile(resolve(repository, "LICENSE")),
  );
  const packages: {
    file: string;
    package: string;
    exports: string[];
    reexports: string[];
  }[] = [];
  for (const file of ["package.lisp", "ichiran.lisp", "cli.lisp"]) {
    const content = await readFile(resolve(repository, file), "utf8");
    // In the two implementation files the declaration precedes (in-package ...).
    const declarations = readLisp(
      file === "package.lisp"
        ? content
        : content.slice(0, content.indexOf("(in-package")),
    );
    for (const n of declarations)
      if (["defpackage", "uiop:define-package"].includes(head(n) ?? "")) {
        const symbols = (section: string) =>
          n.children
            .filter((x) => head(x) === section)
            .flatMap((x) => x.children.slice(1).map((y) => y.value));
        packages.push({
          file,
          package: n.children[1].value,
          exports: symbols(":export"),
          reexports: symbols(":use-reexport"),
        });
      }
  }
  await writeFile(
    resolve(output, "ichiran-exports.json"),
    JSON.stringify(
      {
        commit,
        note: "Source inventory, not implemented-equivalence claim",
        packages,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      cases: result.cases.length,
      segmentation: result.cases.filter((c) => c.kind === "segmentation")
        .length,
      romanization: result.cases.filter((c) => c.kind === "romanization")
        .length,
      numbers: result.cases.filter((c) => c.kind === "number").length,
      skipped: result.skipped,
    }),
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await extractRepository(
    process.argv[2] ?? "../references/ichiran",
    process.argv[3] ?? "tests/fixtures/upstream",
  );
