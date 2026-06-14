# Glossary

Live Translate ships with a built-in glossary system that lets you pin specific
source terms to specific target terms, so brand names, product names, and
domain acronyms stay consistent across every translation.

There are two glossaries:

- **Personal glossary** — managed by the local user, persisted via
  `electron-store`.
- **Organization glossary** — typically imported from a CSV/JSON file shared
  inside a team. On conflict, organization terms **override** personal terms
  (see `mergeGlossaries` in
  `src/engines/translator/glossary-manager.ts`).

Both glossaries are stored locally; nothing is uploaded.

## File formats

The same content can be represented as CSV or JSON.

### CSV

A header row is required. The first column is the source term, the second is
the target term. Quoted fields (with `"`) are supported for values that
contain commas, quotes, or newlines.

```csv
source,target
Avvy,Avvy
AnotherBall,AnotherBall
"AI, ML",AIとML
DroidKaigi,DroidKaigi
```

### JSON

A flat array of objects with `source` and `target` keys. Extra keys are
ignored. Empty / whitespace-only entries are dropped.

```json
[
  { "source": "Avvy", "target": "Avvy" },
  { "source": "AnotherBall", "target": "AnotherBall" },
  { "source": "DroidKaigi", "target": "DroidKaigi" }
]
```

## Importing & exporting

In Settings → Glossary:

1. Click **Import** under either **Personal** or **Organization**.
2. Pick a `.csv` or `.json` file. The format is detected from the extension.
3. The imported entries replace the corresponding glossary; the status line
   shows how many terms were loaded.
4. Click **Export JSON** or **Export CSV** to save the current contents back
   out. Exports always include a header row (CSV) or pretty-printed JSON.

If both personal and organization glossaries are present, the UI surfaces
any **conflicts** (same source, different target) so you can decide which to
keep. Organization entries win at runtime.

## How glossary terms are applied

The pipeline applies glossaries in two complementary ways depending on the
translator engine:

- **String replacement** — `applyGlossary` performs a literal `replaceAll`
  for each `source` term in the input text before the translator sees it.
  Empty / whitespace-only sources are skipped. This is engine-agnostic and
  always runs.
- **LLM prompt injection** — for LLM-based translators (HY-MT1.5, Hunyuan-MT
  7B, LFM2, Gemini), `formatGlossaryPrompt` formats the entries as a small
  system-prompt fragment:

  ```
  Use these fixed translations for specific terms:
    "Avvy" → "Avvy"
    "AnotherBall" → "AnotherBall"
  ```

  This lets the model handle inflection and surrounding context while still
  honoring the term list.

Both paths use the **merged** glossary (organization overrides personal),
so a single canonical set of terms is presented to every translator.

## Tips

- Keep the source column **exactly** as it appears in transcription. STT
  output preserves casing, so `AVVY` and `Avvy` are different entries.
- Use the organization glossary for company-wide vocabulary (product names,
  legal entity names) and the personal glossary for per-user preferences
  (your own handle, your team's nicknames).
- Glossaries scale to hundreds of entries cheaply because the string-replace
  pass is O(N · M) over short inputs; the LLM prompt cost is the main
  bound. If you have ≥1k entries, prefer the CSV path and split by domain.
- Glossary entries are not language-tagged today; if you need different terms
  for JA→EN vs EN→JA, maintain two files and swap them per session.

## Related files

- `src/engines/translator/glossary-utils.ts` — `applyGlossary`,
  `formatGlossaryPrompt`.
- `src/engines/translator/glossary-manager.ts` — parsers, exporters, merge,
  format detection.
- `src/renderer/components/settings/GlossarySettings.tsx` — UI.
- `src/engines/translator/glossary-manager.test.ts` — round-trip tests.
