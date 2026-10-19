/** Builds an Ichiran-equivalent lexicon from JMdict, following Ichiran's
 * full-init: load-jmdict (entries, conjugations, secondary conjugations,
 * custom data, errata, statistics) and load-best-readings. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Lexicon } from "./lexicon.js";
import { Errata } from "./errata.js";
import { CustomLoader, type CustomSources } from "./custom.js";
import { applyIchiranRuleErrata, builtinRuleTable, loadJmdictdbRules, type RuleTable } from "./conj-rules.js";
import { parseNodes, type Node } from "../xml.js";

export interface BuildOptions {
  /** Conjugation rules before Ichiran's adjustments; built-in when omitted. */
  rules?: RuleTable;
  custom?: CustomSources;
  /** Processing order of load-conjugations (diagnostics: replay an upstream build). */
  conjugationOrder?: Map<number, number>;
  /** Skip upstream errata (for diagnostics only). */
  skipErrata?: boolean;
  onProgress?: (phase: string, detail?: unknown) => void;
}

export async function buildLexicon(entries: AsyncIterable<Node>, opts: BuildOptions = {}): Promise<Lexicon> {
  const rules = applyIchiranRuleErrata(opts.rules ?? builtinRuleTable());
  const lex = new Lexicon();
  let n = 0;
  for await (const node of entries) {
    lex.loadEntry(node);
    if (++n % 50000 === 0) opts.onProgress?.("entries", n);
  }
  opts.onProgress?.("entries", n);
  lex.recalcEntryStatsAll();
  lex.loadConjugations(rules, opts.conjugationOrder);
  opts.onProgress?.("conjugations", lex.conjSeq.length);
  lex.loadSecondaryConjugations(rules);
  opts.onProgress?.("secondary", lex.conjSeq.length);
  let errata: Errata;
  const custom = opts.custom ? new CustomLoader(lex, rules, opts.custom, () => errata) : null;
  errata = new Errata(lex, rules, (keys) => custom?.load(keys));
  custom?.load();
  opts.onProgress?.("custom", lex.entries.size);
  if (!opts.skipErrata) errata.applyAll();
  opts.onProgress?.("errata");
  lex.recalcEntryStatsAll();
  lex.loadBestReadings();
  opts.onProgress?.("done", { entries: lex.entries.size, kanji: lex.kanji.size, kana: lex.kana.size, conj: lex.conjSeq.length });
  return lex;
}

/** Reads Ichiran's data/sources directory (extra.xml, jichitai.csv, gyoseiku.csv). */
export async function readCustomSources(dir: string): Promise<CustomSources> {
  const extraXml = await readFile(join(dir, "extra.xml"), "utf8");
  // extra.xml uses an <outer> root; wrap for the streaming JMdict parser.
  const wrapped = extraXml.replace(/<outer>/, "<JMdict>").replace(/<\/outer>/, "</JMdict>");
  const extra: Node[] = [];
  for await (const node of parseNodes((async function* () { yield wrapped; })(), "jmdict")) extra.push(node);
  const csv = async (f: string) =>
    (await readFile(join(dir, f), "utf8"))
      .split(/\r?\n/)
      .filter((l) => l.length)
      .map((l) => l.split(","));
  return { extra, municipalities: await csv("jichitai.csv"), wards: await csv("gyoseiku.csv") };
}

export { loadJmdictdbRules, builtinRuleTable };
