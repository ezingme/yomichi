import { buildApp } from "./app.js";
import { createPool } from "../../dictionary/src/connection.js";
import { PostgresDictionary } from "../../dictionary/src/repository.js";
const pool = createPool();
// Optional: analyze with an Ichiran database directly (read-only) instead of
// an imported Ichiran-model dataset.
const ichiranPool = process.env.ICHIRAN_DATABASE_URL
  ? createPool(process.env.ICHIRAN_DATABASE_URL, { readOnly: true })
  : undefined;
const app = await buildApp({
  repository: () =>
    new PostgresDictionary(pool, {
      ichiranDatabase: ichiranPool,
      ichiranVersion: process.env.ICHIRAN_DATABASE_VERSION || undefined,
    }),
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
