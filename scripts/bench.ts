import { performance } from "node:perf_hooks";
import { createPool } from "../packages/dictionary/src/connection.js";
import { PostgresDictionary } from "../packages/dictionary/src/repository.js";
import { analyze } from "../packages/core/src/engine.js";
const pool = createPool();
const texts = [
  "駅の前で会いましょう。",
  "猫は魚を食べました。",
  "あなたの質問は答えにくい。",
  "提出させられるなんて",
];
try {
  const dictionary = await new PostgresDictionary(pool).metadata();
  if (!dictionary) throw new Error("Import dictionary first");
  for (let i = 0; i < 20; i++)
    await analyze(new PostgresDictionary(pool), {
      text: texts[i % texts.length],
    });
  const times: number[] = [];
  const cpu = process.cpuUsage();
  for (let i = 0; i < 100; i++) {
    const start = performance.now();
    await analyze(new PostgresDictionary(pool), {
      text: texts[i % texts.length],
      limit: 5,
    });
    times.push(performance.now() - start);
  }
  const consumed = process.cpuUsage(cpu);
  times.sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        dictionary,
        node: process.version,
        samples: 100,
        mode: "sequential warm, Top-K 5",
        meanMs: times.reduce((a, b) => a + b, 0) / times.length,
        p95Ms: times[94],
        nodeCpuMsPerRequest: (consumed.user + consumed.system) / 1000 / 100,
        nodeRSSBytes: process.memoryUsage().rss,
        notes:
          "Database CPU/RSS excluded. Not a concurrent throughput benchmark. Not comparable to upstream without matching corpus, hardware and output.",
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
