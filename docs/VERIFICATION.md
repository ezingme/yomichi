# Initial alpha verification

Local environment: Node 24.19.0. Initial work: 2026-10-19.

- TypeScript strict typecheck: passed.
- Unit/integration tests: 19 passed (core, import, SQL repository, HTTP validation/auth/CORS/readiness, live SDK/CLI requests).
- Package builds: core, dictionary, client, server and CLI passed; Playground production build passed.
- Real JMdict XML/gzip: downloaded EDRDG `JMdict_e.gz`, parsed all **218,930** entries. Selected **63 real entries** for local verification; no downloaded dictionaries committed.
- SQL integration: actual PostgreSQL WASM engine (PGlite); import success/rollback, reading and sense restrictions, active version switching and immutable repository snapshot tested.
- Fresh independent code review found exceptional godan handling and mutable dataset snapshot defects. Both reproduced in regression tests and corrected.
- Local browser test: **blocked**, Chromium downloaded but the execution environment denied its Unix socket operation (`EPERM`). No local screenshot or successful visual QA is claimed. Remote [GitHub CI run 39235569174](https://github.com/ezingme/yomichi/actions/runs/39235569174) passed all three jobs: Node 22, Node 24 and browser. Browser checks cover analysis/detail, Chinese UI, mobile drawer and overflow, word search and the missing-kanji error, with a clearly labelled synthetic test dictionary. Desktop/mobile screenshots were downloaded and inspected.

Not yet performed: full dictionary PostgreSQL ingestion/load benchmarks, reference Lisp/Python engine runs, language-expert corpus review, production container deployment, public-site deployment or npm publication. The 63-entry subset cannot establish full-dictionary speed, memory use or accuracy. Full requirements remain in ROADMAP.md.

Real-data sentence checks also exposed missing polite-volitional forms and entry-wide priority leaking into an uncommon spelling. Regression tests now cover 会いましょう / 食べましょう and spelling/reading-specific priority. Priority ranking remains a heuristic, not contextual disambiguation.

## Ichiran port verification (2026-10-19)

- A live Ichiran oracle was built: SBCL 2.2.9, Ichiran `002a695`, release database `ichiran-260118` and JMdictDB `c9c8232`. The upstream test suite passed 782 of 782 assertions. Comparisons and the reproduction commands are in [ICHIRAN-PORT.md](ICHIRAN-PORT.md).
- 5,000 Tatoeba sentences: the port over the oracle's database gave identical paths, scores, `romanize*` JSON and `romanize` info. A TypeScript build from the same JMdict matched the top segmentation on 4,998 sentences with built-in rules and on all 5,000 with JMdictDB rules.
- A complete JMdict 2026-10-19 build was imported into PostgreSQL 16 (6.75 GB) and served through the API. Results were identical to the in-memory build.
- `npm run typecheck`, `npm test` (66 tests, including PGlite import and API tests on verbatim dictionary subsets) and `npm run build` passed.
