import type { GlossaryEntry } from '../types'

/**
 * Terms longer than this are skipped at the ASR stage. Older builds saved whole
 * corrected sentences as glossary entries; matching those against transcripts or
 * listing them in the ASR context only costs time.
 */
export const MAX_ASR_TERM_LENGTH = 40

/**
 * Upper bound on the terms listed in the Qwen3-ASR context. Every term is prefilled
 * on each request, so an unbounded glossary would add latency to every utterance.
 */
export const MAX_ASR_CONTEXT_TERMS = 60

/** Shorter aliases match inside ordinary words too often (e.g. a 1-kana alias). */
const MIN_ALIAS_LENGTH = 2

const KATAKANA_START = 0x30a1
const KATAKANA_END = 0x30f6
const HIRAGANA_START = 0x3041
const HIRAGANA_END = 0x3096
const KANA_OFFSET = KATAKANA_START - HIRAGANA_START
const LATIN_OR_DIGIT = /[\p{Script=Latin}\p{N}]/u
/** Characters that continue a Latin word, accents and combining marks included. */
const WORD_CHAR = '[\\p{Script=Latin}\\p{N}\\p{M}]'

interface Corrector {
  regex: RegExp
  canonical: Map<string, string>
}

const cache = new WeakMap<GlossaryEntry[], Corrector | null>()
const contextCache = new WeakMap<GlossaryEntry[], string>()

function usable(entry: GlossaryEntry): boolean {
  const source = entry.source?.trim()
  return !!source && source.length <= MAX_ASR_TERM_LENGTH
}

function toKatakana(ch: string): string {
  const code = ch.codePointAt(0) ?? 0
  return code >= HIRAGANA_START && code <= HIRAGANA_END ? String.fromCodePoint(code + KANA_OFFSET) : ch
}

/** Key under which a matched span is looked up: ASR writes the same word in either kana script or any case. */
function matchKey(text: string): string {
  return Array.from(text.normalize('NFKC'), toKatakana).join('').toLowerCase()
}

function escapeRegExp(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function charPattern(ch: string): string {
  const kata = toKatakana(ch)
  const code = kata.codePointAt(0) ?? 0
  if (code >= KATAKANA_START && code <= KATAKANA_END) {
    return `[${kata}${String.fromCodePoint(code - KANA_OFFSET)}]`
  }
  return escapeRegExp(ch)
}

/**
 * Latin terms only match as whole words, so "Avvy" does not rewrite the middle of
 * "Navvy". Japanese has no word boundaries, which is why aliases have a minimum length.
 */
function termPattern(term: string): string {
  const chars = Array.from(term)
  const body = chars.map(charPattern).join('')
  const head = LATIN_OR_DIGIT.test(chars[0]) ? `(?<!${WORD_CHAR})` : ''
  const tail = LATIN_OR_DIGIT.test(chars[chars.length - 1]) ? `(?!${WORD_CHAR})` : ''
  return `${head}${body}${tail}`
}

function buildCorrector(glossary: GlossaryEntry[]): Corrector | null {
  const canonical = new Map<string, string>()
  // The normalized key and the spelling as registered: a half-width kana alias must
  // match itself in the transcript, not only its NFKC form.
  const spellings = new Set<string>()
  const add = (spelling: string, source: string): void => {
    if (Array.from(spelling).length < MIN_ALIAS_LENGTH) return
    const key = matchKey(spelling)
    if (!canonical.has(key)) canonical.set(key, source)
    spellings.add(key)
    spellings.add(spelling)
  }
  const entries = glossary.filter(usable)
  // Sources before aliases: a registered term is never rewritten into another term
  // because some other entry lists it as a misrecognition.
  for (const entry of entries) add(entry.source.trim(), entry.source.trim())
  for (const entry of entries) {
    for (const alias of entry.aliases ?? []) add(alias.trim(), entry.source.trim())
  }
  if (canonical.size === 0) return null

  // Longest first so "Project Nebulus" wins over "Nebulus" at the same position.
  const patterns = Array.from(spellings)
    .sort((a, b) => b.length - a.length)
    .map(termPattern)
  return { regex: new RegExp(patterns.join('|'), 'giu'), canonical }
}

/**
 * Rewrite glossary terms and their aliases in an ASR transcript to the spelling the
 * user registered. Matching ignores letter case and hiragana/katakana differences;
 * one pass over the text, so a replacement is never rewritten again.
 */
export function correctTranscript(text: string, glossary: GlossaryEntry[] | undefined): string {
  if (!text || !glossary?.length) return text
  let corrector = cache.get(glossary)
  if (corrector === undefined) {
    corrector = buildCorrector(glossary)
    cache.set(glossary, corrector)
  }
  if (!corrector) return text
  const { regex, canonical } = corrector
  return text.replace(regex, (match) => canonical.get(matchKey(match)) ?? match)
}

/**
 * Text for the Qwen3-ASR context: both sides of each entry, since a speaker may say
 * the term in either language. Aliases are left out because they are the wrong
 * spellings the context is meant to steer away from.
 */
export function buildAsrContext(glossary: GlossaryEntry[] | undefined): string {
  if (!glossary?.length) return ''
  const cached = contextCache.get(glossary)
  if (cached !== undefined) return cached

  const terms: string[] = []
  const seen = new Set<string>()
  for (const entry of glossary) {
    if (!usable(entry)) continue
    for (const term of [entry.source, entry.target]) {
      const t = term?.trim()
      if (!t || t.length > MAX_ASR_TERM_LENGTH || seen.has(t)) continue
      seen.add(t)
      terms.push(t)
    }
    if (terms.length >= MAX_ASR_CONTEXT_TERMS) break
  }
  const context = terms.slice(0, MAX_ASR_CONTEXT_TERMS).join(', ')
  contextCache.set(glossary, context)
  return context
}
