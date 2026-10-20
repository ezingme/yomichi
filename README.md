# Yomichi · よみち

**Japanese, word by word.** An open-source TypeScript Japanese text analysis engine, PostgreSQL-backed HTTP API, lightweight SDK, CLI, and independent multilingual Playground.

> **0.1 alpha.** Yomichi includes a TypeScript port of the [Ichiran](https://github.com/tshatrov/ichiran) analyzer and of its JMdict database build ([details](docs/ICHIRAN-PORT.md)). Reading the Ichiran release database, the port matched live Ichiran on all 5,000 sentences of a deterministic Tatoeba sample: every path, score and gloss/conjugation JSON field. A model built from JMdict in TypeScript matched the top segmentation on 4,998 of those sentences with the built-in conjugation rules, and on all 5,000 with JMdictDB's rules. These are recorded comparisons on that corpus, not a guarantee for every input. The earlier engine is kept as `engine: "legacy"`; its [capability audit](docs/ICHIRAN-COVERAGE.md) is unchanged.

## What works

- Ichiran engine: Ichiran's scoring, segmentation, suffix grammar, counters, kana hints, errata and romanization, ported to TypeScript. It reads an Ichiran PostgreSQL database directly (`ICHIRAN_DATABASE_URL`), or a dataset that `npm run import:ichiran-db` copies from one or that `npm run import:ichiran` builds from JMdict (with optional KANJIDIC2). Ichiran's own JSON is available under `/v1/ichiran/*`.
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

Requires **Node.js 22.9+** and **PostgreSQL 16+** (Docker is convenient). No Python, Lisp or Rust service is required. The recommended setup connects Yomichi to an Ichiran PostgreSQL database, so no dictionary build is needed.

### 1. Install and start PostgreSQL

```sh
git clone https://github.com/ezingme/yomichi.git
cd yomichi
npm ci
cp .env.example .env
docker compose up -d db
npm run db:migrate
```

### 2. Connect an Ichiran database (recommended)

Download Ichiran's release database. The dump is about 200 MB and about 3.7 GB once restored. Restore it as a second database on the same server:

```sh
mkdir -p data
curl -L -o data/ichiran-260118.pgdump \
  https://github.com/tshatrov/ichiran/releases/download/ichiran-260118/ichiran-260118.pgdump
sha256sum data/ichiran-260118.pgdump
# 98a44e2cc88a65677da8b1f7124e7d6c904253eb1aae0ef16d2c7cc1dacdba82
docker compose exec -T db createdb -U yomichi ichiran
docker compose exec -T db psql -U yomichi -d ichiran -c 'DROP SCHEMA public'
docker compose exec -T db pg_restore -U yomichi --no-owner --no-acl -d ichiran < data/ichiran-260118.pgdump
```

Dropping the empty `public` schema first avoids a conflict with the schema in the dump. `--no-owner --no-acl` skips the `ichiran` role, which does not exist here. Then set in `.env`:

```sh
ICHIRAN_DATABASE_URL=postgresql://yomichi:yomichi-local@localhost:5432/ichiran
ICHIRAN_DATABASE_VERSION=ichiran-260118
```

If you already run Ichiran, point `ICHIRAN_DATABASE_URL` at its database instead.

How Yomichi uses this database:

- It is read in place over read-only connections.
- `DATABASE_URL` is still needed: it holds Yomichi's own schema and the optional datasets below.
- Equal-score results are ordered by the database's physical row order, as in Ichiran. Do not run `VACUUM FULL`, `CLUSTER` or updates on it.
- The release database is the one used for the [recorded comparison](docs/ICHIRAN-PORT.md) with live Ichiran.
- Its dictionary content comes from EDRDG's JMdict and KANJIDIC and remains under [EDRDG terms](https://www.edrdg.org/edrdg/licence.html).

### 3. Start

```sh
npm run dev
# in another terminal
npm run playground
curl http://localhost:3000/readyz
```

Open **http://localhost:5173**. API docs are at **http://localhost:3000/docs**. The dev frontend proxies API requests to port 3000. The root scripts load `.env`. Change the example database password before exposing any service.

### Troubleshooting

On startup, `npm run dev` prints what each database provides. `/readyz` reports each source separately under `errors`, and the Playground shows the reason next to "Dictionary unavailable". Common causes:

| Message                                        | Fix                                                                                                                  |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `SCHEMA_MISSING`: Yomichi's tables are missing | Run `npm run db:migrate` against `DATABASE_URL`.                                                                     |
| `ICHIRAN_SCHEMA_MISSING`                       | `ICHIRAN_DATABASE_URL` names a database without Ichiran's tables. Point it at the restored `ichiran` database.       |
| `DATABASE_UNAVAILABLE`                         | PostgreSQL is not reachable at the host and port in the URL (server down, firewall, or cloud security group).        |
| `DATABASE_AUTH`                                | Wrong user or password, or `pg_hba.conf` rules. Cloud databases often need `?sslmode=require` at the end of the URL. |

With `ICHIRAN_DATABASE_URL` set, analysis works even if `DATABASE_URL` has no imported dataset. Word search and the legacy engine still need `npm run import:jmdict`.

### Other ways to provide data

All of these use the PostgreSQL database configured by `DATABASE_URL`. Imports run in a transaction and activate atomically; old versions remain available for rollback.

| Goal                                                                                | Command                                                                                                               |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Copy an Ichiran database into Yomichi, with versioning and rollback (about 6.75 GB) | `npm run import:ichiran-db -- postgres://…/ichiran ichiran-260118`                                                    |
| Build the Ichiran model from a newer JMdict (about 1.5 minutes and 4.3 GB of RAM)   | `npm run import:ichiran -- data/JMdict_e.gz 2026-10-19 --kanjidic data/kanjidic2.xml.gz`                              |
| Word search, `/v1/words/*` and `/v1/kanji/*` endpoints, legacy engine               | `npm run import:jmdict -- data/JMdict_e.gz 2026-10-19` and `npm run import:kanji -- data/kanjidic2.xml.gz 2026-10-19` |

Obtain JMdict and KANJIDIC2 from [EDRDG](https://www.edrdg.org/jmdict/j_jmdict.html) and review their data licence. For English glosses, use `https://www.edrdg.org/pub/Nihongo/JMdict_e.gz`. The multilingual `JMdict.gz` also works; which gloss languages you get depends on the source file, not on the interface language.

Engine selection:

1. `ICHIRAN_DATABASE_URL`, if set.
2. Otherwise the active imported `ichiran` dataset.
3. Otherwise the legacy engine over the `import:jmdict` dataset.

`"engine": "legacy"` in a request forces the legacy engine.

## Demo

With the Ichiran engine, the Playground shows what [ichi.moe](https://ichi.moe/) shows:

- the text runs, each with a menu of its best segmentations and their scores;
- the romanized sentence;
- one card per word: readings, senses with notes and fields, conjugations (including "via" chains), compounds, suffixes, counters, and omitted entries.

The content is Ichiran's own data. A comparison with live ichi.moe pages was identical for 166 of 167 sentences ([details](docs/ICHIRAN-PORT.md#comparison-with-ichimoe)).

| ichi.moe example                                           | Alternatives, counter, via chain              | Mobile                                          |
| ---------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------- |
| ![べんきょう しています](docs/demo/playground-ichimoe.png) | ![Word cards](docs/demo/playground-cards.png) | ![Mobile card](docs/demo/playground-mobile.png) |

`npm run demo:api` runs 20 live API cases against your server, and `npm run demo:screenshots` captures the Playground. See [docs/demo/API-CASES.md](docs/demo/API-CASES.md) for how to run them and the recorded report.

## API

```sh
curl http://localhost:3000/v1/analyze \
  -H 'Content-Type: application/json' \
  --data '{"text":"猫は魚を食べました。","limit":3,"romanization":"hepburn"}'
```

| Endpoint                                                                                           | Description                                                                                                                                           |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/analyze`                                                                                 | Dictionary analysis; `limit` 1–5, `romanization`, `includeGlosses`, `includeConjugation`, `segmentationHints`, `engine` (`auto`, `ichiran`, `legacy`) |
| `POST /v1/reading`                                                                                 | Reading extraction; `mode: "kana"` converts katakana only without dictionary analysis                                                                 |
| `POST /v1/romanize`                                                                                | Kana conversion or full analysis; `romanization: "hepburn"` or `"kunrei"`                                                                             |
| `GET /v1/words/search?q=食&limit=20`                                                               | Prefix search of dictionary spellings/readings, max 50                                                                                                |
| `GET /v1/words/:seq`                                                                               | JMdict entry with original restrictions and gloss language tags                                                                                       |
| `GET /v1/kanji/:char`                                                                              | KANJIDIC2 details, requires separate import                                                                                                           |
| `POST /v1/ichiran/analyze`                                                                         | Everything ichi.moe displays: runs, up to 5 paths with scores, and per word its romanization, omitted-entry count and gloss JSON                      |
| `POST /v1/ichiran/segment`, `/romanize`, `/match-readings`; `GET /v1/ichiran/word`, `/kanji/:char` | Ichiran's `romanize*`, `romanize`, `match-readings-json`, `find-word-info-json` and `kanji-info-json` output                                          |
| `GET /healthz`, `GET /readyz`                                                                      | Process liveness and dictionary readiness                                                                                                             |
| `GET /openapi.json`, `GET /docs`                                                                   | API schema and interactive documentation                                                                                                              |

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

`docker compose up --build api` runs the API after the database. Inside Compose the database host is `db`, so set `ICHIRAN_DATABASE_URL=postgresql://yomichi:…@db:5432/ichiran` for the `api` service. Initialize schema/import from the host as above, or run the corresponding root script in the built image. Database data persists in the Compose volume; source dictionaries are a read-only mount. The image includes import tooling, so it is a functional baseline rather than a size-optimized runtime image.

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

The full-source evaluator writes `data/parity-full.jsonl` and reports checksums, scan counts and segmentation metrics. `--reuse-index` verifies source/morphology/corpus fingerprints before reuse. These scripts evaluate the legacy engine against published upstream expectations. Comparisons of the Ichiran engine against live Ichiran output, with their setup and reproduction commands, are in [ICHIRAN-PORT.md](docs/ICHIRAN-PORT.md).

## Validation and limitations

```sh
npm run typecheck
npm test
npm run build
npm run bench  # requires your loaded PostgreSQL database
node --env-file-if-exists=.env --import tsx scripts/compare.ts path/to/corpus.json
```

Tests exercise the actual parser, importer, SQL repository, core and HTTP handlers. The Ichiran engine tests use verbatim JMdict and KANJIDIC2 subsets (`tests/fixtures/*-ichiran-subset.xml`) and check results recorded with the complete dictionary. Portable SQL integration uses PGlite (PostgreSQL WASM), not a mock database. PostgreSQL deployment/load testing remains distinct. Benchmark output identifies dictionary version, Node version, CPU time, RSS and sequential latency. It excludes database CPU/RSS and is not a throughput claim.

Comparison corpus format: `[{"text":"猫は魚。","tokens":["猫","は","魚","。"],"source":"human-reviewed"}]`. Supply independently captured Ichiran/Himotoki/human references. The comparison reports boundaries; it cannot establish reading/gloss accuracy or decide which side of a mismatch is correct.

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
