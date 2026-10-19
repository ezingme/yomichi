# Yomichi · よみち

**Japanese, word by word.** An open-source TypeScript Japanese text analysis engine, PostgreSQL-backed HTTP API, lightweight SDK, CLI, and independent multilingual Playground.

> **0.1 alpha.** Yomichi includes a TypeScript port of the [Ichiran](https://github.com/tshatrov/ichiran) analyzer and of its JMdict database build ([details](docs/ICHIRAN-PORT.md)). Reading the Ichiran release database, the port matched live Ichiran on all 5,000 sentences of a deterministic Tatoeba sample: every path, score and gloss/conjugation JSON field. A model built from JMdict in TypeScript matched the top segmentation on 4,998 of those sentences with the built-in conjugation rules, and on all 5,000 with JMdictDB's rules. These are recorded comparisons on that corpus, not a guarantee for every input. The earlier engine is kept as `engine: "legacy"`; its [capability audit](docs/ICHIRAN-COVERAGE.md) is unchanged.

## What works

- Ichiran engine: Ichiran's scoring, segmentation, suffix grammar, counters, kana hints, errata and romanization, ported to TypeScript. It runs over an Ichiran-model dataset that `npm run import:ichiran` builds from JMdict (with optional KANJIDIC2), or that `npm run import:ichiran-db` copies from an Ichiran database. Alternatively, `ICHIRAN_DATABASE_URL` points it at an existing Ichiran PostgreSQL database read in place. Ichiran's own JSON is available under `/v1/ichiran/*`.
- Dictionary-driven segmentation with up to five ranked paths; reading/entry alternatives per token.
- Original UTF-16 offsets, whitespace preservation, forced boundaries and explicit unknown text.
- Modern productive verb/adjective/copula paradigms (23 POS labels), secondary conjugations, bounded auxiliary chains and contractions, with nested components.
- Character normalization/voicing/mora utilities; eight romanization modes, branching inverse romanization and partial romaji suggestions.
- Exact Japanese integer parsing/rendering and productive counter pronunciation, exceptional/native readings and ordinal suffixes.
- Streaming JMdict and KANJIDIC2 XML/gzip import into PostgreSQL; atomic dataset activation, source version and checksum.
- Rich JMdict/KANJIDIC2 metadata, kanji words/statistics and bounded reading alignment with explicit unmatched hypotheses.
- Immutable custom dictionary overlays and dataset activation/rollback.
- Validated Fastify API, OpenAPI UI, rate limits, bounded input, optional API keys and exact CORS origins.
- Separate responsive Playground with English, Chinese and Japanese interface; kana/romaji annotations, candidate switching, word details, JSON and cURL.
- SDK and CLI connect to your server; no dictionary database bundled with packages.

## Quick start

Requires **Node.js 22.9+** and PostgreSQL 16+ (Docker is convenient). A dictionary must be imported before sentence analysis works. No Python, Lisp or Rust service is required.

```sh
git clone https://github.com/ezingme/yomichi.git
cd yomichi
npm ci
cp .env.example .env
docker compose up -d db
npm run db:migrate
mkdir -p data
```

Obtain JMdict from [EDRDG](https://www.edrdg.org/jmdict/j_jmdict.html), review its data licence and save the XML/gzip file under `data/`. For English glosses the upstream file is `https://www.edrdg.org/pub/Nihongo/JMdict_e.gz`. The multilingual `JMdict.gz` can be imported instead; available gloss languages depend on the source, not the interface language.

```sh
# Ichiran engine (about 1.5 minutes and 4.3 GB of RAM to build; about 6.8 GB in PostgreSQL)
npm run import:ichiran -- data/JMdict_e.gz 2026-10-19 --kanjidic data/kanjidic2.xml.gz
# Word search, entry and kanji endpoints, and the legacy engine
npm run import:jmdict -- data/JMdict_e.gz 2026-10-19
# Optional: download KANJIDIC2 from EDRDG, then:
npm run import:kanji -- data/kanjidic2.xml.gz 2026-10-19
npm run dev
```

With an `ichiran` dataset active, `/v1/analyze` uses the Ichiran engine. Otherwise it uses the legacy engine over the `import:jmdict` dataset.

You can also use an existing Ichiran database (for example a restored [release dump](https://github.com/tshatrov/ichiran/releases)) without importing it:

```sh
ICHIRAN_DATABASE_URL=postgresql://user:pass@host/ichiran ICHIRAN_DATABASE_VERSION=ichiran-260118 npm run dev
```

In this mode the Ichiran engine reads that database in place, over read-only connections, and takes precedence over any imported `ichiran` dataset. `DATABASE_URL` is still required for the other endpoints. Ties between equal-score results follow the database's physical row order, as in Ichiran, so do not run `VACUUM FULL`, `CLUSTER` or updates on it. Switching databases is a configuration change, not an atomic activation; use `import:ichiran-db` when you need versioned snapshots and rollback.

In another terminal:

```sh
npm run playground
```

Open **http://localhost:5173**. API docs: **http://localhost:3000/docs**. The dev frontend proxies API requests to port 3000. `.env` is loaded by the root scripts; change the example database password before exposing any service.

## API

```sh
curl http://localhost:3000/v1/analyze \
  -H 'Content-Type: application/json' \
  --data '{"text":"猫は魚を食べました。","limit":3,"romanization":"hepburn"}'
```

| Endpoint                             | Description                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `POST /v1/analyze`                   | Dictionary analysis; `limit` 1–5, `romanization`, `includeGlosses`, `includeConjugation`, `segmentationHints`, `engine` (`auto`, `ichiran`, `legacy`) |
| `POST /v1/reading`                   | Reading extraction; `mode: "kana"` converts katakana only without dictionary analysis                         |
| `POST /v1/romanize`                  | Kana conversion or full analysis; `romanization: "hepburn"` or `"kunrei"`                                     |
| `GET /v1/words/search?q=食&limit=20` | Prefix search of dictionary spellings/readings, max 50                                                        |
| `GET /v1/words/:seq`                 | JMdict entry with original restrictions and gloss language tags                                               |
| `GET /v1/kanji/:char`                | KANJIDIC2 details, requires separate import                                                                   |
| `POST /v1/ichiran/segment`, `/romanize`, `/match-readings`; `GET /v1/ichiran/word`, `/kanji/:char` | Ichiran's `romanize*`, `romanize`, `match-readings-json`, `find-word-info-json` and `kanji-info-json` output |
| `GET /healthz`, `GET /readyz`        | Process liveness and dictionary readiness                                                                     |
| `GET /openapi.json`, `GET /docs`     | API schema and interactive documentation                                                                      |

Maximum sentence length: 500 Unicode code points. Offsets/hints are **UTF-16 code units** into the unmodified input: `input.slice(token.start, token.end)` reconstructs every token. Hints may include text start/end but cannot split a surrogate pair. Scores are heuristic ranks, **not probabilities**. Top-K refers to segmentation paths; lexical alternatives are attached to each word. Unknown readings are `null`, never guessed. `components` contains recursive grammatical components where a productive rule was used. Grammar-only components have no invented dictionary ID or gloss; fused counter readings may have `null` component readings. Search is bounded (three compound layers, finite candidate beam), so arbitrary-depth or exact global scoring parity is not promised. Conjugation labels are English in this alpha.

Additional tools: `POST /v1/deromanize`, `/v1/suggest`, `/v1/numbers`, `/v1/characters`, `/v1/kanji/align`; `GET /v1/kanji/:char/words`, `/stats`, `/readings?reading=...`. OpenAPI lists request schemas. Number values are decimal strings so large integers survive JSON. Suggestions come from the imported dictionary; conversion candidates are kana only. Corpus frequencies unavailable from source data remain `null`.

## Packages and CLI

The package names below describe this repository's workspaces. **They have not been published to npm**, and scope ownership has not been verified. Build locally before using package exports.

```sh
npm run build
npm run cli -- analyze '駅の前で会いましょう。'
npm run cli -- search '食べ'
```

```ts
import { YomichiClient } from "@yomichi/client";
const api = new YomichiClient("http://localhost:3000");
const result = await api.analyze({ text: "猫は魚を食べました。", limit: 3 });
```

| Workspace             | Role                                                  |
| --------------------- | ----------------------------------------------------- |
| `packages/core`       | Pure TS analysis and morphology; repository interface |
| `packages/dictionary` | PostgreSQL schema, repository and import tools        |
| `packages/server`     | Fastify API and standalone service entry              |
| `packages/client`     | Fetch-based client, no runtime dictionary dependency  |
| `packages/cli`        | HTTP CLI; `YOMICHI_API_URL`, `YOMICHI_API_KEY`        |
| `apps/playground`     | Standalone Vite static frontend                       |

## Deployment

`npm run build` emits each package under `packages/*/dist` and the static site under `apps/playground/dist`. Serve the frontend on a static host. Set `VITE_API_BASE_URL=https://your-api.example` **at frontend build time**, and add that frontend origin to backend `CORS_ORIGINS`. With a reverse proxy on the same origin, leave `VITE_API_BASE_URL` unset and route `/v1`, `/readyz`, `/docs`, `/openapi.json` to the API. SPA fallback to `index.html` is only needed if you add client-side routes.

`docker compose up --build api` runs the API after the database. Initialize schema/import from the host as above, or run the corresponding root script in the built image. Database data persists in the Compose volume; source dictionaries are a read-only mount. The image includes import tooling, so it is a functional baseline rather than a size-optimized runtime image.

Use a reverse proxy for TLS and deployment-level request limits. Bindings in Compose are localhost-only. `API_KEY` protects `/v1/*`; **never embed a private key in `VITE_*` or frontend JavaScript**. A public Playground needs a rate-limited public endpoint or a server-side proxy with its own quotas. Default IP rate limiting trusts the socket address, not arbitrary forwarding headers; configure your trusted edge deliberately. Input text is not logged by the application.

Imports require a dedicated connection and run in a transaction; a failed/empty import leaves the active version unchanged. Old versions are retained to keep in-flight requests consistent. Provision disk headroom for old/new dictionaries, indexes and WAL. Garbage collection of obsolete datasets is a manual operator task; do not delete a dataset while requests may still use it. Database migration is explicit, never an automatic dictionary build at API startup. No storage-size or RAM reduction is claimed yet.

### Dictionary maintenance

```sh
npm run db:manage -- list
npm run db:manage -- activate DATASET_ID
npm run db:manage -- overlay BASE_ID corrections.json VERSION 'my reviewed corrections'
```

Overlay JSON is an array of `{ "op": "add" | "replace", "entry": Entry }` or `{ "op": "delete", "id": "..." }`. It creates a new snapshot with a parent/recipe digest and regenerated forms. Preserve source attribution for added entries. Use IDs matching `[A-Za-z0-9_-]{1,128}` for HTTP retrieval. An activated snapshot is not edited in place.

### Upstream comparison

```sh
npm run parity:jmdict  # data/JMdict_e.gz; streams the full source, retains only corpus lookup forms
npm run parity -- --database  # evaluates an actually imported PostgreSQL snapshot
```

The full-source evaluator writes `data/parity-full.jsonl` and reports checksums, scan counts and segmentation metrics. `--reuse-index` verifies source/morphology/corpus fingerprints before reuse. Published upstream expectations are distinct from a live Ichiran oracle; no original Lisp runtime was executed here. Full PostgreSQL ingestion, operational performance and dictionary-size claims require separate measurements.

## Validation and limitations

```sh
npm run typecheck
npm test
npm run build
npm run bench  # requires your loaded PostgreSQL database
node --env-file-if-exists=.env --import tsx scripts/compare.ts path/to/corpus.json
```

Tests exercise the actual parser, importer, SQL repository, core and HTTP handlers. The Ichiran engine tests use verbatim JMdict and KANJIDIC2 subsets (`tests/fixtures/*-ichiran-subset.xml`) and check results recorded with the complete dictionary. Portable SQL integration uses PGlite (PostgreSQL WASM), not a mock database. PostgreSQL deployment/load testing remains distinct. Benchmark output identifies dictionary version, Node version, CPU time, RSS and sequential latency. It excludes database CPU/RSS and is not a throughput claim.

Comparison corpus format: `[{"text":"猫は魚。","tokens":["猫","は","魚","。"],"source":"human-reviewed"}]`. Supply independently captured Ichiran/Himotoki/human references. The comparison reports boundaries; it cannot establish reading/gloss accuracy or decide which side of a mismatch is correct. No upstream engine was run as part of the initial build.

See [Ichiran port and recorded comparisons](docs/ICHIRAN-PORT.md), [verification notes](docs/VERIFICATION.md), [parity roadmap](docs/ROADMAP.md) and [source/data notices](NOTICE.md).

## Licence

Yomichi code: MIT. Dictionary data: separate EDRDG terms; **not** covered by the code licence. Upstream projects and data providers are credited in [NOTICE.md](NOTICE.md).

### Optional browser verification

```sh
npx playwright install chromium
node --import tsx scripts/browser-smoke.ts
# Or use real data already downloaded locally:
node --import tsx scripts/validate-real-dictionary.ts
YOMICHI_SMOKE_XML=data/real-sample.xml node --import tsx scripts/browser-smoke.ts
```

The browser test starts its own API and frontend on ports 3000/5173; stop existing dev servers first. Screenshots are local/CI artifacts, not a hosted public demo. Default browser fixtures are labelled synthetic and never loaded by the production server.
