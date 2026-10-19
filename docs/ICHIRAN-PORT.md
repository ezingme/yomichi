# Ichiran engine (TypeScript port)

`packages/core/src/ichiran` is a function-by-function TypeScript port of the
analyzer of [Ichiran](https://github.com/tshatrov/ichiran) (Timofei Shatrov,
MIT) at commit `002a695b3c86a9524e49354f04b7a915beb71270`.
`packages/dictionary/src/ichiran-build` rebuilds Ichiran's database model from
JMdict in TypeScript, so no Lisp runtime is needed. The production runtime is
pure TypeScript on PostgreSQL.

What this document claims is limited to the comparisons recorded below. They
were run against live Ichiran output and are reproducible with the commands
given here. They do not certify identical behaviour on every possible input.

## What is ported

| Ichiran source                    | Port                                                                                                                                                                                                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `characters.lisp`, `numbers.lisp` | `chars.ts`, `numbers.ts`: normalization with an offset map, character classes, basic split (including its alternation quirk), kanji regexes, mora length, rendaku, gemination, destem, sticky positions, BigInt number parsing and rendering                                  |
| `dict.lisp`, `dict-split.lisp`    | `dict.ts`, `split.ts`, `easy-hints.ts`: `calc-score`, kanji-break penalties, substring lookup, `join-substring-words`, culling, `find-best-path` (top array, gap penalty), word info, splits, segsplits and kana hints (simple and easy hints)                                  |
| `dict-grammar.lisp`               | `grammar.ts`: suffix cache and every suffix function, abbreviations, synergies, penalties and segfilters                                                                                                                                                                       |
| `dict-counters.lisp`              | `counters.ts`: counter classes, special counters, readings and the counter cache                                                                                                                                                                                              |
| `dict-errata.lisp`                | `errata.ts` (runtime lists) and `ichiran-build/errata.ts` plus `errata-data.ts` (all 604 load-time operations, quirks included)                                                                                                                                                |
| `dict-load.lisp`, `conn.lisp`     | `ichiran-build/lexicon.ts`, `conj-rules.ts`: entry loading, conjugation generation (`construct-conjugation`, `insert-conjugation`, secondary conjugations), best readings. Rows are fetched on demand through `IchiranSource` (PostgreSQL or memory) into a shared query store |
| `dict-custom.lisp`                | `ichiran-build/custom.ts`: `extra.xml`, municipalities and wards (vendored in `packages/dictionary/data/ichiran`)                                                                                                                                                              |
| `kanji.lisp`                      | `kanji.ts`, `ichiran-build/kanji.ts`: KANJIDIC loading, reading matching (`match-readings`), per-reading statistics, `kanji-info-json`, `match-readings-json`                                                                                                                  |
| `romanize.lisp`                   | `romanize.ts`: every method (Hepburn basic, simple, passport, traditional, modified; Kunrei-shiki) and `romanize`, `romanize*`, `romanize-word-geo`                                                                                                                             |
| JSON output (`dict.lisp`)         | `output.ts`: `word-info-gloss-json`, `conj-info-json`, `word-info-str`, sense and reading strings                                                                                                                                                                              |

Some Lisp behaviour has to be reproduced exactly for the output to match:

- `:null` counts as true.
- `remove-duplicates` keeps the last occurrence.
- `get-senses-raw` does not reverse its last group.
- Results that depend on the mutable suffix cache are reset at the start of each analysis.
- Ties are broken by physical row order. Imported Ichiran databases record their heap order; builds use row ids.

## Recorded comparisons

Oracle setup:

- SBCL 2.2.9 running Ichiran at the commit above.
- The release database `ichiran-260118.pgdump`, SHA-256 `98a44e2cc88a65677da8b1f7124e7d6c904253eb1aae0ef16d2c7cc1dacdba82`, restored into PostgreSQL 16.15.
- JMdictDB at commit `c9c82328d0ba5b15c496c4a32116da105be29e4c`.

The upstream test suite passed on this setup: 782 of 782 assertions.

The corpus is the 5,000 Tatoeba Japanese sentences whose SHA-256 of the id sorts first. `scripts/oracle/sample-tatoeba.ts` reproduces the sample from the 2026-10-19 export, `jpn_sentences.tsv.bz2` (SHA-256 `9b2f0c18f58a5633a0dfba22b6a5f7a2bbbd55f649aeafcc31107d1be5cc5c2b`, 248,939 sentences). For each sentence `scripts/oracle/ichiran-batch.lisp` captured:

- the normalized chunks;
- the five best `dict-segment` paths as word-info JSON;
- the full `romanize*` JSON;
- `romanize :with-info`.

| Data                                                                                                                           | Result                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Port reading the oracle's own database                                                                                         | 5,000 / 5,000 sentences identical in every path, score and word-info field, in the full `romanize*` JSON and in `romanize` info text. Published upstream segmentation cases: 741 / 741                              |
| Model built in TypeScript from the same JMdict revision (entry XML recovered from the oracle database), built-in rules          | 741 / 741 published cases. Root and custom rows identical. 99.8% of conjugation rows identical. With the oracle's generation order replayed: 2,343,276 / 2,343,282 (the 6 remaining rows are historical `exp` rows) |
| Same build, top segmentation on the 5,000 sentences (generated seqs normalized)                                                 | 4,998 / 5,000 with built-in rules; 5,000 / 5,000 with JMdictDB's `conjo.csv`. The remaining differences are equal-score alternatives whose order depends on PostgreSQL heap order                                    |
| Build from JMdict 2026-10-19 (current)                                                                                         | 729 / 741 published cases, identical between the memory and PostgreSQL paths. All 12 differences come from entries added to JMdict since the oracle's snapshot (e.g. どなた様, かと, といい, おい, きそう)            |

