/** Compares Yomichi's Ichiran results with what https://ichi.moe displays.
 *
 * For each sentence the ichi.moe result page (/cl/qr/, Hepburn traditional)
 * is fetched with curl (cached, one request per --delay ms). It is parsed in
 * an offline Chromium page with JavaScript disabled. The comparison covers:
 *   - the text runs;
 *   - every displayed path with its score and romanization;
 *   - the word cards of each run's best path: romanization, omitted count,
 *     readings, senses, notes, fields, counters, compounds, suffixes and
 *     conjugations.
 * Yomichi's side is computed with the same view model the Playground renders.
 *
 *   ICHIRAN_DATABASE_URL=postgres://.../ichiran \
 *   node --import tsx scripts/oracle/ichimoe-compare.ts sentences.jsonl \
 *     [--cache DIR] [--delay 2000] [--limit N] [--out report.json]
 *     [--dump views.json]   (also write ichi.moe's parsed views, e.g. as test fixtures)
 *
 * sentences.jsonl: one {"text": "..."} per line, or plain text lines.
 * Please keep the request rate low; ichi.moe is a free community service. */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";
import pg from "pg";
import { cardView, ichiranResult, IchiranStore, type CardView, type IchiranEngine } from "../../packages/core/src/ichiran/index.js";
import { PgIchiranSource } from "../../packages/dictionary/src/ichiran-source.js";

const args = process.argv.slice(2);
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const cacheDir = opt("--cache") ?? "data/ichimoe-cache";
const delay = Number(opt("--delay") ?? 2000);
const limit = Number(opt("--limit") ?? Infinity);
const input = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!input || !process.env.ICHIRAN_DATABASE_URL) {
  console.error("Usage: ICHIRAN_DATABASE_URL=... ichimoe-compare.ts sentences.jsonl [--cache DIR] [--delay MS] [--limit N] [--out FILE]");
  process.exit(1);
}
const sentences = (await readFile(input, "utf8"))
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => (l.trim().startsWith("{") ? (JSON.parse(l).text as string) : l.trim()))
  .slice(0, limit);

/** What ichi.moe and Yomichi both show for a text. */
interface PageView {
  parts: { type: "word" | "misc"; text: string }[];
  /** For each word run: displayed paths. */
  picks: { score: number; romanization: string }[][];
  /** For each word run: cards of the best path. */
  cards: CardView[][];
}

await mkdir(cacheDir, { recursive: true });
let lastFetch = 0;
async function fetchPage(text: string): Promise<string> {
  const file = `${cacheDir}/${createHash("sha256").update(text).digest("hex").slice(0, 24)}.html`;
  try {
    return await readFile(file, "utf8");
  } catch {}
  const wait = lastFetch + delay - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetch = Date.now();
  const url = `https://ichi.moe/cl/qr/?${new URLSearchParams({ q: text, r: "htr" })}`;
  const { stdout } = await promisify(execFile)("curl", ["-sS", "-m", "60", "--fail", url], { maxBuffer: 64 << 20 });
  await writeFile(file, stdout);
  return stdout;
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ javaScriptEnabled: false });
await context.route("**/*", (route) => route.abort());
const page = await context.newPage();

/** Parses an ichi.moe result page into the shared view model. Runs in the page. */
function parseIchimoe(): PageView {
  const kids = (n: Element, sel: string) => [...n.children].filter((c) => c.matches(sel));
  const kid = (n: Element, sel: string) => kids(n, sel)[0];
  const txt = (n: Element | undefined | null) => (n?.textContent ?? "").replace(/\s+/g, " ").trim();
  const senses = (ol: Element | undefined) =>
    ol
      ? kids(ol, "li").map((li) => {
          const v: any = { pos: txt(li.querySelector(".pos-desc")), gloss: txt(li.querySelector(".gloss-desc")) };
          const note = li.querySelector(".sense-info-note");
          if (note) v.note = note.getAttribute("title") ?? "";
          const field = li.querySelector(".field-desc");
          if (field) v.field = txt(field);
          return v;
        })
      : [];
  // A .conjugation or .conj-via holds a sequence of conjugations, each its
  // .conj-prop lines followed by a .conj-gloss or a nested .conj-via
  const conjs = (n: Element): any[] => {
    const out: any[] = [];
    let cur: any = null;
    for (const c of n.children) {
      if (c.matches(".conj-prop")) {
        if (!cur || "reading" in cur || "via" in cur) out.push((cur = { props: [] }));
        cur.props.push({
          pos: txt(c.querySelector(".pos-desc")).replace(/^\[|\]$/g, ""),
          type: txt(c.querySelector(".conj-type")),
          negative: !!c.querySelector(".conj-negative"),
          formal: !!c.querySelector(".conj-formal"),
        });
      } else if (c.matches(".conj-via") && cur) cur.via = conjs(c);
      else if (c.matches(".conj-gloss") && cur) {
        const dl = c.querySelector("dl");
        cur.reading = txt(dl?.querySelector("dt"));
        cur.senses = senses(dl?.querySelector("dd > ol.gloss-definitions") ?? undefined);
      }
    }
    return out;
  };
  const entries = (dl: Element, numbered: boolean): any[] => {
    const out: any[] = [];
    const items = [...dl.children];
    for (let i = 0; i < items.length; i++) {
      if (!items[i].matches("dt")) continue;
      const dd = items[i + 1];
      const e: any = { reading: numbered ? txt(items[i]).replace(/^\d+\.\s*/, "") : txt(items[i]), senses: [], conjugations: [] };
      const counter = kid(dd, ".counter-value");
      if (counter) e.counter = txt(counter);
      const compound = kid(dd, ".compound-desc");
      if (compound) {
        const parts = kid(dd, "dl.compounds");
        e.compound = {
          words: txt(compound.querySelector(".compound-desc-word")).split(" + "),
          parts: parts ? entries(parts, false) : [],
        };
      }
      const suffix = kid(dd, ".suffix-desc");
      if (suffix) e.suffix = txt(suffix).replace(/^\[|\]$/g, "");
      e.senses = senses(kid(dd, "ol.gloss-definitions"));
      const conjList = kid(dd, ".conjugations");
      if (conjList) e.conjugations = kids(conjList, ".conjugation").flatMap(conjs);
      out.push(e);
    }
    return out;
  };
  const parts = [...document.querySelectorAll("h2.query-text-full > .query-text")].map((s) => ({
    type: s.classList.contains("query-word") ? ("word" as const) : ("misc" as const),
    text: s.textContent ?? "",
  }));
  const picks: any[] = [];
  const cards: any[] = [];
  parts.forEach((p, i) => {
    if (p.type !== "word") return;
    picks.push(
      [...document.querySelectorAll(`.ds-text[data-part="${i}"]`)].map((d) => ({
        score: Number(d.getAttribute("data-score")),
        romanization: [...d.querySelectorAll(".ds-word")].map((w) => txt(w)).join(" "),
      })),
    );
    const row = document.querySelector(`.gloss-row[data-part="${i}"][data-pick="0"]`);
    cards.push(
      [...(row?.querySelectorAll(".gloss") ?? [])].map((g) => {
        const dl = g.querySelector(".gloss-content > dl.alternatives");
        const numbered = !!dl && /^\d+\.\s/.test(txt(dl.querySelector("dt")));
        const skipped = g.querySelector(".note-skipped");
        return {
          romanization: txt(g.querySelector(".gloss-rtext em")),
          entries: dl ? entries(dl, numbered) : [],
          skipped: skipped ? Number(txt(skipped).replace(/\D+/g, "")) : 0,
        };
      }),
    );
  });
  return { parts, picks, cards };
}

