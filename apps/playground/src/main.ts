import "./style.css";
import { messages, type Locale } from "./i18n.js";
import { YomichiClient } from "../../../packages/client/src/index.js";
import type {
  Analysis,
  Token,
  Entry,
  Kanji,
} from "../../../packages/core/src/types.js";
const apiBase = ((import.meta as any).env.VITE_API_BASE_URL ?? "").replace(
  /\/$/,
  "",
);
const client = new YomichiClient(apiBase);
let locale: Locale = "en",
  mode: "analyze" | "words" | "kanji" = "analyze",
  result: Analysis | null = null,
  selected = 0,
  busy = false,
  lastRequest: unknown = null,
  lastResponse: unknown = null;
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const t = () => messages[locale];
const el = (tag: string, className = "", text = "") => {
  const n = document.createElement(tag);
  n.className = className;
  n.textContent = text;
  return n;
};
$("app").innerHTML =
  `<header class="header"><a class="brand" href="/" aria-label="Yomichi home"><span class="mark">よ</span><span>yomichi<span class="brand-sub">PLAYGROUND</span></span></a><nav><a id="docs" target="_blank" rel="noreferrer"></a><a href="https://github.com/ezingme/yomichi" id="source" target="_blank" rel="noreferrer"></a><select id="locale" aria-label="Interface language"><option value="en">EN</option><option value="zh">中文</option><option value="ja">日本語</option></select></nav></header>
<main><section class="hero"><div><p class="eyebrow" id="eyebrow"></p><h1 id="title"></h1><p id="intro" class="intro"></p></div><div class="hero-art" aria-hidden="true"><span>読</span><small>よむ · to read</small></div></section>
<section class="input-card"><div class="tabs" role="tablist" aria-label="Tools"><button id="tab-analyze" role="tab" data-mode="analyze"></button><button id="tab-words" role="tab" data-mode="words"></button><button id="tab-kanji" role="tab" data-mode="kanji"></button></div><form id="form"><label for="input" id="label"></label><textarea id="input" rows="3" lang="ja" spellcheck="false"></textarea><div class="input-meta"><span id="hint"></span><span id="count">0 / 500</span></div><div class="input-actions"><div class="examples"><span id="examples-label"></span><button type="button" data-example="駅の前で会いましょう。">駅の前で会いましょう。</button><button type="button" data-example="猫は魚を食べました。">猫は魚を食べました。</button></div><button class="primary" id="run" type="submit"></button></div></form></section>
<div id="error" class="error" role="alert" hidden></div><div class="connection"><span class="dot" id="dot"></span><span id="status"></span><span id="version"></span></div>
<section class="results"><div class="result-main"><div class="section-heading"><h2 id="result-title"></h2><span class="badge" id="alpha"></span></div><div id="empty" class="empty"><span class="empty-symbol" aria-hidden="true">文</span><h3 id="empty-title"></h3><p id="empty-note"></p></div><div id="output" hidden><div class="result-controls"><div id="candidates" class="candidate-list" aria-label="Candidates"></div><select id="annotation" aria-label="Annotation"><option value="reading">Reading</option><option value="romaji">Romaji</option></select></div><div id="tokens" class="tokens" lang="ja"></div><div id="lookup"></div><p class="alpha-note" id="alpha-note"></p></div></div><aside id="detail" class="detail"><div class="section-heading"><h2 id="detail-title"></h2><button type="button" id="close" class="close" aria-label="Close details">×</button></div><div id="detail-content"></div></aside></section>
<details class="developer" id="developer"><summary id="developer-title"></summary><div class="developer-header"><code id="endpoint"></code><button id="copy" type="button"></button></div><div class="code-grid"><div><h3 id="request-title"></h3><pre id="request"></pre></div><div><h3 id="response-title"></h3><pre id="response"></pre></div></div></details>
<footer><span>Yomichi · よみち</span><span>Built on open knowledge. <a href="https://www.edrdg.org/" target="_blank" rel="noreferrer">Dictionary data: EDRDG</a></span></footer></main>`;
$("docs").setAttribute("href", apiBase + "/docs");
function translate() {
  document.documentElement.lang = locale;
  for (const [id, key] of Object.entries({
    docs: "docs",
    source: "source",
    eyebrow: "eyebrow",
    title: "title",
    intro: "intro",
    label: "label",
    hint: "hint",
    "examples-label": "examples",
    alpha: "alpha",
    "empty-title": "empty",
    "empty-note": "emptyNote",
    "detail-title": "details",
    "developer-title": "developer",
    "request-title": "request",
    "response-title": "response",
    "alpha-note": "alphaNote",
    copy: "copy",
  }))
    $(id).textContent = t()[key as keyof typeof messages.en];
  for (const m of ["analyze", "words", "kanji"] as const) {
    $("tab-" + m).textContent = t()[m];
    $("tab-" + m).setAttribute("aria-selected", String(mode === m));
  }
  $("result-title").textContent =
    mode === "analyze"
      ? t().result
      : mode === "words"
        ? t().wordTitle
        : t().kanjiTitle;
  $("run").textContent = busy ? t().working : t().run;
  $("close").setAttribute("aria-label", t().close);
  $<HTMLTextAreaElement>("input").placeholder =
    mode === "analyze"
      ? t().placeholder
      : mode === "words"
        ? t().searchPlaceholder
        : t().kanjiPlaceholder;
  $<HTMLSelectElement>("annotation").options[0].text = t().reading;
  $<HTMLSelectElement>("annotation").options[1].text = t().romaji;
  if (!result) $("detail-content").textContent = t().select;
}
function reset() {
  result = null;
  selected = 0;
  $("output").hidden = true;
  $("empty").hidden = false;
  $("error").hidden = true;
  $("detail").classList.remove("open");
  $("detail-content").textContent = t().select;
}
async function status() {
  try {
    const r = await fetch(apiBase + "/readyz", {
      signal: AbortSignal.timeout(5000),
    });
    const d = await r.json();
    $("status").textContent = d.ready ? t().ready : t().offline;
    $("dot").classList.toggle("online", !!d.ready);
    $("version").textContent = d.dictionary?.version ?? "";
  } catch {
    $("status").textContent = t().offline;
  }
}
function showDetail(token: Token, opener: HTMLElement) {
  const box = $("detail-content");
  box.replaceChildren();
  box.append(
    el("p", "detail-reading", token.reading ?? ""),
    el("h3", "detail-word", token.surface),
  );
  if (token.kind !== "word") {
    box.append(
      el("p", "muted", token.kind === "unknown" ? t().unknown : t().separator),
    );
  } else {
    box.append(
      el("p", "pos", token.pos.join(" · ")),
      el("h4", "", t().lemma),
      el("p", "lemma", token.lemma ?? ""),
    );
    if (token.conjugationSteps.length) {
      box.append(el("h4", "", t().conjugation));
      for (const s of token.conjugationSteps) box.append(el("span", "step", s));
    }
    if (token.senses.length) {
      box.append(el("h4", "", t().meaning));
      const list = el("ol");
      for (const s of token.senses) {
        const item = el("li");
        for (const g of s.glosses)
          item.append(el("span", "gloss", `${g.text} (${g.language})`));
        list.append(item);
      }
      box.append(list);
    }
    if (token.alternatives.length) {
      box.append(el("h4", "", t().alternatives));
      for (const a of token.alternatives) {
        const button = el("button", "alt-word", `${a.lemma} · ${a.reading}`);
        button.addEventListener("click", async () => {
          try {
            const e = await client.word(a.entryId);
            showDetail(
              {
                ...token,
                lemma: a.lemma,
                reading: a.reading,
                entryId: a.entryId,
                pos: a.pos,
                conjugationSteps: a.conjugationSteps,
                senses: a.senseIndices.map((i) => e.senses[i]).filter(Boolean),
                alternatives: [],
              },
              opener,
            );
          } catch (e) {
            showError(e);
          }
        });
        box.append(button);
      }
    }
  }
  $("detail").classList.add("open");
  $("close").onclick = () => {
    $("detail").classList.remove("open");
    opener.focus();
  };
  if (matchMedia("(max-width: 760px)").matches) $("close").focus();
}
function renderAnalysis() {
  if (!result) return;
  $("lookup").replaceChildren();
  $("tokens").replaceChildren();
  $("candidates").replaceChildren();
  result.candidates.forEach((_c, i) => {
    const b = el(
      "button",
      i === selected ? "candidate active" : "candidate",
      `${t().candidate} ${i + 1}`,
    );
    b.setAttribute("aria-pressed", String(i === selected));
    b.onclick = () => {
      selected = i;
      renderAnalysis();
    };
    $("candidates").append(b);
  });
  for (const token of result.candidates[selected].tokens) {
    if (token.kind === "separator") {
      $("tokens").append(document.createTextNode(token.surface));
      continue;
    }
    const b = el("button", "token " + token.kind);
    const ruby = el("ruby", "", token.surface);
    ruby.append(
      el(
        "rt",
        "",
        ($<HTMLSelectElement>("annotation").value === "reading"
          ? token.reading
          : token.romanization) ?? "—",
      ),
    );
    b.append(ruby);
    b.setAttribute(
      "aria-label",
      `${token.surface}, ${token.reading ?? t().unknown}`,
    );
    b.onclick = () => {
      document
        .querySelectorAll(".token.selected")
        .forEach((n) => n.classList.remove("selected"));
      b.classList.add("selected");
      showDetail(token, b);
    };
    $("tokens").append(b);
  }
  $("alpha-note").textContent = t().alphaNote;
}
function wordCard(e: Entry) {
  const card = el("article", "word-card");
  card.append(
    el("h3", "", e.spellings.join(" / ") || e.readings[0]?.text || ""),
    el("p", "detail-reading", e.readings.map((r) => r.text).join(" · ")),
  );
  for (const s of e.senses)
    card.append(
      el("p", "", s.glosses.map((g) => `${g.text} (${g.language})`).join("; ")),
    );
  return card;
}
function showError(e: unknown) {
  $("error").hidden = false;
  $("error").textContent =
    `${t().error} ${e instanceof Error ? e.message : ""}`;
}
$("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  const text = $<HTMLTextAreaElement>("input").value;
  if (!text.trim()) {
    $<HTMLTextAreaElement>("input").focus();
    return;
  }
  if (Array.from(text).length > 500) {
    showError(new Error("Maximum 500 characters."));
    return;
  }
  reset();
  busy = true;
  $<HTMLButtonElement>("run").disabled = true;
  translate();
  try {
    const path =
      mode === "analyze"
        ? "/v1/analyze"
        : mode === "words"
          ? `/v1/words/search?q=${encodeURIComponent(text.trim())}`
          : `/v1/kanji/${encodeURIComponent(text.trim())}`;
    lastRequest =
      mode === "analyze" ? { text, limit: 5, romanization: "hepburn" } : null;
    $("endpoint").textContent =
      (mode === "analyze" ? "POST " : "GET ") + apiBase + path;
    if (mode === "analyze") {
      result = await client.analyze(lastRequest as any);
      lastResponse = result;
      renderAnalysis();
    } else {
      $("tokens").replaceChildren();
      $("candidates").replaceChildren();
      $("lookup").replaceChildren();
      if (mode === "words") {
        const r = await client.search(text.trim());
        lastResponse = r;
        if (!r.items.length)
          $("lookup").append(el("p", "muted", t().noResults));
        r.items.forEach((e) => $("lookup").append(wordCard(e)));
      } else {
        const k: Kanji = await client.kanji(text.trim());
        lastResponse = k;
        const card = el("article", "word-card");
        card.append(
          el("h3", "kanji-glyph", k.character),
          el(
            "p",
            "",
            `${t().strokes}: ${k.strokeCounts.join(", ")} · ${t().grade}: ${k.grade ?? "—"} · ${t().frequency}: ${k.frequency ?? "—"}`,
          ),
        );
        card.append(
          el(
            "p",
            "detail-reading",
            k.readings.map((r) => `${r.text} (${r.type})`).join(" · "),
          ),
          el(
            "p",
            "",
            k.meanings.map((m) => `${m.text} (${m.language})`).join("; "),
          ),
        );
        $("lookup").append(card);
      }
    }
    $("output").hidden = false;
    $("empty").hidden = true;
    $("request").textContent = lastRequest
      ? JSON.stringify(lastRequest, null, 2)
      : path;
    $("response").textContent = JSON.stringify(lastResponse, null, 2);
    $("output").setAttribute("aria-live", "polite");
  } catch (e) {
    showError(e);
  } finally {
    busy = false;
    $<HTMLButtonElement>("run").disabled = false;
    translate();
  }
});
$("locale").addEventListener("change", () => {
  locale = $<HTMLSelectElement>("locale").value as Locale;
  translate();
  if (result) renderAnalysis();
  void status();
});
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-mode]",
))
  button.onclick = () => {
    if (busy) return;
    mode = button.dataset.mode as typeof mode;
    reset();
    translate();
  };
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-example]",
))
  button.onclick = () => {
    if (busy) return;
    mode = "analyze";
    $<HTMLTextAreaElement>("input").value = button.dataset.example!;
    updateCount();
    translate();
    $<HTMLFormElement>("form").requestSubmit();
  };
function updateCount() {
  $("count").textContent =
    Array.from($<HTMLTextAreaElement>("input").value).length + " / 500";
}
$("input").addEventListener("input", updateCount);
$("input").addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter")
    $<HTMLFormElement>("form").requestSubmit();
});
$("annotation").addEventListener("change", renderAnalysis);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $("close").click();
});
$("copy").onclick = async () => {
  const endpoint = $("endpoint").textContent ?? "";
  const quote = (v: string) => "'" + v.replace(/'/g, "'\\''") + "'";
  const url = endpoint.replace(/^(POST|GET) /, "");
  const command = `curl ${quote(url.startsWith("/") ? location.origin + url : url)}${lastRequest ? ` -H 'Content-Type: application/json' --data ${quote(JSON.stringify(lastRequest))}` : ""}`;
  try {
    await navigator.clipboard.writeText(command);
    $("copy").textContent = t().copied;
  } catch {
    showError(new Error("Clipboard unavailable. Copy from the request panel."));
  }
};
translate();
$("status").textContent = t().status;
$("detail-content").textContent = t().select;
void status();
