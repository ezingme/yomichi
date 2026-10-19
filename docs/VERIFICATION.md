# Initial alpha verification

Local environment: Node 24.19.0. Initial work: 2026-10-19.

- TypeScript strict typecheck: passed.
- Unit/integration tests: 17 passed (core, import, SQL repository, HTTP validation/auth/CORS/readiness, live SDK/CLI requests).
- Package builds: core, dictionary, client, server and CLI passed; Playground production build passed.
- Real JMdict XML/gzip: downloaded EDRDG `JMdict_e.gz`, parsed all **218,930** entries. Selected **63 real entries** for local verification; no downloaded dictionaries committed.
- SQL integration: actual PostgreSQL WASM engine (PGlite); import success/rollback, reading and sense restrictions, active version switching and immutable repository snapshot tested.
- Fresh independent code review found exceptional godan handling and mutable dataset snapshot defects. Both reproduced in regression tests and corrected.
- Local browser test: **blocked**, Chromium downloaded but the execution environment denied its Unix socket operation (`EPERM`). No local screenshot or successful visual QA is claimed. CI includes the same browser test on a standard Linux runner, with a clearly labelled synthetic test dictionary and screenshot artifacts; consult that run for its outcome.

Not yet performed: full dictionary PostgreSQL ingestion/load benchmarks, reference Lisp/Python engine runs, language-expert corpus review, production container deployment, public-site deployment or npm publication. The 63-entry subset cannot establish full-dictionary speed, memory use or accuracy. Full requirements remain in ROADMAP.md.
