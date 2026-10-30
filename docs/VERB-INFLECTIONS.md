# Verb inflections V2

`POST /v1/verbs/inflections` uses the active **Ichiran dictionary source**,
including an imported Ichiran dataset. It does not infer a conjugation class
from spelling and does not use test data as a production fallback.

```json
{ "word": "食べる", "reading": "たべる", "entryId": "1358280", "senseId": "123", "pos": "v1" }
```

Only `word` is required. The IDs above illustrate the field format; obtain real
IDs from this deployment's dictionary or its ambiguity response. `entryId` is
the dictionary seq, and `senseId` is that source's sense row ID; do not assume
sense IDs remain stable across dictionary imports. `reading` accepts hiragana
or katakana. `pos` must be a supported code present in the selected sense's
`sense_prop.text` (tag `pos`); omitted POS inherits the preceding explicit POS
in sense order, following JMdict convention.

Selection respects root entries, spelling/reading restrictions (`re_restr`,
`re_nokanji`), and sense spelling/reading restrictions (`stagk`, `stagr`). A
request with multiple distinct entry/reading/POS candidates normally returns **409**:

```json
{
  "error": { "code": "AMBIGUOUS_VERB", "message": "Select an entry, reading, sense or POS from candidates." },
  "candidates": [
    { "entryId": "1", "senseIds": ["5"], "reading": "いる", "pos": "v1", "spellings": ["居る"], "glosses": [] },
    { "entryId": "2", "senseIds": ["6"], "reading": "いる", "pos": "v5r", "spellings": ["要る"], "glosses": [] }
  ]
}
```

These are illustrative IDs, not bundled dictionary records. Send the chosen
entryId/reading/pos and, optionally, one senseId back to resolve it. Senses with
the same entry, reading and class share a paradigm and are listed in `senseIds`.
No class is selected by the number of generated rows.

Compatibility default: `{ "word": "する" }` (also with `reading: "する"` or
`"スル"`) returns the irregular `vs-i` paradigm when exactly one such
candidate exists in the dictionary. The godan homophones 刷る/剃る/擦る do not
block this ordinary query. An explicit `entryId`, `senseId` or `pos` disables
this default, so those homophones remain selectable. No dictionary entry IDs
are hard-coded, no absent entry is fabricated, and multiple `vs-i` candidates
still require disambiguation. Other homographs, such as いる, retain 409.

Other responses: 404 `NOT_FOUND` for absent root entries or a sense outside the
selected entries; 400 `INVALID_READING` for an incompatible reading; 422
`NOT_A_VERB` for no supported, applicable verb class; 400 validation errors for
malformed input. Existing dictionary-unavailable errors remain unchanged.

## Successful response

- `schemaVersion: "2.0"`, `word`, normalized `reading`, selected `pos`,
  `posCandidates`, `entryId`, `senseIds`, `spellings`.
- `forms`: the original `{form, positive, negative}` primary-surface rows. The
  original Chinese labels are preserved for existing clients. Unavailable rows
  are omitted: clients must not assume exactly 12 rows or fixed row indexes.
- `details`: 12 core rows with stable `id`, precise `label`, `availability`,
  `note` and arrays `positive`/`negative`. Each variant has `surface`, `reading`,
  `register` (`standard`, `formal`, `contracted`) and an optional usage note.
- `extensions`: tara, desire, conjecture, progressive/result state and its
  polite form, using the same detail structure. These are expressions, not
  additional simple verb endings.
- `notesLanguage: "zh"`: notes/labels are presently Chinese. UI headings can
  be localized by the stable IDs. Teaching examples are expressly identified
  with their own `word`; they do not purport to illustrate every queried verb.

