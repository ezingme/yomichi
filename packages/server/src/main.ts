import { buildApp } from "./app.js";
import { createPool } from "../../dictionary/src/connection.js";
import { PostgresDictionary } from "../../dictionary/src/repository.js";
import { describeError } from "./db-errors.js";
const pool = createPool();
// Optional: analyze with an Ichiran database directly (read-only) instead of
// an imported Ichiran-model dataset.
const ichiranPool = process.env.ICHIRAN_DATABASE_URL
  ? createPool(process.env.ICHIRAN_DATABASE_URL, { readOnly: true })
  : undefined;
const repository = () =>
  new PostgresDictionary(pool, {
    ichiranDatabase: ichiranPool,
    ichiranVersion: process.env.ICHIRAN_DATABASE_VERSION || undefined,
  });
const app = await buildApp({
  repository,
  apiKey: process.env.API_KEY || undefined,
  origins: (process.env.CORS_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  rateMax: Number(process.env.RATE_LIMIT ?? 60),
});
app.addHook("onClose", async () => {
  await pool.end();
  await ichiranPool?.end();
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
await app.listen({
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 3000),
});
console.log(
  `Yomichi API listening; docs at /docs${ichiranPool ? "; Ichiran engine reads ICHIRAN_DATABASE_URL" : ""}`,
);
// Report what each database provides, so configuration problems show here
// rather than only as failed requests.
const repo = repository();
const [jmdict, ichiran] = await Promise.allSettled([repo.metadata(), repo.ichiran()]);
const failure = (r: PromiseRejectedResult) => {
  const d = describeError(r.reason);
  return `ERROR ${d.code}: ${d.message}`;
};
console.log(
  `  DATABASE_URL: ${
    jmdict.status === "rejected"
      ? failure(jmdict)
      : jmdict.value
        ? `JMdict dataset ${jmdict.value.version} (${jmdict.value.entryCount} entries)`
        : "connected; no JMdict dataset imported (word search and the legacy engine are unavailable)"
  }`,
);
console.log(
  `  Ichiran engine: ${
    ichiran.status === "rejected"
      ? failure(ichiran)
      : ichiran.value
        ? `${ichiran.value.dictionary.source}, version ${ichiran.value.dictionary.version} (about ${ichiran.value.dictionary.entryCount} entries)`
        : "not configured (set ICHIRAN_DATABASE_URL or run npm run import:ichiran)"
  }`,
);
