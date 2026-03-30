import type { GlossaryEntry } from '../types'

/**
 * Parse a JSON glossary file.
 * Expected format: array of { source, target, context? }
 */
export function parseJsonGlossary(content: string): GlossaryEntry[] {
  const data = JSON.parse(content)
  if (!Array.isArray(data)) {
    throw new Error('JSON glossary must be an array')
  }
  return data
    .filter(
      (entry: unknown) =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as Record<string, unknown>).source === 'string' &&
        typeof (entry as Record<string, unknown>).target === 'string'
    )
    .map((entry: Record<string, unknown>) => ({
      source: String(entry.source).trim(),
      target: String(entry.target).trim()
    }))
    .filter((entry) => entry.source.length > 0 && entry.target.length > 0)
}

/**
 * Parse a CSV glossary file.
 * Expected format: source,target,context (header row required)
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
        entries.push({ source, target })
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
    entries.map((e) => ({ source: e.source, target: e.target })),
    null,
    2
  )
}

/**
 * Export glossary entries to CSV format with header row.
 */
export function exportCsvGlossary(entries: GlossaryEntry[]): string {
  const header = 'source,target'
  const rows = entries.map((e) => `${escapeCsvField(e.source)},${escapeCsvField(e.target)}`)
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
