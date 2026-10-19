# Demo: Playground and API cases

Run the Playground and the live API cases against the Ichiran engine. This uses the Quick start setup in the README (an Ichiran database through `ICHIRAN_DATABASE_URL`). The API must listen on port 3000; the Playground dev server proxies to it.

```sh
npm run dev                                   # API on :3000 with ICHIRAN_DATABASE_URL set
npm run demo:api -- data/demo                 # 20 live API cases → data/demo/api-cases.{md,json}
npm run demo:screenshots -- data/demo/shots   # starts the Playground on :5173, writes 11 PNGs
```

The expected values in `scripts/demo/api-cases.ts` are Ichiran's results over the `ichiran-260118` release database. The screenshot script fails if an expected element is missing or a page error occurs. It walks through:

- ichi.moe's example べんきょう しています;
- word cards with alternatives, a counter and a conjugation chain;
- the segmentation menu, and switching to a second segmentation;
- a conjugation reached through two roots;
- expanding omitted entries;
- the Chinese interface;
- mobile;
- the API docs.

The report below was recorded on 2026-10-19 with Ichiran's release database `ichiran-260118` read in place. Timings are from a single local run.

Server: `http://127.0.0.1:3000` · dictionary: ichiran-260118 · **20/20 passed**

| #   | Case                                                       | Request                           | HTTP | Result |  ms |
| --- | ---------------------------------------------------------- | --------------------------------- | ---- | ------ | --: |
| 1   | Readiness reports the Ichiran database                     | `GET /readyz`                     | 200  | ✅     |  74 |
| 2   | Sentence analysis: tokens, readings and romanization       | `POST /v1/analyze`                | 200  | ✅     |  38 |
| 3   | Conjugation chain resolves to the dictionary form          | `POST /v1/analyze`                | 200  | ✅     |   8 |
| 4   | Suffix compound with components and spans                  | `POST /v1/analyze`                | 200  | ✅     |  29 |
| 5   | Counter reading with sound change                          | `POST /v1/analyze`                | 200  | ✅     |  13 |
| 6   | UTF-16 offsets, halfwidth katakana, emoji and unknown text | `POST /v1/analyze`                | 200  | ✅     |  14 |
| 7   | Romanization: Kunrei-shiki                                 | `POST /v1/analyze`                | 200  | ✅     |  20 |
| 8   | Segmentation hint forces a boundary                        | `POST /v1/analyze`                | 200  | ✅     |  15 |
| 9   | Top-K candidates are ordered by score                      | `POST /v1/analyze`                | 200  | ✅     |  32 |
| 10  | Reading endpoint                                           | `POST /v1/reading`                | 200  | ✅     |   9 |
| 11  | ichi.moe data: runs, paths with scores, word cards         | `POST /v1/ichiran/analyze`        | 200  | ✅     |   9 |
| 12  | Ichiran romanize with word info                            | `POST /v1/ichiran/romanize`       | 200  | ✅     |  67 |
| 13  | Ichiran romanize* JSON                                     | `POST /v1/ichiran/segment`        | 200  | ✅     |  11 |
| 14  | Ichiran word lookup                                        | `GET /v1/ichiran/word?text=行く`  | 200  | ✅     |   5 |
| 15  | Ichiran kanji information                                  | `GET /v1/ichiran/kanji/食`        | 200  | ✅     |  12 |
| 16  | Ichiran kanji/reading alignment                            | `POST /v1/ichiran/match-readings` | 200  | ✅     |  12 |
| 17  | Validation: empty text is rejected                         | `POST /v1/analyze`                | 400  | ✅     |   3 |
| 18  | Validation: limit above 5 is rejected                      | `POST /v1/analyze`                | 400  | ✅     |   2 |
| 19  | Validation: hint inside a surrogate pair is rejected       | `POST /v1/analyze`                | 400  | ✅     |   2 |
| 20  | A character outside KANJIDIC returns 404                   | `GET /v1/ichiran/kanji/ア`        | 404  | ✅     |   3 |

## Response excerpts

**1. Readiness reports the Ichiran database**

