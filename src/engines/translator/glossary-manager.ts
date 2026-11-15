import type { GlossaryEntry } from '../types'

/** Separates aliases inside the third CSV column. */
const CSV_ALIAS_SEPARATOR = '|'

/** Trimmed, non-empty, de-duplicated aliases that differ from the source; undefined when none remain. */
export function cleanAliases(source: string, aliases: readonly unknown[] | undefined): string[] | undefined {
  if (!aliases?.length) return undefined
  const result: string[] = []
  for (const alias of aliases) {
    if (typeof alias !== 'string') continue
    const a = alias.trim()
    if (a && a !== source && !result.includes(a)) result.push(a)
  }
  return result.length > 0 ? result : undefined
}

function entry(source: string, target: string, aliases?: readonly unknown[]): GlossaryEntry {
  const cleaned = cleanAliases(source, aliases)
  return cleaned ? { source, target, aliases: cleaned } : { source, target }
}

/** Keep well-formed { source, target, aliases? } entries, trimmed, from untrusted input (a file or the renderer). */
export function sanitizeGlossaryEntries(data: readonly unknown[]): GlossaryEntry[] {
  return data
    .filter(
      (raw): raw is Record<string, unknown> =>
        typeof raw === 'object' &&
        raw !== null &&
        typeof (raw as Record<string, unknown>).source === 'string' &&
        typeof (raw as Record<string, unknown>).target === 'string'
    )
    .map((raw) =>
      entry(
        String(raw.source).trim(),
        String(raw.target).trim(),
        Array.isArray(raw.aliases) ? raw.aliases : undefined
      )
    )
    .filter((e) => e.source.length > 0 && e.target.length > 0)
}

/**
 * Parse a JSON glossary file.
 * Expected format: array of { source, target, aliases? }
 */
export function parseJsonGlossary(content: string): GlossaryEntry[] {
  const data = JSON.parse(content)
  if (!Array.isArray(data)) {
    throw new Error('JSON glossary must be an array')
  }
  return sanitizeGlossaryEntries(data)
}

/**
 * Parse a CSV glossary file.
 * Expected format: source,target[,aliases] (header row required); aliases are
 * separated by "|".
 * Handles quoted fields with commas inside.
 */
export function parseCsvGlossary(content: string): GlossaryEntry[] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (lines.length < 2) return [] // Need header + at least one data row

  // Skip header row
  const entries: GlossaryEntry[] = []
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i])
    if (fields.length >= 2) {
      const source = fields[0].trim()
      const target = fields[1].trim()
      if (source.length > 0 && target.length > 0) {
        entries.push(entry(source, target, fields[2]?.split(CSV_ALIAS_SEPARATOR)))
      }
    }
  }
  return entries
}

/**
 * Parse a single CSV line, handling quoted fields.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          // Escaped quote
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === ',') {
        fields.push(current)
        current = ''
      } else {
        current += char
      }
    }
  }
  fields.push(current)
  return fields
}

/**
 * Export glossary entries to JSON format.
 */
export function exportJsonGlossary(entries: GlossaryEntry[]): string {
  return JSON.stringify(
    entries.map((e) => entry(e.source, e.target, e.aliases)),
    null,
    2
  )
}

/**
 * Export glossary entries to CSV format with header row.
 */
export function exportCsvGlossary(entries: GlossaryEntry[]): string {
  // The aliases column appears only when needed, so files without aliases keep the two-column format.
  const withAliases = entries.some((e) => e.aliases?.length)
  const header = withAliases ? 'source,target,aliases' : 'source,target'
  const rows = entries.map((e) => {
    const fields = [e.source, e.target]
    if (withAliases) fields.push((e.aliases ?? []).join(CSV_ALIAS_SEPARATOR))
    return fields.map(escapeCsvField).join(',')
  })
  return [header, ...rows].join('\n')
}

/**
 * Escape a CSV field value — wrap in quotes if it contains commas, quotes, or newlines.
 */
function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/**
 * Merge personal and organization glossaries.
 * Organization terms take precedence when source terms conflict.
 * Deduplicates entries by source term (case-sensitive).
 */
export function mergeGlossaries(
  personal: GlossaryEntry[],
  organization: GlossaryEntry[]
): GlossaryEntry[] {
  const merged = new Map<string, GlossaryEntry>()

  // Add personal terms first
  for (const entry of personal) {
    merged.set(entry.source, entry)
  }

  // Organization terms override personal
  for (const entry of organization) {
    merged.set(entry.source, entry)
  }

  return Array.from(merged.values())
}

/**
 * Detect glossary file format from filename extension.
 */
export function detectGlossaryFormat(filename: string): 'json' | 'csv' | null {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.csv')) return 'csv'
  return null
}

/**
 * Parse glossary from file content, auto-detecting format.
 */
export function parseGlossary(content: string, format: 'json' | 'csv'): GlossaryEntry[] {
  switch (format) {
    case 'json':
      return parseJsonGlossary(content)
    case 'csv':
      return parseCsvGlossary(content)
    default:
      throw new Error(`Unsupported glossary format: ${format}`)
  }
}
