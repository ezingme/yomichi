# Sources and attribution

Yomichi is a TypeScript analyzer. It is not endorsed by the authors of the projects below.

`packages/core/src/ichiran` and `packages/dictionary/src/ichiran-build` are a TypeScript port of Ichiran's analyzer, data loading and errata, including its generated errata and easy-hint tables. They follow Ichiran's source function by function. Ichiran's MIT notice is retained in `licenses/ichiran-MIT.txt`. `packages/dictionary/data/ichiran` holds unchanged copies of Ichiran's `extra.xml`, `jichitai.csv` and `gyoseiku.csv`; their provenance is in the README in that directory. Ichiran reads conjugation rules from JMdictDB's `conjo.csv` (GPLv2), which is **not** included. The built-in rule table is expressed independently. Users who choose `--jmdictdb DIR` load their own local copy. The rest of Yomichi (the legacy engine and the tools) is independently expressed, with attributed adaptations noted below.

- Ichiran by Timofei Shatrov: https://github.com/tshatrov/ichiran — MIT. Examined commit `002a695b3c86a9524e49354f04b7a915beb71270` (segmentation, dictionary and morphology design).
- Himotoki: https://github.com/moikdev/himotoki-py — MIT. Examined commit `eb4faf962fc0e5baf0bab22179ece1fc67fd1647` (`segment.py`, `scoring/calc_score.py`, schema). Its complete scoring tables, synergies and counter algorithms are NOT yet ported.
- ichiran-ram: https://github.com/GolyBidoof/ichiran-ram — performance architecture reference, not incorporated runtime code or a reproduced benchmark.
- ichi.moe: https://ichi.moe/ — functional/interaction reference only. No website source or design assets copied.
- WanaKana: kana conversion dependency. Its package license remains applicable.

JMdict and KANJIDIC2 belong to the Electronic Dictionary Research and Development Group (EDRDG). They are NOT relicensed under this repository's MIT license. Read the current source attribution and distribution conditions at https://www.edrdg.org/edrdg/licence.html and retain required notices when distributing data, derived dictionaries, or services. Source descriptions: https://www.edrdg.org/jmdict/j_jmdict.html and https://www.edrdg.org/kanjidic/kanjd2index_legacy.html . The importer records source, dataset version and SHA-256 of the uncompressed input; users supply downloaded source files. No complete dictionary is committed or bundled in npm packages.

`tests/fixtures` contains small purpose-written synthetic dictionaries (not production data), verbatim JMdict and KANJIDIC2 subsets used by the Ichiran engine tests (`*-ichiran-subset.xml`, EDRDG, CC BY-SA 4.0; extracted with `scripts/ichiran-build/extract-*fixture.ts`), plus published upstream MIT-licensed test expectations with explicit source provenance. Character, number, counter and romanization routines adapt Ichiran algorithms/tables; the complete upstream MIT notice is retained in `licenses/ichiran-MIT.txt` and each distributed package notice. Productive morphology is independently expressed; no JMdictDB CSV tables are redistributed. The optional real-data verification workflow uses locally downloaded EDRDG data in ignored `data/`; the production API never falls back to fixtures.

Oracle comparisons used a Tatoeba sample (https://tatoeba.org, CC BY 2.0 FR). The sentences are not committed; `scripts/oracle/sample-tatoeba.ts` reproduces the sample from the public export.
