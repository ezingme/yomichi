/** Compares Yomichi's built-in conjugation rules with a local JMdictDB
 * conjo.csv (not distributed): node --import tsx scripts/ichiran-build/compare-rules.ts DIR */
import { applyIchiranRuleErrata, builtinRuleTable, loadJmdictdbRules } from "../../packages/dictionary/src/ichiran-build/conj-rules.js";
const dir = process.argv[2];
const a = applyIchiranRuleErrata(builtinRuleTable());
const b = applyIchiranRuleErrata(await loadJmdictdbRules(dir));
const key = (r: any) => `${r.conj}${r.neg ? "N" : "-"}${r.fml ? "F" : "-"}/${r.onum}`;
const val = (r: any) => `${r.stem}|${r.okuri}|${r.euphr}|${r.euphk}`;
let diffs = 0;
for (const pos of new Set([...a.keys(), ...b.keys()])) {
  const ma = new Map((a.get(pos) ?? []).map((r) => [key(r), val(r)]));
  const mb = new Map((b.get(pos) ?? []).map((r) => [key(r), val(r)]));
  for (const k of new Set([...ma.keys(), ...mb.keys()]))
    if (ma.get(k) !== mb.get(k)) {
      diffs++;
      console.log(pos, k, "builtin=", ma.get(k), "jmdictdb=", mb.get(k));
    }
}
console.log("differences:", diffs);
