/** Renderer checks with explicitly synthetic HTTP responses, never production data.
 * Start Playground first: npm run playground
 * Run: node --import tsx scripts/demo/verb-inflections-smoke.ts
 */
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { generateVerbInflections } from "../../packages/core/src/verb-inflections.js";
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const base = process.env.YOMICHI_PLAYGROUND_URL ?? "http://127.0.0.1:5183";
const server = process.env.YOMICHI_PLAYGROUND_URL
  ? null
  : spawn(
      process.execPath,
      [
        "node_modules/vite/bin/vite.js",
        "apps/playground",
        "--host",
        "127.0.0.1",
        "--port",
        "5183",
        "--strictPort",
      ],
      { stdio: "ignore" },
    );
for (let attempt = 0; attempt < 50; attempt++) {
  try {
    if ((await fetch(base)).ok) break;
  } catch {
    /* wait for Vite */
  }
  if (attempt === 49) throw new Error("Playground did not start");
  await delay(100);
}
const errors: string[] = [];
try {
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/readyz", (r) =>
      r.fulfill({
        json: { ready: true, ichiran: { version: "synthetic-smoke" } },
      }),
    );
    let release: (() => void) | undefined;
    let slow = false;
    await page.route("**/v1/ichiran/analyze", (r) =>
      r.fulfill({
        json: {
          text: "分析",
          method: "hepburn-traditional",
          romanization: "synthetic-analysis",
          parts: [],
        },
      }),
    );
    await page.route("**/v1/verbs/inflections", async (route) => {
      const request = route.request().postDataJSON();
      if (request.word === "いる" && !request.entryId) {
        await route.fulfill({
          status: 409,
          json: {
            error: { code: "AMBIGUOUS_VERB", message: "Synthetic choice" },
            candidates: [
              {
                entryId: "1",
                senseIds: ["1"],
                reading: "いる",
                pos: "v1",
                spellings: ["居る"],
                glosses: ["synthetic: remain"],
              },
              {
                entryId: "2",
                senseIds: ["2"],
                reading: "いる",
                pos: "v5r",
                spellings: ["要る"],
                glosses: ["synthetic: need"],
              },
            ],
          },
        });
        return;
      }
      if (slow)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      const word = request.word;
      const result = generateVerbInflections(
        word,
        word === "待つ" ? "まつ" : "いる",
        [word === "待つ" ? "v5t" : "v5r"],
        { lexicalForms: word === "いる" ? ["要る"] : [word] },
      )!;
      await route.fulfill({
        json: { ...result, entryId: "2", senseIds: ["2"], spellings: [word] },
      });
    });
    await page.goto(base);
    await page.selectOption("#locale", "zh");
    await page.click("#tab-tools");
    await page.selectOption("#tool", "verbs/inflections");
    await page.fill("#input", "待つ");
    await page.click("#run");
    await page.getByText("非过去（普通形）", { exact: true }).waitFor();
    assert.equal(await page.locator(".verb-row").count(), 17);
    const causative = page
      .locator(".verb-row")
      .filter({ has: page.locator(".verb-label", { hasText: "使役被动形" }) });
    await causative.locator("summary").click();
    await causative
      .getByRole("button", { name: "复制 待たされない", exact: true })
      .waitFor();
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await causative
      .getByRole("button", { name: "复制 待たされない", exact: true })
      .click();
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      "待たされない",
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.equal(
      await causative
        .locator(".verb-surface")
        .first()
        .evaluate((e) => getComputedStyle(e).whiteSpace),
      "nowrap",
    );
    await page.fill("#input", "いる");
    await page.click("#run");
    await page.getByRole("heading", { name: "选择词典义项" }).waitFor();
    await page.getByRole("button", { name: /要る.*v5r/ }).click();
    await page
      .locator(".verb-surface")
      .filter({ hasText: /^いらない$/ })
      .waitFor();
    const potential = page
      .locator(".verb-row")
      .filter({ has: page.locator(".verb-label", { hasText: /^可能形$/ }) });
    await potential.locator("summary").click();
    await potential.getByText("不适用", { exact: true }).waitFor();
    assert.equal(await page.locator(".verb-choice").count(), 0);
    await page.screenshot({
      path: `/tmp/yomichi-inflections-${width}.png`,
      fullPage: true,
    });
    // A response from a detached tool must not replace analysis debug JSON.
    await page.fill("#input", "いる");
    await page.click("#run");
    await page.getByRole("heading", { name: "选择词典义项" }).waitFor();
    slow = true;
    await page.getByRole("button", { name: /要る.*v5r/ }).click();
    await page.waitForFunction(
      () => document.querySelector<HTMLButtonElement>(".verb-choice")?.disabled,
    );
    while (!release) await delay(10);
    await page.click("#tab-analyze");
    await page.fill("#input", "分析");
    await page.click("#run");
    await page.waitForFunction(() =>
      document
        .querySelector("#response")
        ?.textContent?.includes("synthetic-analysis"),
    );
    const debug = await page.locator("#response").textContent();
    release();
    await page.waitForResponse(
      (r) => r.url().endsWith("/v1/verbs/inflections") && r.status() === 200,
    );
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert.equal(await page.locator("#response").textContent(), debug);
    await page.close();
    console.log(
      `Passed synthetic renderer smoke at ${width}px (copy, variants, ambiguity, no page overflow).`,
    );
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  server?.kill();
}
