# Glossary

Live Translate has a glossary that pins source terms to fixed translations, so
brand names, product names, and domain acronyms are recognized and translated
the same way every time.

There are two glossaries:

- **Personal glossary** — managed by the local user, persisted via
  `electron-store`.
- **Organization glossary** — typically imported from a CSV/JSON file shared
  inside a team. On conflict, organization terms **override** personal terms
  (see `mergeGlossaries` in
  `src/engines/translator/glossary-manager.ts`).

Both glossaries are stored locally; nothing is uploaded.

## What is stored

Each entry has a source term, a translation, and optional **aliases** ("Heard
as" in the UI): spellings speech recognition writes for the term, such as アビー
for アビィ.

Entries are saved only when the user adds, edits, or imports them. The app
never stores meeting audio or transcripts, never adds a term on its own, and
never saves an engine translation as a term. A subtitle corrected on screen
changes only what is displayed. Glossary terms and utterance text are never
written to logs.

## Editing in Settings

Settings → Glossary lists the personal and organization glossaries separately.

- **Add** a term with its translation and, optionally, aliases separated by
  commas (`,` or `、`).
- **Edit** or **Remove** any entry in either list.
- Changes apply from the next sentence, also while a meeting is running; no
  restart is needed.
- Adding a source that already exists replaces that entry instead of adding a
  duplicate.

## File formats

The same content can be represented as CSV or JSON.

### CSV

A header row is required. The columns are the source term, the target term,
and optionally the aliases, separated by `|`. Quoted fields (with `"`) are
supported for values that contain commas, quotes, or newlines. Exports add the
aliases column only when some entry has aliases.

```csv
source,target,aliases
アビィ,Avvy,アビー|アビ
Avvy,アビィ,Avi
"AI, ML",AIとML,
```

### JSON

A flat array of objects with `source`, `target`, and optional `aliases` keys.
Extra keys are ignored. Empty / whitespace-only entries and aliases are
dropped, as are aliases equal to the source.

```json
[
  { "source": "アビィ", "target": "Avvy", "aliases": ["アビー", "アビ"] },
  { "source": "AnotherBall", "target": "AnotherBall" }
]
```

## Importing & exporting

In Settings → Glossary:

1. Click **Import** under either **Personal** or **Organization**.
2. Pick a `.csv` or `.json` file. The format is detected from the extension.
3. The imported entries replace the corresponding glossary; the status line
   shows how many terms were loaded.
4. Click **Export JSON** or **Export CSV** to save the current contents back
   out.

If both personal and organization glossaries are present, the UI shows any
**conflicts** (same source, different target). Organization entries win at
runtime.

## How glossary terms are applied

The pipeline uses the **merged** glossary (organization overrides personal) at
two stages. The measurements behind this setup are in
`docs/research/glossary-asr-vs-mt.md`.

1. **Speech recognition**
   - On Apple Silicon, both sides of each entry are passed to Qwen3-ASR as
     context (`buildAsrContext`), at most 60 terms.
   - The transcript is then corrected (`correctTranscript`): the source term
     and its aliases are rewritten to the registered spelling. Matching ignores
     letter case and hiragana/katakana differences. Latin terms match only as
     whole words, and aliases shorter than two characters are ignored.
   - Entries longer than 40 characters are skipped at this stage.
2. **Translation:** Hy-MT2 gets the terms that occur in the sentence in its
   official prompt form (`buildHyMt2Prompt`):

   ```
   Reference the following translations:
   アビィ translates to Avvy
   ```

Whisper (Windows, Intel Mac) has no context input, so only the transcript
correction and the translation stage apply there.

## Tips

- Register what you see go wrong. If subtitles show アビー where you meant
  アビィ, add アビー to the term's aliases.
- Aliases and the recognition context can also pull a similar ordinary word
  toward the term (for example アビーロード → アビィロード). Remove the alias if
  that happens too often.
- Use the organization glossary for company-wide vocabulary (product names,
  legal entity names) and the personal glossary for per-user preferences
  (your own handle, your team's nicknames).
- Glossary entries are not language-tagged; add both directions (アビィ → Avvy
  and Avvy → アビィ) when people say the term in either language.

## Related files

- `src/engines/stt/term-correction.ts` — ASR context and transcript correction.
- `src/engines/translator/hy-mt2-prompt.ts` — translation prompt with terms.
- `src/engines/translator/glossary-manager.ts` — parsers, exporters, merge,
  sanitizing, format detection.
- `src/renderer/components/settings/GlossarySettings.tsx` — UI.
- `benchmark/glossary/` — the comparison benchmark (synthetic data only).
