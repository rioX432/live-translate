/** A glossary entry as the settings UI edits it; aliases are spellings ASR writes for the term. */
export interface GlossaryTerm {
  source: string
  target: string
  aliases?: string[]
}

/** Replace the entry with the same source, or append: the same source twice would leave one unreachable. */
export function upsertTerm(terms: GlossaryTerm[], term: GlossaryTerm, replaceIndex?: number): GlossaryTerm[] {
  const found = replaceIndex ?? terms.findIndex((t) => t.source === term.source)
  const next = found < 0 ? [...terms, term] : terms.map((t, i) => (i === found ? term : t))
  const at = found < 0 ? next.length - 1 : found
  return next.filter((t, i) => i === at || t.source !== term.source)
}

/** Build a term from the form fields; null until both sides are filled in. */
export function termFromInput(source: string, target: string, aliasText: string): GlossaryTerm | null {
  const s = source.trim()
  const t = target.trim()
  if (!s || !t) return null
  const aliases = aliasText
    .split(/[,、]/)
    .map((a) => a.trim())
    .filter((a, i, all) => a.length > 0 && a !== s && all.indexOf(a) === i)
  return aliases.length > 0 ? { source: s, target: t, aliases } : { source: s, target: t }
}
