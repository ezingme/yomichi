# Yomichi contributor guidance

- Preserve the pure TypeScript production runtime and PostgreSQL default.
- Read README.md, NOTICE.md and docs/ROADMAP.md before extending the analyzer.
- Never replace the actual dictionary repository with production fixture data or fabricate readings/meanings.
- All text offsets are UTF-16 positions in original input. Unknown text is preserved.
- Scoring is not probability. Do not claim Ichiran/Himotoki parity without a recorded comparison.
- Maintain source attribution and keep dictionary terms separate from the code licence.
- Run npm run typecheck, npm test and npm run build. Add focused regression tests for new morphology and parser behavior.
- Keep database activation atomic and repository snapshots immutable.
- The Playground must remain separately deployable, accessible on mobile, and free of private API secrets.
