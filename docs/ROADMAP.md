# Parity roadmap

The alpha is intentionally labelled: its algorithm is an independent first implementation, not the completed Ichiran migration described in the long-term brief.

1. Pin Ichiran and Himotoki revisions and data snapshots; run reference engines and save auditable JSON boundary/reading/conjugation fixtures. Review mismatch cases with Japanese-language expertise.
2. Port scoring length coefficients, entry-specific errata, kana/kanji preferences and POS/context scoring. Current length/priority heuristic is a replaceable baseline.
3. Port sticky positions, grammatical synergies and penalties, counters, suffix handling and recursive compound structures. Bounded compound components, counters and selected contextual rules now exist; exhaustive rule/score parity remains open.
4. Expand productive morphology, irregular classes, copula, contractions and causative/passive chains; resolve ambiguous analysis labels instead of combining potential/passive indefinitely.
5. Full dictionary import in PostgreSQL, EXPLAIN plans, size audit and memory/CPU/P95/concurrency benchmarks. Test compact/reverse-conjugation alternatives before multiplying pre-generated forms. FST/Trie is a measured option, not a required optimization.
6. Dictionary cleanup and rollback commands; schema upgrade/version compatibility; streaming cancellation and workload isolation if measurements require Workers.
7. Shareable word/kanji URLs, localized POS/morphology labels, nested compounds, optional readings statistics with accurate data provenance. Nested compounds and language tools now render in the Playground. Query results remain session-local; no automatic text persistence/sharing.
8. npm scope availability, package publication, hosted public demo, release signing and deployment smoke tests. Source publication does not publish npm packages or deploy a live website.

Status of the Ichiran port ([ICHIRAN-PORT.md](ICHIRAN-PORT.md)): items 1–4 are covered for the Ichiran engine by a function-level port with recorded live-oracle comparisons. Remaining work:

- Compare against a live Ichiran full-init of the current JMdict, so that builds from newer JMdict releases are checked directly rather than through the January 2026 snapshot.
- Reduce the PostgreSQL footprint (about 6.75 GB per dataset, mostly the per-row `dataset_id` key and generated conjugation rows).
- Measure latency and concurrency under load.
- Garbage-collect obsolete Ichiran datasets.
- Localize Ichiran's English conjugation and suffix descriptions.
- Show Ichiran-specific details (kanji statistics, reading alignment) in the Playground.

No full equivalence, model-quality score, production capacity or hosting status is implied by the initial alpha.

See [ICHIRAN-COVERAGE.md](ICHIRAN-COVERAGE.md) for the current implemented surfaces and measured development-corpus comparison. The roadmap records remaining gates; no milestone is an assertion of complete parity.
