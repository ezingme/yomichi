/** Robust live-oracle capture: runs ichiran-batch.lisp over input JSONL in
 * small batches with bounded concurrency, retrying cases whose output is
 * missing (e.g. after an SBCL crash). Inputs are passed via stdin, never
 * through a shell.
 *
 *   node --import tsx scripts/oracle/capture.ts IN.jsonl OUT.jsonl \
 *     [--core /path/ichiran.core] [--jobs 3] [--batch 150]
 */
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const [input, output, ...rest] = process.argv.slice(2);
const opt = (name: string, def: string) =>
  rest.includes(name) ? rest[rest.indexOf(name) + 1] : def;
const core = opt("--core", "/home/user/oracle/ichiran.core");
const jobs = Number(opt("--jobs", "3"));
const batchSize = Number(opt("--batch", "150"));
const script = fileURLToPath(new URL("./ichiran-batch.lisp", import.meta.url));

const lines = (await readFile(input, "utf8")).split("\n").filter((l) => l.trim());
const byId = new Map(lines.map((l) => [JSON.parse(l).id as string, l]));
const results = new Map<string, string>();

function run(batch: string[]): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn("sbcl", ["--core", core, "--non-interactive", "--load", script], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.startsWith("{")) {
          try {
            const o = JSON.parse(line);
            if (o.id) results.set(o.id, line);
          } catch {
            /* partial output from a crashed process */
          }
        }
      }
    });
    child.on("close", () => resolve());
    child.stdin.end(batch.join("\n") + "\n");
  });
}

for (let attempt = 0; attempt < 4; attempt++) {
  const todo = [...byId.keys()].filter((id) => !results.has(id));
  if (!todo.length) break;
  console.error(`attempt ${attempt + 1}: ${todo.length} cases`);
  const batches: string[][] = [];
  for (let i = 0; i < todo.length; i += batchSize)
    batches.push(todo.slice(i, i + batchSize).map((id) => byId.get(id)!));
  let next = 0;
  await Promise.all(
    Array.from({ length: jobs }, async () => {
      while (next < batches.length) await run(batches[next++]);
    }),
  );
}
const missing = [...byId.keys()].filter((id) => !results.has(id));
await writeFile(output, [...byId.keys()].filter((id) => results.has(id)).map((id) => results.get(id)).join("\n") + "\n");
console.error(JSON.stringify({ captured: results.size, missing: missing.length }));