async function ichimoeView(text: string): Promise<PageView> {
  await page.setContent(await fetchPage(text), { waitUntil: "domcontentloaded" });
  // the TypeScript loader wraps functions with __name(); define it in the page
  await page.evaluate("globalThis.__name = (f) => f");
  return page.evaluate(parseIchimoe);
}

const pool = new pg.Pool({ connectionString: process.env.ICHIRAN_DATABASE_URL, max: 4 });
const engine: IchiranEngine = {
  store: new IchiranStore(),
  source: new PgIchiranSource(pool),
  dictionary: { version: "ichiran-database", source: "", entryCount: 0, capabilities: [] },
};
async function yomichiView(text: string): Promise<PageView> {
  const r = await ichiranResult(engine, text, { limit: 5 });
  const words = r.parts.filter((p) => p.type === "word");
  return {
    parts: r.parts.map((p) => ({ type: p.type, text: p.display })),
    picks: words.map((p) => p.paths.map((path) => ({ score: path.score, romanization: path.romanization }))),
    cards: words.map((p) => (p.paths[0]?.words ?? []).map((w) => cardView(w.romanization, w.gloss, w.skipped))),
  };
}

/** First difference between two JSON values, as a path. */
function diff(a: unknown, b: unknown, path = ""): string | null {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = diff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
  } else if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = diff((a as any)[k], (b as any)[k], `${path}.${k}`);
      if (d) return d;
    }
  }
  return `${path}: ichi.moe=${JSON.stringify(a)?.slice(0, 160)} yomichi=${JSON.stringify(b)?.slice(0, 160)}`;
}

const report: { text: string; equal: Record<string, boolean>; diff?: string }[] = [];
const dumped: { text: string; view: PageView }[] = [];
const totals = { sentences: 0, parts: 0, picks: 0, cards: 0, all: 0 };
try {
  for (const text of sentences) {
    const [a, b] = [await ichimoeView(text), await yomichiView(text)];
    dumped.push({ text, view: a });
    const equal = {
      parts: JSON.stringify(a.parts) === JSON.stringify(b.parts),
      picks: JSON.stringify(a.picks) === JSON.stringify(b.picks),
      cards: JSON.stringify(a.cards) === JSON.stringify(b.cards),
    };
    const all = equal.parts && equal.picks && equal.cards;
    totals.sentences++;
    for (const k of ["parts", "picks", "cards"] as const) if (equal[k]) totals[k]++;
    if (all) totals.all++;
    const d = all ? undefined : (diff(a, b) ?? undefined);
    report.push({ text, equal, ...(d ? { diff: d } : {}) });
    console.log(`${all ? "SAME" : "DIFF"} ${text}${d ? `\n     ${d}` : ""}`);
  }
} finally {
  await browser.close();
  await pool.end();
}
console.log(JSON.stringify(totals));
const out = opt("--out");
if (out) await writeFile(out, JSON.stringify({ comparedAt: new Date().toISOString(), totals, report }, null, 1));
const dump = opt("--dump");
if (dump)
  await writeFile(
    dump,
    JSON.stringify(
      {
        source: "https://ichi.moe/cl/qr/ (Hepburn traditional), parsed by scripts/oracle/ichimoe-compare.ts",
        capturedAt: new Date().toISOString(),
        cases: dumped,
      },
      null,
      1,
    ) + "\n",
  );
process.exitCode = totals.all === totals.sentences ? 0 : 1;