The latest run over the oracle database is recorded in [`ichiran-oracle-2026-10-19.json`](validation/ichiran-oracle-2026-10-19.json): 5,000 / 5,000 identical in top text, all paths, scores, full JSON and info.

Reproduce:

```sh
# capture (needs a working Ichiran installation and its database)
npx tsx scripts/oracle/sample-tatoeba.ts jpn_sentences.tsv 5000 > sample.jsonl
# add "full":true to each line to also capture romanize* and romanize info
npx tsx scripts/oracle/capture.ts sample.jsonl oracle.jsonl --core ichiran.core
# compare: the port over the oracle database, a TypeScript build, or a Yomichi dataset
ICHIRAN_DATABASE_URL=postgres://.../ichiran npx tsx scripts/ichiran-oracle-compare.ts oracle.jsonl
npx tsx scripts/ichiran-oracle-compare.ts oracle.jsonl --build JMdict.xml --ichiran-data packages/dictionary/data/ichiran --normalize-generated
DATABASE_URL=postgres://.../yomichi npx tsx scripts/ichiran-oracle-compare.ts oracle.jsonl --yomichi --normalize-generated
ICHIRAN_DATABASE_URL=... npx tsx scripts/ichiran-port-parity.ts  # published upstream cases
ICHIRAN_DATABASE_URL=... npx tsx scripts/ichiran-build/compare-tables.ts JMdict.xml --ichiran-data packages/dictionary/data/ichiran [--replay-order]
```

### Conjugation rules

Ichiran reads conjugation rules from JMdictDB's `conjo.csv`, which is GPLv2, so Yomichi does not distribute it. `conj-rules.ts` expresses the same paradigms independently. `npm run import:ichiran -- ... --jmdictdb DIR` loads a local JMdictDB checkout instead. `scripts/ichiran-build/compare-rules.ts` lists the 21 rules where the built-in table differs:

- Negative formal volitional of godan verbs (14 rules): built-in ～ますまい, JMdictDB ～ませんまい.
- v5t formal conditional: ～ましたら versus ～まったら.
- 来る formal provisional and negative provisional: く versus き/こ euphony.
- Formal provisional of suru verbs: ～ますならば versus ～ますなれば.

These choices change only the forms listed.

## Storage and resources

`npm run import:ichiran -- JMdict_e.gz VERSION [--kanjidic kanjidic2.xml.gz] [--jmdictdb DIR]`:

- Builds the model in memory. For the complete JMdict 2026-10-19 this took 90–94 s with a peak RSS of 4.3 GB; the script reserves a 6 GB heap.
- Writes `yomichi_ij_*` tables in one transaction and activates the dataset as kind `ichiran`.
- The resulting PostgreSQL database was 6.75 GB.
- About 2.56 million entries, including generated conjugation entries.

`npm run import:ichiran-db -- postgres://.../ichiran VERSION` copies an existing Ichiran database instead, for example a restored release dump, keeping its heap order.

Alternatively, set `ICHIRAN_DATABASE_URL` (and optionally `ICHIRAN_DATABASE_VERSION`) to read an Ichiran database in place.
- No import step. The release database is 3.7 GB, against 6.75 GB for an imported copy.
- Connections use `default_transaction_read_only`.
- Results tie-break on the database's physical (ctid) order. This is the setup the 5,000-sentence comparison used.
- The database must stay unmodified while in use. Statements that rewrite the heap, such as `VACUUM FULL` or `CLUSTER`, change tie order.
- There is no atomic activation or rollback in this mode.
- With warm caches, latency is comparable to an imported dataset: 40–450 ms for a new sentence, about 10 ms for a repeated one. The first queries after a database restart wait on disk reads (tens of seconds).

Analysis needs no preloading. Each request fetches only the rows it touches into a query store shared per immutable dataset. The store is trimmed once it holds more than 300,000 texts or 200,000 entries.

## API

When an `ichiran` dataset is active:

- `POST /v1/analyze` (and `/v1/reading`, `/v1/romanize` with `mode: "analyze"`) uses this engine. `"engine": "legacy"` selects the earlier engine, which needs a separate `import:jmdict`.
- Tokens keep original UTF-16 offsets.
- Unknown text and separators are preserved.
- `entryId` is the root JMdict seq.
- `conjugationSteps` lists Ichiran's conjugation types from the root outwards. Suffix compounds have `components` carrying Ichiran's suffix descriptions.
- `romanization` maps `hepburn` to Ichiran's default (traditional Hepburn) and `kunrei` to Kunrei-shiki.
- `segmentationHints` split Japanese runs before segmentation.
- Candidates combine the best paths of each run. Paths that differ only in hidden scoring details are merged.

Endpoints that return Ichiran's own JSON:

| Endpoint                                      | Ichiran function                       |
| --------------------------------------------- | -------------------------------------- |
| `POST /v1/ichiran/segment` `{text, method?, limit?}` | `romanize*` (full JSON)         |
| `POST /v1/ichiran/romanize` `{text, method?, info?}` | `romanize` with `:with-info`    |
| `GET /v1/ichiran/word?text=&reading=&root=`   | `find-word-info-json`                  |
| `GET /v1/ichiran/kanji/:char`                 | `kanji-info-json`                      |
| `POST /v1/ichiran/match-readings` `{word, reading}` | `match-readings-json`            |

Scores are Ichiran's heuristic path scores, not probabilities.

## Not ported

- The CLI's Lisp `eval`.
- `dict-fix.lisp`, a set of manual maintenance helpers.
- Ichiran's web front-end.
- Deromanization: Yomichi keeps its own implementation.