```json
{
  "version": "ichiran-260118",
  "source": "Ichiran database \"ichiran\" (read in place)",
  "entryCount": 2512563,
  "capabilities": ["words", "ichiran", "kanji"]
}
```

**2. Sentence analysis: tokens, readings and romanization**

```json
"猫[neko] は[wa] 魚[sakana] を[wo] 食べました[tabemashita] 。[-]"
```

**3. Conjugation chain resolves to the dictionary form**

```json
{
  "lemma": "食べる",
  "steps": ["Causative-Passive", "Past (~ta), negative"]
}
```

**4. Suffix compound with components and spans**

```json
[
  {
    "surface": "食べて",
    "steps": ["Conjunctive (~te)"]
  },
  {
    "surface": "しまった",
    "steps": ["indicates completion (to finish ...)", "Past (~ta)"]
  }
]
```

**5. Counter reading with sound change**

```json
"猫[neko] が[ga] 3匹[sambiki] いる[iru]"
```

**6. UTF-16 offsets, halfwidth katakana, emoji and unknown text**

```json
[
  ["ｶﾀｶﾅ", 0, 4, "word"],
  ["😀", 4, 6, "separator"],
  ["で", 6, 7, "word"],
  ["abc", 7, 10, "unknown"]
]
```

**7. Romanization: Kunrei-shiki**

```json
"tôkyô ni iku"
```

**8. Segmentation hint forces a boundary**

```json
["食べ", "たい"]
```

**9. Top-K candidates are ordered by score**

```json
[
  {
    "score": 1097,
    "tokens": "東京都|に|住んでいる"
  },
  {
    "score": 843,
    "tokens": "東京都|に|住んで|いる"
  }
]
```

**10. Reading endpoint**

```json
"にほんごをべんきょうしています"
```

**11. ichi.moe data: runs, paths with scores, word cards**

```json
[
  {
    "run": "べんきょう",
    "paths": [
      "benkyō (208)",
      "ben kyō (28)",
      "be n kyō (-473)",
      "ben kyō (-984)",
      "ben kyō (-1488)"
    ]
  },
  {
    "run": "しています",
    "paths": [
      "shiteimasu (380)",
      "shite imasu (130)",
      "shi te imasu (101)",
      "shi te imasu (-404)",
      "shite ima su (-444)"
    ]
  }
]
```

**12. Ichiran romanize with word info**

```json
{
  "romanization": "kyō wa sushi wo tabe ni ikimasen ka?",
  "first": {
    "word": "kyō",
    "gloss": "今日 【きょう】\n1. [n,adv] today; this day\n2. [n,adv] these days; recently; nowadays"
  }
}
```

_*13. Ichiran romanize* JSON_*

```json
[
  "ocha",
  {
    "reading": "お茶 【おちゃ】",
    "text": "お茶",
    "kana": "おちゃ",
    "score": 160,
    "seq": 1002430,
    "gloss": [
      {
        "pos": "[n]",
        "gloss": "tea (esp. green or barley)"
      },
      {
        "pos": "[n]",
        "gloss": "tea break (at work)"
      },
      {
        "pos": "[n]",
        "gloss": "tea ceremony"
      }
    ],
    "conj": []
  }
]
```

**14. Ichiran word lookup**

```json
[
  {
    "reading": "行く 【いく】",
    "seq": 1578850
  }
]
```

**15. Ichiran kanji information**

```json
{
  "text": "食",
  "strokes": 9,
  "grade": 2,
  "readings": ["しょく 72.73%", "じき 1.82%", "く 18.18%", "た 6.36%"]
}
```

**16. Ichiran kanji/reading alignment**

```json
["食=た (ja_kun)", "べ", "物=もの (ja_kun)"]
```

**17. Validation: empty text is rejected**

```json
[400, "INVALID_REQUEST"]
```

**18. Validation: limit above 5 is rejected**

```json
[400, "INVALID_REQUEST"]
```

**19. Validation: hint inside a surrogate pair is rejected**

```json
[400, "INVALID_HINTS"]
```

**20. A character outside KANJIDIC returns 404**

```json
[404, "NOT_FOUND"]
```
