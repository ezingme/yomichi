import { buildApp } from "./app.js";
import { createPool } from "../../dictionary/src/connection.js";
import { PostgresDictionary } from "../../dictionary/src/repository.js";
const pool = createPool();
const app = await buildApp({
  repository: () => new PostgresDictionary(pool),
  apiKey: process.env.API_KEY || undefined,
  origins: (process.env.CORS_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  rateMax: Number(process.env.RATE_LIMIT ?? 60),
});
app.addHook("onClose", async () => pool.end());
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
await app.listen({
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 3000),
});
console.log("Yomichi API listening; docs at /docs");
