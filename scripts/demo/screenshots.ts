/** Playground and API-docs screenshots against a running API on :3000 with
 * the Ichiran engine. Starts the Playground dev server itself.
 *
 *   node --import tsx scripts/demo/screenshots.ts [OUT_DIR]
 *
 * CHROMIUM_PATH selects a browser binary. Fails on page errors or when an
 * expected element does not appear. */
import { chromium, type Page } from "@playwright/test";
import { createServer } from "vite";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const out = process.argv[2] ?? "docs/screenshots";
await mkdir(out, { recursive: true });
const vite = await createServer({
  root: "apps/playground",
  configFile: "apps/playground/vite.config.ts",
  server: { port: 5173, host: "127.0.0.1", strictPort: true },
  logLevel: "warn",
});
await vite.listen();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  headless: true,
  args: ["--no-sandbox"],
});
const shots: string[] = [];
async function shot(page: Page, name: string, fullPage = true) {
  const path = `${out}/${name}.png`;
  await page.screenshot({ path, fullPage, animations: "disabled" });
  shots.push(path);
}
async function analyze(page: Page, text: string) {
  await page.locator("#tab-analyze").click();
  await page.locator("#input").fill(text);
  await page.locator("#run").click();
  await page.locator("#output").waitFor();
  await page.locator(".token").first().waitFor();
}
async function open(page: Page, surface: string, expect: string) {
  await page.locator(".token").filter({ hasText: surface }).first().click();
  await page.locator("#detail-content").filter({ hasText: expect }).waitFor();
}
try {
  const errors: string[] = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173");
  await page.locator("#status").filter({ hasText: "Dictionary connected" }).waitFor();
  assert.equal(await page.locator("#version").innerText(), "ichiran-260118");
  await shot(page, "01-home");

  // conjugated verb: lemma, conjugation chain and meanings
  await analyze(page, "猫は魚を食べさせられなかった。");
  await open(page, "食べさせられなかった", "Causative-Passive");
  assert.match(await page.locator("#alpha-note").innerText(), /TypeScript port of Ichiran/);
  await shot(page, "02-conjugation-detail");

  // suffix compound and its components
  await analyze(page, "行きたいけど、もう食べてしまった。");
  await open(page, "食べてしまった", "しまった");
  await shot(page, "03-compound-components");
  await page.locator(".alt-word").filter({ hasText: "しまった" }).click();
  await page.locator("#detail-content").filter({ hasText: "indicates completion" }).waitFor();
  await shot(page, "04-suffix-component");

  // romaji annotation and counters
  await analyze(page, "ｶﾀｶﾅで書いた手紙が3通あります。");
  await page.locator("#annotation").selectOption("romaji");
  await page.locator(".token rt").filter({ hasText: "santsū" }).waitFor();
  await open(page, "3通", "ctr");
  await shot(page, "05-romaji-counter");

  // alternative candidates
  await page.locator("#annotation").selectOption("reading");
  await analyze(page, "東京都に住んでいる");
  const candidates = await page.locator(".candidate").count();
  assert.ok(candidates >= 2, "several candidates");
  await page.locator(".candidate").nth(1).click();
  await shot(page, "06-second-candidate");

  // Chinese interface
  await page.locator("#locale").selectOption("zh");
  await analyze(page, "日本語を勉強しています");
  await open(page, "勉強しています", "勉強");
  assert.match(await page.locator("#alpha-note").innerText(), /Ichiran TypeScript 移植版/);
  await shot(page, "07-chinese-ui");

  // mobile: drawer and no horizontal overflow
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  mobile.on("pageerror", (e) => errors.push(e.message));
  await mobile.goto("http://127.0.0.1:5173");
  await mobile.locator("#status").filter({ hasText: "Dictionary connected" }).waitFor();
  await analyze(mobile, "駅の前で会いましょう。");
  await shot(mobile, "08-mobile-result", false);
  await open(mobile, "会いましょう", "Volitional");
  assert.ok(await mobile.locator("#close").isVisible());
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await shot(mobile, "09-mobile-detail", false);

  // API documentation served by the API
  const docs = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await docs.goto("http://127.0.0.1:3000/docs");
  await docs.locator(".opblock-tag").filter({ hasText: "ichiran" }).first().waitFor();
  await shot(docs, "10-api-docs");

  assert.deepEqual(errors, []);
  console.log(shots.join("\n"));
} finally {
  await browser.close();
  await vite.close();
}
