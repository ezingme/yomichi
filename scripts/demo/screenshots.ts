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
  await page.locator(".im-card").first().waitFor();
}
const card = (page: Page, romanization: string) =>
  page.locator(".im-card").filter({ has: page.locator(".im-card-title", { hasText: new RegExp(`^${romanization}$`) }) });
try {
  const errors: string[] = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173");
  await page.locator("#status").filter({ hasText: "Dictionary connected" }).waitFor();
  assert.equal(await page.locator("#version").innerText(), "ichiran-260118");
  await shot(page, "01-home");

  // the example from ichi.moe: runs, romanized line, word cards with a compound
  await analyze(page, "べんきょう しています");
  assert.equal(await page.locator(".im-romaji").innerText(), "benkyō shiteimasu");
  const heading = await page.locator(".im-sentence > .im-misc, .im-sentence .im-part-text").allTextContents();
  assert.equal(heading.join(""), "べんきょう しています");
  await card(page, "shiteimasu").filter({ hasText: "Compound word: して + います" }).waitFor();
  assert.match(await page.locator("#alpha-note").innerText(), /TypeScript port of Ichiran/);
  await shot(page, "02-ichimoe-compound");

  // alternatives, compounds, counters and a conjugation via chain
  await analyze(page, "本を読んでいる学生が3人います。食べさせられなかった");
  await card(page, "hon/moto").filter({ hasText: "2. 本 【もと】" }).waitFor();
  await card(page, "sannin").filter({ hasText: "Value: 3" }).waitFor();
  await card(page, "tabesaserarenakatta").filter({ hasText: "Causative-Passive" }).waitFor();
  await shot(page, "03-cards");

  // choosing another segmentation of a run
  await page.locator(".im-part-text").first().click();
  await page.locator(".im-picks:not([hidden]) .im-pick").first().waitFor();
  await shot(page, "04-segmentation-menu", false);
  await page.locator(".im-picks:not([hidden]) .im-pick").nth(1).click();
  await shot(page, "05-second-segmentation");

  // a secondary conjugation reachable through two roots: one "via" block
  await analyze(page, "キャシィは帽子を吹き飛ばされた。");
  const fuki = card(page, "fukitobasareta");
  assert.equal(await fuki.locator(".im-via").count(), 1);
  assert.equal(await fuki.locator(".im-conj-via .im-conj-root").count(), 2);
  await fuki.scrollIntoViewIfNeeded();
  await shot(page, "05b-conjugation-via");

  // omitted entries expand in place
  await analyze(page, "寿司は美味しい");
  await card(page, "wa").locator(".im-omitted").click();
  await card(page, "wa").locator(".im-all").waitFor();
  await shot(page, "06-omitted-entries");

  // Chinese interface
  await page.locator("#locale").selectOption("zh");
  await analyze(page, "日本語を勉強しています");
  await card(page, "benkyō shiteimasu").filter({ hasText: "复合词" }).waitFor();
  assert.match(await page.locator("#alpha-note").innerText(), /Ichiran TypeScript 移植版/);
  await shot(page, "07-chinese-ui");

  // mobile: one card per row and no horizontal overflow
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  mobile.on("pageerror", (e) => errors.push(e.message));
  await mobile.goto("http://127.0.0.1:5173");
  await mobile.locator("#status").filter({ hasText: "Dictionary connected" }).waitFor();
  await analyze(mobile, "駅の前で会いましょう。");
  await mobile.locator(".im-sentence").scrollIntoViewIfNeeded();
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await shot(mobile, "08-mobile-result", false);
  await card(mobile, "aimashō").scrollIntoViewIfNeeded();
  await shot(mobile, "09-mobile-card", false);

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
