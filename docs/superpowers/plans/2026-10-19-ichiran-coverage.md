# Ichiran coverage implementation plan

Goal: expand Yomichi from alpha toward all upstream user-facing capabilities and establish evidence-backed parity tracking.
Spec: ../specs/2026-10-19-ichiran-coverage.md
Execution: independent subsystem work in parallel, integration and verification by primary agent. User authorized continuing implementation.

- [ ] Audit upstream exports/tests and extract attributed machine-readable reference expectations (not claimed as a live oracle run).
- [ ] Characters/romanization/inverse conversion/numbers/counters: port tables and operations into isolated modules; regression tests before code.
- [ ] Morphology: replace ad hoc lists with rule coverage, respect irregulars/euphony and structured derivation metadata; regression tests.
- [ ] Dictionary/kanji: preserve rich metadata, custom overlays and reading-match/statistics APIs with provenance; SQL/fixture tests.
- [ ] Analysis: consume richer morphology, construct actual nested compounds, numbers/counters, sticky positions, contextual scores and output projection.
- [ ] API/client/CLI/Playground: expose new operations consistently, bounded validation, display nested components and ambiguity.
- [ ] Full dictionary/reference tests, independent review and GitHub CI; publish measured coverage and exact gaps.

Shared contracts: DictionaryRepository continues metadata/lookup/entries/search/kanji; Lexeme retains original fields and accepts optional richer derivation metadata; original text offsets remain UTF-16. Avoid bulk pre-generation of every recursive compound; construct productive combinations at analysis time.
