/** Configuration problems surface as clear errors instead of a generic 500. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { buildApp } from "../packages/server/src/app.js";
import { databaseError } from "../packages/server/src/db-errors.js";
import { PostgresDictionary } from "../packages/dictionary/src/repository.js";
import { replayEngine } from "./helpers-ichiran.js";

const pgError = (code: string, message = "x") => Object.assign(new Error(message), { code });

test("database errors map to configuration hints without connection details", () => {
  const cases: [Error, string][] = [
    [pgError("ECONNREFUSED", "connect ECONNREFUSED 10.0.0.1:5432"), "DATABASE_UNAVAILABLE"],
    [new Error("Connection terminated due to connection timeout"), "DATABASE_UNAVAILABLE"],
    [pgError("28P01"), "DATABASE_AUTH"],
    [pgError("28000", 'no pg_hba.conf entry for host "1.2.3.4"'), "DATABASE_AUTH"],
    [pgError("3D000"), "DATABASE_MISSING"],
    [pgError("42P01", 'relation "yomichi_datasets" does not exist'), "SCHEMA_MISSING"],
    [pgError("42P01", 'relation "entry" does not exist'), "ICHIRAN_SCHEMA_MISSING"],
    [pgError("57014"), "DATABASE_TIMEOUT"],
  ];
  for (const [e, code] of cases) {
    const mapped = databaseError(e)!;
    assert.equal(mapped.code, code);
    assert.equal(mapped.status, 503);
    assert.doesNotMatch(mapped.message, /10\.0\.0\.1|1\.2\.3\.4/);
  }
  assert.equal(databaseError(new Error("something else")), null);
});

test("readiness reports each source; an unmigrated DATABASE_URL does not hide the Ichiran engine", async () => {
  const empty = new PGlite(); // no db:migrate
  const engine = replayEngine();
  engine.dictionary.entryCount = 2512557;
  const app = await buildApp({
    repository: () => Object.assign(new PostgresDictionary(empty as any), { ichiran: async () => engine }),
  });
  const ready = await app.inject({ method: "GET", url: "/readyz" });
  assert.equal(ready.statusCode, 200);
  assert.equal(ready.json().ready, true);
  assert.equal(ready.json().errors.dictionary.code, "SCHEMA_MISSING");
  assert.match(ready.json().errors.dictionary.message, /npm run db:migrate/);
  // analysis uses the Ichiran engine
  const ok = await app.inject({ method: "POST", url: "/v1/analyze", payload: { text: "べんきょう しています" } });
  assert.equal(ok.statusCode, 200);
  // the legacy engine needs Yomichi's tables and says so
  const legacy = await app.inject({ method: "POST", url: "/v1/analyze", payload: { text: "猫", engine: "legacy" } });
  assert.equal(legacy.statusCode, 503);
  assert.equal(legacy.json().error.code, "SCHEMA_MISSING");
  await app.close();
  await empty.close();
});

test("ICHIRAN_DATABASE_URL pointing at a database without Ichiran's tables is explained", async () => {
  const yomichi = new PGlite();
  const notIchiran = new PGlite();
  const app = await buildApp({
    repository: () => new PostgresDictionary(yomichi as any, { ichiranDatabase: notIchiran as any }),
  });
  const ready = await app.inject({ method: "GET", url: "/readyz" });
  assert.equal(ready.statusCode, 503);
  assert.equal(ready.json().errors.ichiran.code, "ICHIRAN_SCHEMA_MISSING");
  const res = await app.inject({ method: "POST", url: "/v1/ichiran/analyze", payload: { text: "猫" } });
  assert.equal(res.statusCode, 503);
  assert.match(res.json().error.message, /ICHIRAN_DATABASE_URL must point to a restored Ichiran database/);
  await app.close();
  await yomichi.close();
  await notIchiran.close();
});
