/**
 * Runtime type-safe extractors for IPC settings.
 * These avoid unsafe `as` casts when reading unknown values from the store.
 */

export const str = (v: unknown, def: string): string => (typeof v === 'string' ? v : def)
export const num = (v: unknown, def: number): number => (typeof v === 'number' ? v : def)
export const bool = (v: unknown, def: boolean): boolean => (typeof v === 'boolean' ? v : def)
export const arr = <T>(v: unknown, def: T[]): T[] => (Array.isArray(v) ? v : def)
export const rec = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
