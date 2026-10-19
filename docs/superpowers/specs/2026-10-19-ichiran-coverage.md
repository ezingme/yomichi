# Ichiran capability coverage

User directive: continue implementation towards all capabilities in tshatrov/ichiran, preserving pure TypeScript production execution, PostgreSQL default, lightweight SDK and independent Playground. This expands the original alpha design; not permission to claim unmeasured equivalence.

Audit the pinned upstream package exports, source modules and tests. Implement modular equivalents of character operations, kana/romanization and inverse romanization, numeric/counter parsing and reading, table-based conjugation, grammar compounds and contextual path scoring, dictionary metadata/lookup and maintenance, kanji lookup/readings and corpus statistics. REST and CLI expose meaningful public operations, with validation, original UTF-16 offsets and consistent response types. No arbitrary code execution endpoint; upstream CLI eval is a Lisp development interface, not an HTTP feature.

Every ported table/algorithm retains attribution. Upstream expected test cases must be distinguished from freshly executed upstream output and human-reviewed gold. Known mismatches remain visible in machine-readable results, never hidden by hardcoding example sentences or weakening expected outputs. Optional corpus-dependent statistics report their provenance and absence, not fabricated percentages. Dictionary changes require compatibility/version checks and reimport guidance.

Acceptance: baseline and new tests, strict typecheck, package/UI builds, SQL integration and upstream capability inventory. Run full-dictionary ingest and corpus comparison where feasible. Each capability is labelled implemented / partial / missing / unverified with evidence. End-to-end and visual CI gates apply. Cannot declare complete coverage until every capability row is verified.