Availability is `productive` (a regular morphological output),
`context-dependent` (especially voice, volition, imperatives and aspect), or
`not-applicable` (empty variant arrays with a reason). A productive form is
**not a guarantee of naturalness in every sense or sentence**. Standard
potential/passive forms are distinguished despite sometimes identical surfaces.
The negative te variants `ないで` and `なくて` have separate explanations; they
are not free substitutes. `まい` is marked formal. Full and contracted godan
causative-passive forms, including both negatives, are retained except for the
inapplicable contraction of verbs ending in `す`.

The spelling/reading generator rejects a godan POS whose ending does not match.
It corrects ある's negative and excludes its regular potential, preserves
来る's changing readings, the 行く/問う classes, くれる's imperative and honorific
ます stems. 為る also receives the lexical できる potential. Learner exclusions
for potential forms include ある, 要る, 分かる, 見える, 聞こえる and できる
(and explicitly listed spelling variants). The lookup passes the selected
lexical spellings so a kana query does not bypass these exclusions. These are
narrow teaching policies, not an exhaustive semantic validator. Existential
ある's passive/causative/progressive expressions are withheld; あろう is explained
as conjecture. Classical classes, regional dialects, unrestricted compound
composition and all colloquial variants (such as ra-dropping) are out of scope.

## TypeScript

```ts
import { YomichiClient, YomichiClientError } from "@yomichi/client";
const client = new YomichiClient("https://your-api.example");
try {
  const result = await client.verbInflections({ word: "いる" });
  console.log(result.details);
} catch (error) {
  if (error instanceof YomichiClientError && error.code === "AMBIGUOUS_VERB") {
    console.log(error.candidates); // show a choice, then retry
  }
}
```

The pure `generateVerbInflections(word, reading, posTexts, {pos?})` also remains
exported from core. It returns null for ambiguous, unsupported or inconsistent
classes. Callers should normally use the HTTP API or `verbInflectionCandidates`
when dictionary disambiguation is required.

## Integration and validation

The Playground language tools include verb inflections, an optional reading,
ambiguity choices, expandable variants/notes and per-form copy. At phone widths
polarities stack and Japanese forms stay intact. Neither API secrets nor a
fixture dictionary are embedded in the browser.

The WeChat mini-program shown in the user's screenshots is **not in this
repository**. Its consumer should adopt `details`/`extensions`, show 409
candidates, handle omitted/unavailable rows, and use reading/entry/sense/POS
selectors. Changing this repo does not deploy or update that external client.

`tests/fixtures/verb-inflections/modern.tsv` contains independently written
literal references for over 100 distinct verbs covering modern POS classes and
exceptions. It checks negative, past, te, polite and potential surfaces; focused
tests additionally verify full 12-row 食べる, irregular readings, exclusions,
variant arrays and real HTTP/SDK selection behavior. This is regression coverage,
not a live Jisho differential benchmark, a native-speaker review or a percentage
accuracy claim. `scripts/demo/verb-inflections-smoke.ts` checks the responsive
renderer and ambiguity flow with explicitly labelled synthetic HTTP responses.

References consulted for teaching policy (2026-10-29):

- Tokyo University of Foreign Studies, potential forms:
  https://www.coelang.tufs.ac.jp/mt/ja/gmod/contents/card/074.html
- Japan Foundation, potential and excluded verbs:
  https://www.kyozai.jpf.go.jp/kyozai/material/BTS00063/ja/render.do
- Japan Foundation, full/contracted causative passive:
  https://www.kyozai.jpf.go.jp/kyozai/material/BMA00076/ja/render.do
- NINJAL basic verb handbook, 分かる:
  https://www2.ninjal.ac.jp/verbhandbook/headwords/分かる.html

Implementation and test examples are independently expressed. Reference web
content and dictionary material retain their own terms; see NOTICE.md.

Recorded validation for this change: **229 tests passed**, including literal
reference rows for **114 distinct verbs**, typecheck and production build.
Browser smoke passed at 390px and 1280px, including delayed candidate responses
following a switch to sentence analysis. This uses synthetic HTTP responses to
exercise rendering; live dictionary imports and deployment remain separate.
