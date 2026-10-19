import { SaxesParser } from "saxes";
import { StringDecoder } from "node:string_decoder";
import type { Entry, Kanji, Sense } from "../../core/src/types.js";
interface Node {
  name: string;
  text: string;
  attrs: Record<string, string>;
  children: Node[];
}
const children = (n: Node, name: string) =>
  n.children.filter((c) => c.name === name);
const texts = (n: Node, name: string) =>
  children(n, name).map((c) => c.text.trim());
const first = (n: Node, name: string) => texts(n, name)[0] ?? "";
function word(n: Node): Entry {
  let lastPos: string[] = [];
  const senses: Sense[] = children(n, "sense").map((s) => {
    const pos = texts(s, "pos");
    if (pos.length) lastPos = pos;
    return {
      pos: [...lastPos],
      glosses: children(s, "gloss").map((g) => ({
        language: g.attrs["xml:lang"] ?? "eng",
        text: g.text.trim(),
      })),
      restrictions: texts(s, "stagk"),
      readingRestrictions: texts(s, "stagr"),
    };
  });
  const id = first(n, "ent_seq");
  const readings = children(n, "r_ele").map((r) => ({
    text: first(r, "reb"),
    restrictions: texts(r, "re_restr"),
    noKanji: children(r, "re_nokanji").length > 0,
  }));
  if (!/^\d+$/.test(id) || !readings.length || readings.some((r) => !r.text))
    throw new Error("Invalid JMdict entry");
  return {
    id,
    spellings: children(n, "k_ele").map((k) => first(k, "keb")),
    readings,
    senses,
    priority: n.children.some((e) =>
      e.children.some((p) => ["ke_pri", "re_pri"].includes(p.name)),
    )
      ? 2
      : 0,
  };
}
function kanji(n: Node): Kanji {
  const misc = children(n, "misc")[0];
  const groups = children(n, "reading_meaning").flatMap((r) =>
    children(r, "rmgroup"),
  );
  const character = first(n, "literal");
  if (Array.from(character).length !== 1)
    throw new Error("Invalid KANJIDIC2 character");
  return {
    character,
    strokeCounts: misc ? texts(misc, "stroke_count").map(Number) : [],
    grade: misc && first(misc, "grade") ? Number(first(misc, "grade")) : null,
    frequency: misc && first(misc, "freq") ? Number(first(misc, "freq")) : null,
    readings: groups.flatMap((g) =>
      children(g, "reading").map((r) => ({
        type: r.attrs.r_type ?? "",
        text: r.text,
      })),
    ),
    meanings: groups.flatMap((g) =>
      children(g, "meaning").map((m) => ({
        language: m.attrs.m_lang ?? "en",
        text: m.text,
      })),
    ),
  };
}
/** Streaming, per-entry tree; never resolves external entities or expands DTD values. */
export async function* parseEntries(
  source: AsyncIterable<Buffer | string>,
  kind: "jmdict" | "kanji",
): AsyncGenerator<Entry | Kanji> {
  const parser = new SaxesParser({ xmlns: false }),
    stack: Node[] = [],
    queue: (Entry | Kanji)[] = [];
  const target = kind === "jmdict" ? "entry" : "character";
  const decoder = new StringDecoder("utf8");
  let failure: Error | undefined;
  let rootSeen = false;
  parser.on("doctype", (d) => {
    for (const m of d.matchAll(/<!ENTITY\s+([\w-]+)\s+(["'])([\s\S]*?)\2\s*>/g))
      parser.ENTITIES[m[1]] = m[1];
  });
  parser.on("error", (e) => {
    failure = e;
  });
  parser.on("opentag", (tag) => {
    if (!rootSeen) {
      rootSeen = true;
      if (tag.name !== (kind === "jmdict" ? "JMdict" : "kanjidic2"))
        throw new Error("Unexpected dictionary XML root");
    }
    if (tag.name === target || stack.length) {
      if (stack.length > 32) throw new Error("XML nesting limit");
      const node: Node = {
        name: tag.name,
        text: "",
        attrs: tag.attributes as Record<string, string>,
        children: [],
      };
      stack.at(-1)?.children.push(node);
      stack.push(node);
    }
  });
  parser.on("text", (t) => {
    if (stack.length) {
      const n = stack.at(-1)!;
      n.text += t;
      if (n.text.length > 1_000_000) throw new Error("XML field too large");
    }
  });
  parser.on("cdata", (t) => {
    if (stack.length) stack.at(-1)!.text += t;
  });
  parser.on("closetag", () => {
    if (stack.length) {
      const n = stack.pop()!;
      if (n.name === target) queue.push(kind === "jmdict" ? word(n) : kanji(n));
    }
  });
  for await (const chunk of source) {
    parser.write(typeof chunk === "string" ? chunk : decoder.write(chunk));
    if (failure) throw failure;
    while (queue.length) yield queue.shift()!;
  }
  parser.write(decoder.end()).close();
  if (failure) throw failure;
  while (queue.length) yield queue.shift()!;
}
