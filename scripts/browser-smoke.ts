import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { PGlite } from "@electric-sql/pglite";
import { createReadStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { migrate } from "../packages/dictionary/src/schema.js";
import { importDictionary } from "../packages/dictionary/src/import.js";
import { PostgresDictionary } from "../packages/dictionary/src/repository.js";
import { buildApp } from "../packages/server/src/app.js";
const db = new PGlite();
await migrate(db);
await importDictionary(
  db,
  createReadStream(
    process.env.YOMICHI_SMOKE_XML ?? "tests/fixtures/browser.xml",
  ),
  {
    kind: "jmdict",
    version: process.env.YOMICHI_SMOKE_XML
      ? "EDRDG subset · verification only"
      : "Synthetic fixture · CI only",
  },
);
const api = await buildApp({
  repository: () => new PostgresDictionary(db),
  rateMax: 1000,
});
await api.listen({ host: "127.0.0.1", port: 3000 });
const vite = await createServer({
  root: "apps/playground",
  configFile: "apps/playground/vite.config.ts",
  server: { port: 5173, host: "127.0.0.1", strictPort: true },
});
await vite.listen();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  headless: true,
  args: ["--no-sandbox"],
});
try {
  await mkdir("docs/screenshots", { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173");
  await page
    .locator("#status")
    .filter({ hasText: "Dictionary connected" })
    .waitFor();
  await page.screenshot({
    path: "docs/screenshots/playground-desktop-empty.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.locator('[data-example="猫は魚を食べました。"]').click();
  await page.locator(".token").first().waitFor();
  assert.ok((await page.locator("#tokens").innerText()).includes("食べました"));
  await page.locator(".token").filter({ hasText: "食べました" }).click();
  await page
    .locator("#detail-content")
    .filter({ hasText: "polite past" })
    .waitFor();
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({
    path: "docs/screenshots/playground-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.locator("#locale").selectOption("zh");
  assert.equal(await page.locator("h1").innerText(), "从每个词，读懂日语。");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#close").click();
  await page.locator(".token").filter({ hasText: "食べました" }).click();
  assert.ok(await page.locator("#close").isVisible());
  await page.screenshot({
    path: "docs/screenshots/playground-mobile.png",
    fullPage: false,
    animations: "disabled",
  });
  await page.locator("#close").click();
  assert.ok(!(await page.locator("#detail").isVisible()));
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  assert.equal(overflow, false);
  await page.locator("#tab-words").click();
  await page.locator("#input").fill("食");
  await page.locator("#run").click();
  await page.locator(".word-card").first().waitFor();
  await page.locator("#tab-kanji").click();
  await page.locator("#input").fill("猫");
  await page.locator("#run").click();
  await page.locator("#error").waitFor();
  assert.ok(
    (await page.locator("#error").innerText()).includes("Import KANJIDIC2"),
  );
  assert.deepEqual(errors, []);
  console.log(
    "Browser smoke passed: dictionary analyze/detail, Chinese UI, mobile drawer/overflow, word search, missing-kanji error.",
  );
} finally {
  await browser.close();
  await vite.close();
  await api.close();
  await db.close();
}
