/** Renders an Ichiran result the way ichi.moe presents it: the text runs,
 * the romanized sentence for the chosen segmentation of each run, and one
 * card per word with its readings, senses, conjugations and compounds. The
 * content comes from Ichiran's own gloss JSON through the shared view model. */
import {
  cardView,
  entryView,
  spacesBefore,
  type CardView,
  type ConjView,
  type EntryView,
  type SenseView,
} from "../../../packages/core/src/ichiran/view.js";
import type { IchiranResult } from "../../../packages/core/src/ichiran/index.js";

export interface IchiranLabels {
  compound: string;
  via: string;
  negative: string;
  formal: string;
  omitted: string;
  segmentation: string;
  score: string;
  allEntries: string;
}
type WordPart = Extract<IchiranResult["parts"][number], { type: "word" }>;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = "") => {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text) n.textContent = text;
  return n;
};

function senseList(senses: SenseView[]): HTMLOListElement {
  const ol = el("ol", "im-senses");
  for (const s of senses) {
    const li = el("li");
    li.append(el("span", "im-pos", s.pos));
    // ichi.moe shows the note as a tooltip; Ichiran's text output uses 《》
    if (s.note) li.append(" ", el("span", "im-note", `《${s.note}》`));
    if (s.field) li.append(" ", el("span", "im-field", s.field));
    li.append(" ", el("span", "im-gloss", s.gloss));
    ol.append(li);
  }
  return ol;
}

function conjugation(c: ConjView, l: IchiranLabels): HTMLElement {
  const box = el("div", "im-conj");
  for (const p of c.props) {
    const line = el("div", "im-conj-prop");
    line.append(el("span", "im-pos", `[${p.pos}]`), " ", el("span", "im-conj-type", p.type));
    if (p.negative) line.append(" ", el("span", "im-conj-flag", l.negative));
    if (p.formal) line.append(" ", el("span", "im-conj-flag", l.formal));
    box.append(line);
  }
  if (c.via) {
    // as on ichi.moe: one "via" block listing each intermediate conjugation
    const via = el("div", "im-conj-via");
    via.append(el("span", "im-via", l.via));
    for (const v of c.via) via.append(conjugation(v, l));
    box.append(via);
  } else {
    const dl = el("dl", "im-conj-root");
    dl.append(el("dt", "im-reading", c.reading ?? ""));
    const dd = el("dd");
    if (c.senses?.length) dd.append(senseList(c.senses));
    dl.append(dd);
    box.append(dl);
  }
  return box;
}

function entryBody(e: EntryView, l: IchiranLabels): HTMLElement {
  const dd = el("dd");
  if (e.counter) dd.append(el("p", "im-counter", e.counter));
  if (e.compound) {
    const desc = el("p", "im-compound", `${l.compound}: `);
    desc.append(el("span", "im-compound-words", e.compound.words.join(" + ")));
    dd.append(desc);
    const parts = el("dl", "im-compound-parts");
    for (const p of e.compound.parts) parts.append(el("dt", "im-reading", p.reading), entryBody(p, l));
    dd.append(parts);
  }
  if (e.suffix) dd.append(el("p", "im-suffix", `[${e.suffix}]`));
  if (e.senses.length) dd.append(senseList(e.senses));
  for (const c of e.conjugations) dd.append(conjugation(c, l));
  return dd;
}

function entries(list: EntryView[], l: IchiranLabels): HTMLDListElement {
  const dl = el("dl", "im-entries");
  list.forEach((e, i) => {
    dl.append(el("dt", "im-reading", list.length > 1 ? `${i + 1}. ${e.reading}` : e.reading), entryBody(e, l));
  });
  return dl;
}

function card(
  view: CardView,
  text: string,
  id: string,
  l: IchiranLabels,
  lookup: (text: string) => Promise<unknown[]>,
): HTMLElement {
  const art = el("article", "im-card");
  art.id = id;
  art.append(el("h4", "im-card-title", view.romanization));
  art.append(entries(view.entries, l));
  if (view.skipped > 0) {
    // like ichi.moe's link to the word page: every entry for this text
    const more = el("button", "im-omitted", `${l.omitted}: ${view.skipped}`);
    more.type = "button";
    more.title = l.allEntries;
    more.onclick = async () => {
      more.disabled = true;
      try {
        const all = await lookup(text);
        const box = el("div", "im-all");
        box.append(el("p", "im-all-title", l.allEntries), entries(all.map((g) => entryView(g as any)), l));
        more.replaceWith(box);
      } catch {
        more.disabled = false;
      }
    };
    art.append(more);
  }
  return art;
}

/** Renders `result` into `root`; `picks[i]` is the chosen path of part i. */
export function renderIchiran(
  root: HTMLElement,
  result: IchiranResult,
  picks: number[],
  l: IchiranLabels,
  lookup: (text: string) => Promise<unknown[]>,
  onPick: (part: number, path: number) => void,
): void {
  root.replaceChildren();
  const sentence = el("div", "im-sentence");
  sentence.lang = "ja";
  const romaji = el("p", "im-romaji");
  const cards = el("div", "im-cards");
  // the romanized sentence: chosen words and other runs, joined as Ichiran does
  const pieces: { text: string; href?: string }[] = [];
  result.parts.forEach((part, i) => {
    if (part.type === "misc") {
      sentence.append(el("span", "im-misc", part.display));
      pieces.push({ text: part.text });
      return;
    }
    const w = part as WordPart;
    const chosen = w.paths[picks[i] ?? 0] ?? w.paths[0];
    // the run, with a menu of its segmentations (ichi.moe's query picker)
    const wrap = el("span", "im-part");
    const button = el("button", "im-part-text", w.display);
    button.type = "button";
    button.setAttribute("aria-haspopup", "true");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", `${w.text} · ${l.segmentation}`);
    const menu = el("ul", "im-picks");
    menu.hidden = true;
    w.paths.forEach((p, k) => {
      const li = el("li");
      const opt = el("button", k === (picks[i] ?? 0) ? "im-pick active" : "im-pick");
      opt.type = "button";
      opt.append(el("span", "", p.romanization), el("span", "im-score", `${l.score} ${p.score}`));
      opt.onclick = () => onPick(i, k);
      li.append(opt);
      menu.append(li);
    });
    button.onclick = () => {
      const open = menu.hidden;
      root.querySelectorAll<HTMLElement>(".im-picks").forEach((m) => (m.hidden = true));
      root.querySelectorAll(".im-part-text").forEach((b) => b.setAttribute("aria-expanded", "false"));
      menu.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
    };
    menu.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        menu.hidden = true;
        button.focus();
      }
    });
    wrap.append(button, menu);
    sentence.append(wrap);
    (chosen?.words ?? []).forEach((word, k) => {
      const id = `im-card-${i}-${k}`;
      pieces.push({ text: word.romanization, href: `#${id}` });
      cards.append(card(cardView(word.romanization, word.gloss, word.skipped), word.text, id, l, lookup));
    });
  });
  const spaces = spacesBefore(pieces.map((p) => p.text));
  pieces.forEach((p, k) => {
    if (spaces[k]) romaji.append(" ");
    if (!p.href) romaji.append(p.text);
    else {
      const link = el("a", "im-word", p.text);
      link.href = p.href;
      romaji.append(link);
    }
  });
  root.append(sentence, romaji, cards);
}
