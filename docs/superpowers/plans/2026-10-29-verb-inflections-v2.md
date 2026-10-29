# Verb Inflections V2 implementation plan

Implement the user's approved three-stage plan on top of main 4ec8a9c.
Preserve the pure TypeScript runtime, dictionary provenance and legacy
`forms[].form/positive/negative` fields. Do not infer POS from spelling.

1. Accuracy: reproduce irregular/invalid POS bugs, then correct the finite
   generator. Add a dictionary resolver respecting entry, sense, reading,
   re_restr/re_nokanji, stagk/stagr and inherited POS. Return explicit ambiguity
   instead of guessing by row count. Tests must include homographs and invalid
   selectors through the real HTTP route.
2. Learning: add structured details (stable IDs, readings, all supported
   variants, register/usage notes and availability), and a separate extensions
   collection for tara, desire, conjecture and progressive expressions. Keep
   lexical exclusions narrow and documented; productive forms do not establish
   semantic naturalness. Add independent literal regression cases for at least
   100 verbs and explicit irregular/exception expectations.
3. Integration: typed SDK, responsive Playground language tool with expandable
   details, ambiguity selection, copy and visible failures. Document API and
   the separate mini-program boundary. Verify typecheck, full tests and build;
   exercise the renderer in a browser if a browser runtime is available.

Files: morphology/paradigms.ts (rules), verb-inflections.ts (learning output),
verb-inflection-lookup.ts (dictionary selection), server/app.ts (HTTP), client
index.ts (SDK), playground verb-inflections-view.ts/main.ts/style.css (UI),
tests/verb-inflections* (regressions), docs/VERB-INFLECTIONS.md (contract).

References: Tokyo University of Foreign Studies grammar module 074; Japan
Foundation BTS00063 and BMA00076; NINJAL basic verb handbook 分かる.
Literal test expectations are independently written examples, not a corpus
accuracy benchmark or a claim of perfect linguistic coverage.

## Execution record

- Accuracy, learning output and repository client integration implemented.
- Baseline: 78 tests passed. Final: 229 tests passed, including literal
  references for 114 distinct verbs and secondary paradigms across classes.
- `npm run typecheck`, `npm run build`, and `git diff --check` passed.
- Synthetic Playwright smoke passed at 390px and 1280px: variants, copy,
  ambiguity resolution, no page overflow, and delayed-candidate response after
  switching to Ichiran analysis. Screenshots visually inspected with a CJK font.
- Independent code review found spelling-only lexical exclusion and stale
  candidate debug updates. Both reproduced with failing checks and fixed;
  also corrected unsupported rows incorrectly labelled productive.
- Policy decisions: preserve the original primary-row labels for compatibility;
  use precise labels in details; return 409 rather than silently choose a
  homograph; mark semantic uncertainty instead of claiming full validation.
- Boundary: no live-dictionary/Jisho differential benchmark or native-speaker
  certification; the external WeChat mini-program and production deployment
  are not included in this repository change.
