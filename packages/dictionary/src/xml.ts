import { SaxesParser } from "saxes";
import { StringDecoder } from "node:string_decoder";
import type { Entry, Kanji, Sense } from "../../core/src/types.js";
/** Lossless metadata retained in stored JSON. Tag values are JMdict entity codes.
 * Design reference: Ichiran dict-load.lisp / kanji.lisp (Timofei Shatrov, MIT);
 * independent implementation; EDRDG dictionary licensing remains separate.
 */
export interface RichSense extends Sense {
  fields: string[];
  misc: string[];
  dialects: string[];
  info: string[];
  crossReferences: string[];
  antonyms: string[];
  loanwordSources: {
    language: string;
    text: string;
    type: string;
    wasei: boolean;
  }[];
  glosses: (Sense["glosses"][number] & { type?: string; gender?: string })[];
}
export interface RichEntry extends Entry {
  spellingInfo: Record<string, string[]>;
  spellingPriorityTags: Record<string, string[]>;
  readings: (Entry["readings"][number] & {
    info: string[];
    priorityTags: string[];
  })[];
  senses: RichSense[];
}
export interface RichKanji extends Kanji {
  nanori: string[];
  jlpt: number | null;
  radicalNames: string[];
  radicals: { type: string; value: number }[];
  codepoints: { type: string; value: string }[];
  variants: { type: string; value: string }[];
  dictionaryReferences: {
    type: string;
    value: string;
    volume?: string;
    page?: string;
  }[];
  queryCodes: { type: string; value: string; misclassification?: string }[];
  readings: (Kanji["readings"][number] & {
    status?: string;
    onType?: string;
  })[];
}
export interface Node {
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
function word(n: Node): RichEntry {
  let lastPos: string[] = [];
  const senses: RichSense[] = children(n, "sense").map((s) => {
    const pos = texts(s, "pos");
    if (pos.length) lastPos = pos;
    return {
      pos: [...lastPos],
      fields: texts(s, "field"),
      misc: texts(s, "misc"),
      dialects: texts(s, "dial"),
      info: texts(s, "s_inf"),
      crossReferences: texts(s, "xref"),
      antonyms: texts(s, "ant"),
      loanwordSources: children(s, "lsource").map((l) => ({
        language: l.attrs["xml:lang"] ?? "eng",
        text: l.text.trim(),
        type: l.attrs.ls_type ?? "full",
        wasei: l.attrs.ls_wasei === "y",
      })),
      glosses: children(s, "gloss").map((g) => ({
        language: g.attrs["xml:lang"] ?? "eng",
        text: g.text.trim(),
        ...(g.attrs.g_type ? { type: g.attrs.g_type } : {}),
        ...(g.attrs.g_gend ? { gender: g.attrs.g_gend } : {}),
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
    info: texts(r, "re_inf"),
    priorityTags: texts(r, "re_pri"),
    priority: children(r, "re_pri").length ? 2 : 0,
  }));
  if (!/^\d+$/.test(id) || !readings.length || readings.some((r) => !r.text))
    throw new Error("Invalid JMdict entry");
  return {
    id,
    spellings: children(n, "k_ele").map((k) => first(k, "keb")),
    spellingInfo: Object.fromEntries(
      children(n, "k_ele").map((k) => [first(k, "keb"), texts(k, "ke_inf")]),
    ),
    spellingPriorityTags: Object.fromEntries(
      children(n, "k_ele").map((k) => [first(k, "keb"), texts(k, "ke_pri")]),
    ),
    spellingPriorities: Object.fromEntries(
      children(n, "k_ele").map((k) => [
        first(k, "keb"),
        children(k, "ke_pri").length ? 2 : 0,
      ]),
    ),
    readings,
    senses,
    priority: n.children.some((e) =>
      e.children.some((p) => ["ke_pri", "re_pri"].includes(p.name)),
    )
      ? 2
      : 0,
  };
}
function kanji(n: Node): RichKanji {
  const misc = children(n, "misc")[0];
  const groups = children(n, "reading_meaning").flatMap((r) =>
    children(r, "rmgroup"),
  );
  const character = first(n, "literal");
  if (Array.from(character).length !== 1)
    throw new Error("Invalid KANJIDIC2 character");
  return {
    character,
    nanori: children(n, "reading_meaning").flatMap((r) => texts(r, "nanori")),
    jlpt: misc && first(misc, "jlpt") ? Number(first(misc, "jlpt")) : null,
    radicalNames: misc ? texts(misc, "rad_name") : [],
    radicals: children(n, "radical")
      .flatMap((r) => children(r, "rad_value"))
      .map((r) => ({ type: r.attrs.rad_type ?? "", value: Number(r.text) })),
    codepoints: children(n, "codepoint")
      .flatMap((r) => children(r, "cp_value"))
      .map((r) => ({ type: r.attrs.cp_type ?? "", value: r.text.trim() })),
    variants: (misc ? children(misc, "variant") : []).map((r) => ({
      type: r.attrs.var_type ?? "",
      value: r.text.trim(),
    })),
    dictionaryReferences: children(n, "dic_number")
      .flatMap((r) => children(r, "dic_ref"))
      .map((r) => ({
        type: r.attrs.dr_type ?? "",
        value: r.text.trim(),
        ...(r.attrs.m_vol ? { volume: r.attrs.m_vol } : {}),
        ...(r.attrs.m_page ? { page: r.attrs.m_page } : {}),
      })),
    queryCodes: children(n, "query_code")
      .flatMap((r) => children(r, "q_code"))
      .map((r) => ({
        type: r.attrs.qc_type ?? "",
        value: r.text.trim(),
        ...(r.attrs.skip_misclass
          ? { misclassification: r.attrs.skip_misclass }
          : {}),
      })),
    strokeCounts: misc ? texts(misc, "stroke_count").map(Number) : [],
    grade: misc && first(misc, "grade") ? Number(first(misc, "grade")) : null,
    frequency: misc && first(misc, "freq") ? Number(first(misc, "freq")) : null,
    readings: groups.flatMap((g) =>
      children(g, "reading").map((r) => ({
        type: r.attrs.r_type ?? "",
        text: r.text.trim(),
        ...(r.attrs.r_status ? { status: r.attrs.r_status } : {}),
        ...(r.attrs.on_type ? { onType: r.attrs.on_type } : {}),
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
  for await (const n of parseNodes(source, kind))
    yield kind === "jmdict" ? word(n) : kanji(n);
}
/** Raw element trees of each <entry> (JMdict) or <character> (KANJIDIC2).
 * Entity references are replaced by their names, as Ichiran's loader does. */
export async function* parseNodes(
  source: AsyncIterable<Buffer | string>,
  kind: "jmdict" | "kanji",
): AsyncGenerator<Node> {
  const parser = new SaxesParser({ xmlns: false }),
    stack: Node[] = [],
    queue: Node[] = [];
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
      if (n.name === target) queue.push(n);
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
