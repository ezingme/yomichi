# Morphology provenance and scope

`paradigms.ts` is an independently expressed finite Japanese stem generator. It
contains no copied CSV rows, dictionary glosses, or production Python/Lisp code.
The implementation is distributed under Yomichi's code licence.

Design/coverage references examined:

- Ichiran, Timofei Shatrov, commit
  `002a695b3c86a9524e49354f04b7a915beb71270`, `dict-load.lisp`,
  `dict-errata.lisp`, `dict-grammar.lisp` (MIT). These establish the modern POS
  coverage, bounded secondary conjugation model, weak stem distinction, and
  exceptional lexicalization exclusions.
- Himotoki Contributors, commit
  `eb4faf962fc0e5baf0bab22179ece1fc67fd1647`,
  `himotoki/loading/conjugations.py` (MIT).
- Himotoki's `data/README.md` attributes `kwpos.csv`, `conj.csv`, `conjo.csv` to
  [JMdictDB](https://gitlab.com/yamagoya/jmdictdb/-/tree/master/jmdictdb/data).
  Those CSVs were inspected for coverage only. Their directory does not include
  a separate source licence grant; the surrounding project's MIT licence is
  not assumed to relicense third-party data. No tables are redistributed here.
  Any future table import must first establish and retain the upstream data
  licence and notices independently of Yomichi's code licence.

The exported `MORPHOLOGY_POS` lists 23 labels (22 distinct classes, since `cop`
and historical `cop-da` are aliases). All modern upstream POS classes are
represented, with `vz` added. `vs` nouns and `adj-na` stems are deliberately not
blindly inflected; copula forms require the actual `だ` reading. Classical
nidan/yodan verbs, dictionary-entry errata outside the two lexicalization
exclusions, dialectal variants, and full grammar compound composition are not
implemented by this module. Productive auxiliary patterns are deliberately
finite rather than arbitrarily recursive.

The generator distinguishes potential/passive analyses, surface/reading
allomorphs, negative/polite, past/te, ba/tara/tari, volitional/imperative,
continuative and weak stems; potential/passive/causative/causative-passive forms
receive one inflectional pass. This is structural coverage, not a claim of
row-for-row JMdictDB or Ichiran parity. No reference-engine differential run has
been performed by this module's regression tests. The tests are synthetic
morphology examples, not a production dictionary or accuracy benchmark.
